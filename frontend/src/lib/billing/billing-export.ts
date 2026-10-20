import "server-only";

import ExcelJS from "exceljs";
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { OrdersValidationError } from "@/lib/orders/types";
import { INVOICING_STATE_LABEL, DELIVERY_STATE_LABEL, isValidIsoDate, normalizeClientKey } from "./billing-state";
import { assertBillingRead, listBillingRows, monthRange, type BillingActor } from "./billing-service";

export const BILLING_REPORTS = ["pendientes", "entregas", "facturacion-cliente", "unidades-producto", "parciales"] as const;
export type BillingReport = (typeof BILLING_REPORTS)[number];

type Row = Record<string, unknown>;
type Cell = string | number | null;

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const fmtDate = (v: unknown) => (v == null ? null : new Date(String(v)).toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }));

export type ReportTable = { title: string; columns: string[]; rows: Cell[][] };

export async function buildReportTable(actor: BillingActor, report: BillingReport, f: { client?: string; from?: string; to?: string }): Promise<ReportTable> {
  assertBillingRead(actor);
  if (!BILLING_REPORTS.includes(report)) throw new OrdersValidationError("Reporte desconocido.");
  const range = { ...monthRange(), ...(f.from && isValidIsoDate(f.from) ? { from: f.from } : {}), ...(f.to && isValidIsoDate(f.to) ? { to: f.to } : {}) };
  const db = getDb() as unknown as { execute: (q: ReturnType<typeof sql>) => Promise<{ rows: unknown[] }> };
  const clientCond = f.client ? sql`and lower(w.client) like ${`%${normalizeClientKey(f.client)}%`}` : sql``;

  if (report === "pendientes" || report === "parciales") {
    const rows = await listBillingRows(actor, { client: f.client });
    const sel = rows.filter((r) => (report === "pendientes" ? r.delivered > 0 && r.pendingInvoice > 1e-6 : r.invoicingState === "FACTURACION_PARCIAL" || (r.invoiced > 0 && (r.pendingInvoice > 1e-6 || (r.pendingDelivery ?? 0) > 1e-6))));
    return {
      title: report === "pendientes" ? "Pedidos pendientes de facturar" : "Facturación parcial y saldos",
      columns: ["Cliente", "Pedido", "Producto", "OE/OA", "Cant. pedida", "Entregada", "Pendiente de entregar", "Facturada", "Entregada pendiente de facturar", "Remitos", "Facturas", "Última entrega", "Última facturación", "Estado de entrega", "Estado de facturación"],
      rows: sel.map((r) => [r.client, r.pedido, r.product, r.orderRef, r.requested, r.delivered, r.pendingDelivery, r.invoiced, r.pendingInvoice, r.remitos.join(", "), r.invoices.join(", "), fmtDate(r.lastDeliveryAt), r.lastInvoiceDate, DELIVERY_STATE_LABEL[r.deliveryState], INVOICING_STATE_LABEL[r.invoicingState]]),
    };
  }

  if (report === "entregas") {
    const res = await db.execute(sql`
      select (l.actual_delivered_at at time zone 'America/Argentina/Buenos_Aires')::date::text as fecha, w.client, d.pedido_op, w.product, w.order_number, l.quantity::float8 as quantity, l.unit, l.kind, l.remito, l.delivered_by,
             coalesce(i.invoiced, 0)::float8 as invoiced, i.numbers
        from work_item_delivery_lines l join work_items w on w.id = l.work_item_id left join work_item_deliveries d on d.id = l.delivery_id
        left join (select il.delivery_line_id, sum(il.quantity) as invoiced, string_agg(distinct inv.invoice_number, ', ') as numbers
                     from billing_invoice_lines il join billing_invoices inv on inv.id = il.invoice_id and inv.status = 'ACTIVA' where il.status = 'ACTIVA' group by il.delivery_line_id) i on i.delivery_line_id = l.id
       where l.status = 'ACTIVA' and w.deleted_at is null ${clientCond}
         and (l.actual_delivered_at at time zone 'America/Argentina/Buenos_Aires')::date between ${range.from}::date and ${range.to}::date
       order by l.actual_delivered_at`);
    return {
      title: `Entregas del ${range.from} al ${range.to}`,
      columns: ["Fecha", "Cliente", "Pedido", "Producto", "OE/OA", "Cantidad entregada", "Tipo", "Remito", "Facturada", "Pendiente de facturar", "Facturas", "Entregó"],
      rows: (res.rows as Row[]).map((r) => [String(r.fecha), String(r.client), r.pedido_op == null ? null : String(r.pedido_op), String(r.product), r.order_number == null ? null : String(r.order_number), Number(r.quantity), r.kind === "FINAL" ? "Final" : "Parcial", r.remito == null ? null : String(r.remito), Number(r.invoiced), Math.max(0, Number(r.quantity) - Number(r.invoiced)), r.numbers == null ? null : String(r.numbers), String(r.delivered_by ?? "")]),
    };
  }

  if (report === "facturacion-cliente") {
    const res = await db.execute(sql`
      select i.client, i.invoice_number, i.invoice_date::text as invoice_date, i.status, w.product, w.order_number, il.quantity::float8 as quantity, il.status as line_status, i.created_by
        from billing_invoice_lines il join billing_invoices i on i.id = il.invoice_id join work_items w on w.id = il.work_item_id
       where i.invoice_date between ${range.from}::date and ${range.to}::date ${clientCond}
       order by i.client, i.invoice_date, i.invoice_number`);
    return {
      title: `Facturación registrada ${range.from} al ${range.to}`,
      columns: ["Cliente", "Factura", "Fecha factura", "Producto", "OE/OA", "Unidades facturadas", "Estado", "Registró"],
      rows: (res.rows as Row[]).map((r) => [String(r.client), String(r.invoice_number), String(r.invoice_date), String(r.product), r.order_number == null ? null : String(r.order_number), Number(r.quantity), r.status === "ACTIVA" && r.line_status === "ACTIVA" ? "Vigente" : "Anulada", String(r.created_by)]),
    };
  }

  const res = await db.execute(sql`
    select w.product, w.unit, sum(il.quantity)::float8 as units, count(distinct i.id)::int as invoices, count(distinct i.client_norm)::int as clients
      from billing_invoice_lines il join billing_invoices i on i.id = il.invoice_id and i.status = 'ACTIVA' join work_items w on w.id = il.work_item_id
     where il.status = 'ACTIVA' and i.invoice_date between ${range.from}::date and ${range.to}::date ${clientCond}
     group by w.product, w.unit order by units desc`);
  return {
    title: `Unidades facturadas por producto ${range.from} al ${range.to}`,
    columns: ["Producto", "Unidad", "Unidades facturadas", "Facturas", "Clientes"],
    rows: (res.rows as Row[]).map((r) => [String(r.product), r.unit == null ? null : String(r.unit), Number(r.units), Number(r.invoices), Number(r.clients)]),
  };
}

export async function buildReportXlsx(actor: BillingActor, report: BillingReport, f: { client?: string; from?: string; to?: string }): Promise<{ bytes: Buffer; filename: string; mime: string; rows: number }> {
  const table = await buildReportTable(actor, report, f);
  const wb = new ExcelJS.Workbook();
  wb.creator = "GENUS OS";
  const ws = wb.addWorksheet(table.title.slice(0, 31).replace(/[\\/?*[\]:]/g, "-"));
  ws.addRow(table.columns).font = { bold: true };
  for (const r of table.rows) ws.addRow(r);
  ws.columns.forEach((c, i) => {
    c.width = Math.min(48, Math.max(12, table.columns[i].length + 2, ...table.rows.slice(0, 200).map((r) => String(r[i] ?? "").length + 2)));
  });
  ws.views = [{ state: "frozen", ySplit: 1 }];
  const bytes = Buffer.from(await wb.xlsx.writeBuffer());
  return { bytes, filename: `facturacion-${report}-${new Date().toISOString().slice(0, 10)}.xlsx`, mime: XLSX_MIME, rows: table.rows.length };
}
