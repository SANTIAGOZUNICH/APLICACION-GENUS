import "server-only";

/**
 * Lectura de datos de origen del Dashboard — SOLO LECTURA. Nunca modifica pedidos, trabajos, entregas, stock ni remitos.
 * Excluye siempre registros eliminados (deleted_at), entregas ANULADO/REGISTRO_ELIMINADO y trabajos cancelados.
 *
 * Fuentes: production_pedidos, work_items (Envasado Masivo/Premium, incluido lo que pasó por Codificado),
 * work_item_deliveries (entregas reales). Los clientes se derivan de pedidos/trabajos (no hay tabla de clientes).
 */
import { sql } from "drizzle-orm";
import { getDb, isDatabaseConfigured } from "@/lib/db/client";
import { isFeatureMemoryAllowed } from "@/lib/db/feature-schema";
import type { DashboardDeliveryRow, DashboardPedidoRow, DashboardRows, DashboardWorkRow } from "./types";

export type DashboardLoadedData = {
  rows: DashboardRows;
  lastDataChangeAt: string | null;
  dataSource: "database" | "memory" | "none";
};

type Mem = { rows: DashboardRows; lastDataChangeAt: string | null };
const g = globalThis as unknown as { __genusDashboardMem?: Mem };

/** Solo para pruebas / modo memoria: fija las filas que lee el Dashboard cuando no hay base. */
export function setDashboardMemoryRows(rows: DashboardRows, lastDataChangeAt: string | null = null): void {
  g.__genusDashboardMem = { rows, lastDataChangeAt };
}
export function resetDashboardMemoryRows(): void {
  g.__genusDashboardMem = undefined;
}

const EMPTY: DashboardRows = { pedidos: [], works: [], deliveries: [] };

function iso(v: unknown): string | null {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
function numOrNull(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function strOrNull(v: unknown): string | null {
  return v == null ? null : String(v);
}

export async function loadDashboardData(): Promise<DashboardLoadedData> {
  if (isDatabaseConfigured()) {
    const db = getDb();
    const [pedRes, workRes, delRes] = await Promise.all([
      db.execute(sql`
        select id::text as id, fecha::text as fecha, cliente, producto, estado, q, updated_at
        from production_pedidos
        where deleted_at is null
      `),
      db.execute(sql`
        select id::text as id, sector::text as sector, codificado_origin_sector, operational_status,
               operational_cancelled_at, finished_qty, packaging_total_units, client, product,
               production_pedido_id::text as production_pedido_id, completed_at, updated_at
        from work_items
        where deleted_at is null
          and (sector::text in ('ENVASADO_MASIVO', 'ENVASADO_PREMIUM')
               or codificado_origin_sector in ('ENVASADO_MASIVO', 'ENVASADO_PREMIUM'))
      `),
      db.execute(sql`
        select d.id::text as id, d.work_item_id::text as work_item_id, d.source_sector, d.client,
               coalesce(d.production_pedido_id, w.production_pedido_id)::text as pedido_id,
               d.actual_delivered_at, d.status::text as status, d.updated_at
        from work_item_deliveries d
        join work_items w on w.id = d.work_item_id
        where d.status = 'ENTREGADO' and d.delivery_complete = true and d.deleted_at is null and w.deleted_at is null
          -- solo entregas COMPLETAS: una parcial (delivery_complete = false) no es «entregado» ni cierra el lead time
      `),
    ]);
    let last: string | null = null;
    const track = (v: unknown) => {
      const t = iso(v);
      if (t && (!last || t > last)) last = t;
    };

    const pedidos: DashboardPedidoRow[] = (pedRes.rows as Record<string, unknown>[]).map((r) => {
      track(r.updated_at);
      return {
        id: String(r.id),
        fecha: strOrNull(r.fecha),
        cliente: strOrNull(r.cliente),
        producto: strOrNull(r.producto),
        estado: strOrNull(r.estado),
        q: numOrNull(r.q),
      };
    });
    const works: DashboardWorkRow[] = (workRes.rows as Record<string, unknown>[]).map((r) => {
      track(r.updated_at);
      const sector = String(r.sector);
      const origin = strOrNull(r.codificado_origin_sector);
      return {
        id: String(r.id),
        productionSector: sector.startsWith("ENVASADO_") ? sector : origin,
        operationalStatus: String(r.operational_status ?? ""),
        cancelled: r.operational_cancelled_at != null,
        finishedQty: strOrNull(r.finished_qty),
        packagingTotalUnits: numOrNull(r.packaging_total_units),
        client: strOrNull(r.client),
        product: strOrNull(r.product),
        productionPedidoId: strOrNull(r.production_pedido_id),
        completedAt: iso(r.completed_at),
      };
    });
    const deliveries: DashboardDeliveryRow[] = (delRes.rows as Record<string, unknown>[]).map((r) => {
      track(r.updated_at);
      return {
        id: String(r.id),
        workItemId: String(r.work_item_id),
        sourceSector: String(r.source_sector),
        client: strOrNull(r.client),
        pedidoId: strOrNull(r.pedido_id),
        actualDeliveredAt: iso(r.actual_delivered_at) ?? "",
        status: String(r.status),
      };
    });
    return { rows: { pedidos, works, deliveries }, lastDataChangeAt: last, dataSource: "database" };
  }

  if (isFeatureMemoryAllowed()) {
    const mem = g.__genusDashboardMem;
    return { rows: mem?.rows ?? EMPTY, lastDataChangeAt: mem?.lastDataChangeAt ?? null, dataSource: "memory" };
  }
  return { rows: EMPTY, lastDataChangeAt: null, dataSource: "none" };
}
