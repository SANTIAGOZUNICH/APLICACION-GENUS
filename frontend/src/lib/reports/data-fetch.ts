/**
 * Consultas Neon del reporte gerencial — una consulta por tabla (bulk SELECT
 * con GROUP/WHERE en SQL donde aplica), nunca una consulta por fila. La
 * agregación fina vive en analytics.ts (puro, sin DB) para poder testearla
 * con datasets controlados sin depender de Postgres.
 *
 * Sin `import "server-only"` a propósito: recibe la conexión ya armada
 * (inyección de dependencia) en vez de llamar a getDb() acá — así el mismo
 * código corre desde la ruta API real y desde scripts de smoke test contra
 * Preview DB (ver scripts/_smoke_management_report_dataset.mjs), igual que
 * el resto de los servicios de esta fase.
 */
import { and, gte, lte } from "drizzle-orm";
import type { NeonDatabase } from "drizzle-orm/neon-serverless";
import * as schema from "@/lib/db/schema";
import type {
  DeliveryReportRow,
  MeMaterialReportRow,
  PedidoReportRow,
  ReportDataset,
  ReportFilters,
  WorkItemReportRow,
} from "./types";

export type ReportDb = NeonDatabase<typeof schema>;

function toNum(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function fetchWorkItemRows(
  db: ReportDb,
  filters: Pick<ReportFilters, "from" | "to">
): Promise<WorkItemReportRow[]> {
  const rows = await db
    .select()
    .from(schema.workItems)
    .where(
      and(
        gte(schema.workItems.plannedDate, filters.from),
        lte(schema.workItems.plannedDate, filters.to)
      )
    );

  return rows.map((r) => ({
    id: r.id,
    client: r.client,
    product: r.product,
    sector: r.sector,
    status: r.status,
    operationalStatus: r.operationalStatus,
    qualityStatus: r.qualityStatus,
    plannedDate: String(r.plannedDate),
    deliveryDate: r.deliveryDate ? String(r.deliveryDate) : null,
    createdAt: r.createdAt,
    completedAt: r.completedAt,
    finishedQty: r.finishedQty,
    unit: r.unit,
    packagingTotalUnits: toNum(r.packagingTotalUnits),
    deliverableUnits: toNum(r.deliverableUnits),
    sampleUnits: r.sampleUnits ?? null,
    packagingClosedAt: r.packagingClosedAt,
    packagingClosedBy: r.packagingClosedBy,
    createdBy: r.createdBy,
    completedBy: r.completedBy,
    progressUpdatedBy: r.progressUpdatedBy,
    qualityDecidedAt: r.qualityDecidedAt,
    qualityDecidedBy: r.qualityDecidedBy,
    qualityObservation: r.qualityObservation,
    qualityChangeReason: r.qualityChangeReason,
    sentToCodificadoAt: r.sentToCodificadoAt,
    deliveredFromCodificadoAt: r.deliveredFromCodificadoAt,
    bulkRemainderKg: toNum(r.bulkRemainderKg),
    operationalCancelledAt: r.operationalCancelledAt,
  }));
}

export async function fetchDeliveryRows(
  db: ReportDb,
  filters: Pick<ReportFilters, "from" | "to">
): Promise<DeliveryReportRow[]> {
  const from = new Date(`${filters.from}T00:00:00.000Z`);
  const to = new Date(`${filters.to}T23:59:59.999Z`);
  const rows = await db
    .select()
    .from(schema.workItemDeliveries)
    .where(
      and(
        gte(schema.workItemDeliveries.actualDeliveredAt, from),
        lte(schema.workItemDeliveries.actualDeliveredAt, to)
      )
    );

  return rows.map((r) => ({
    id: r.id,
    workItemId: r.workItemId,
    product: r.product,
    codigo: r.codigo,
    client: r.client,
    lote: r.lote,
    quantity: r.quantity,
    unit: r.unit,
    actualDeliveredAt: r.actualDeliveredAt,
    status: r.status,
    deliveredBy: r.deliveredBy,
    deliveredBySector: r.deliveredBySector,
  }));
}

export async function fetchPedidoRows(
  db: ReportDb,
  filters: Pick<ReportFilters, "from" | "to">
): Promise<PedidoReportRow[]> {
  const rows = await db
    .select()
    .from(schema.productionPedidos)
    .where(
      and(
        gte(schema.productionPedidos.fecha, filters.from),
        lte(schema.productionPedidos.fecha, filters.to)
      )
    );
  return rows
    .filter((r) => r.deletedAt == null)
    .map((r) => ({
      id: r.id,
      fecha: r.fecha ? String(r.fecha) : null,
      cliente: r.cliente,
      producto: r.producto,
      estado: r.estado,
      kg: toNum(r.kg),
      ml: toNum(r.ml),
      q: toNum(r.q),
    }));
}

/** Stock ME actual — identidad estrictamente por código, nunca por nombre. */
export async function fetchMeMaterialRows(db: ReportDb): Promise<MeMaterialReportRow[]> {
  const rows = await db.select().from(schema.invMeMaterials);
  return rows
    .map((r) => {
      const payload = r.payload as { codigo?: string; nombre?: string; stockActual?: number };
      return {
        codigo: payload?.codigo?.trim() ?? "",
        nombre: payload?.nombre?.trim() || null,
        stockActual: toNum(payload?.stockActual),
      };
    })
    .filter((m) => m.codigo !== "")
    .sort((a, b) => a.codigo.localeCompare(b.codigo));
}

export async function fetchReportDataset(
  db: ReportDb,
  filters: Pick<ReportFilters, "from" | "to">
): Promise<ReportDataset> {
  const [workItems, deliveries, pedidos, meMaterials] = await Promise.all([
    fetchWorkItemRows(db, filters),
    fetchDeliveryRows(db, filters),
    fetchPedidoRows(db, filters),
    fetchMeMaterialRows(db),
  ]);
  return { workItems, deliveries, pedidos, meMaterials };
}
