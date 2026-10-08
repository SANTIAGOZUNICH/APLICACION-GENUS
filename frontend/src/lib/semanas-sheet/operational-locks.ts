/**
 * Estado operativo REAL de GENUS que protege celdas de SEMANAS 2026.
 *
 * Reemplaza reglas arbitrarias por fecha: un registro solo se bloquea si un
 * proceso operativo real lo cerró.
 *  - ENTREGAS: una fila se bloquea si GENUS tiene una entrega CONFIRMADA
 *    (`work_item_deliveries.status = ENTREGADO`, no archivada/anulada/eliminada)
 *    o un REMITO no-borrador (GENERADO) para ese cliente y fecha.
 *  - C/DIA: una fila se bloquea si existe producción con CIERRE DE ENVASADO real
 *    (`work_items.packaging_closed_at`) para ese producto en esa fecha.
 *  - Calendario: la celda de producto de un bloque se bloquea si esa producción
 *    ya tiene cierre de envasado en GENUS para ese día.
 *
 * Criterio conservador y FAIL-CLOSED: si el estado no se puede verificar (sin
 * base / consulta fallida) en ENTREGAS y C/DIA se bloquea todo — nunca se asume
 * "abierto". La coincidencia con el texto de la Sheet es por fecha + cliente
 * (ENTREGAS) o fecha + producto (C/DIA) normalizados: puede proteger de más,
 * jamás de menos.
 */
import "server-only";

import { and, eq, isNull, isNotNull, ne, or } from "drizzle-orm";
import { getDb, isDatabaseConfigured } from "@/lib/db/client";
import { remitos, workItemDeliveries, workItems } from "@/lib/db/schema";

export interface OperationalLocks {
  /** false = no se pudo verificar el estado real (se bloquea por seguridad). */
  known: boolean;
  deliveryLock(row: { date: string | null; client: string; product: string }): string | null;
  dayRecordLock(row: { date: string | null; product: string }): string | null;
  /** Producción cerrada en GENUS para ese producto ese día (celdas de calendario). */
  plannedProductionLock(row: { date: string | null; product: string }): string | null;
}

export const UNVERIFIABLE = "Estado operativo no verificable: edición bloqueada por seguridad.";

export const norm = (v: string): string =>
  v.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ");

const iso = (d: Date | string | null | undefined): string | null => (d ? new Date(d).toISOString().slice(0, 10) : null);

/** Construye los bloqueos a partir de datos ya leídos (puro → testeable sin base). */
export function buildOperationalLocks(data: {
  deliveries: Array<{ client: string | null; product: string; date: string | null }>;
  remitos: Array<{ client: string; date: string }>;
  closedWorkItems: Array<{ product: string; client: string | null; dates: string[] }>;
}): OperationalLocks {
  const delivered = new Map<string, string>();
  for (const d of data.deliveries) {
    if (d.date && d.client) delivered.set(`${d.date}|${norm(d.client)}`, "Entrega confirmada en GENUS (Entregados): no se modifica.");
  }
  for (const r of data.remitos) delivered.set(`${r.date}|${norm(r.client)}`, "Remito generado en GENUS para esta entrega: no se modifica.");
  const closed: Array<{ product: string; client: string; dates: Set<string> }> = data.closedWorkItems.map((w) => ({
    product: norm(w.product),
    client: norm(w.client ?? ""),
    dates: new Set(w.dates),
  }));
  const closedFor = (date: string | null, text: string, requireClient: boolean): string | null => {
    if (!date) return null;
    const t = norm(text);
    const hit = closed.some(
      (w) => w.dates.has(date) && w.product && (requireClient ? t === w.product : t.includes(w.product) || (w.client ? t.includes(`${w.client} ${w.product}`) : false))
    );
    return hit ? "Producción con cierre de envasado en GENUS: no se modifica." : null;
  };
  return {
    known: true,
    deliveryLock: ({ date, client }) => (date && client ? (delivered.get(`${date}|${norm(client)}`) ?? null) : null),
    dayRecordLock: ({ date, product }) => closedFor(date, product, false),
    plannedProductionLock: ({ date, product }) => closedFor(date, product, true),
  };
}

export const UNKNOWN_LOCKS: OperationalLocks = {
  known: false,
  deliveryLock: () => UNVERIFIABLE,
  dayRecordLock: () => UNVERIFIABLE,
  plannedProductionLock: () => null, // el calendario es planificación; sin estado se deja editable (con motivo si es histórico)
};

let override: OperationalLocks | null = null;
/** Solo tests / fixture local. */
export function setOperationalLocksForTests(l: OperationalLocks | null): void {
  override = l;
}

export async function loadOperationalLocks(): Promise<OperationalLocks> {
  if (override) return override;
  if (process.env.NODE_ENV !== "production" && process.env.GENUS_SEMANAS_FIXTURE_XLSX?.trim()) {
    return buildOperationalLocks({ deliveries: [], remitos: [], closedWorkItems: [] });
  }
  if (!isDatabaseConfigured()) return UNKNOWN_LOCKS;
  try {
    const db = getDb();
    const [deliveries, remitoRows, closed] = await Promise.all([
      db
        .select({
          client: workItemDeliveries.client,
          product: workItemDeliveries.product,
          planned: workItemDeliveries.plannedDeliveryDate,
          actual: workItemDeliveries.actualDeliveredAt,
        })
        .from(workItemDeliveries)
        .where(
          and(
            eq(workItemDeliveries.status, "ENTREGADO"),
            eq(workItemDeliveries.archived, false),
            isNull(workItemDeliveries.annulledAt),
            isNull(workItemDeliveries.deletedAt)
          )
        ),
      db.select({ client: remitos.clientDisplay, date: remitos.deliveryDate }).from(remitos).where(ne(remitos.status, "BORRADOR")),
      db
        .select({
          product: workItems.product,
          client: workItems.client,
          planned: workItems.plannedDate,
          plannedTo: workItems.plannedDateTo,
          closedAt: workItems.packagingClosedAt,
          decidedAt: workItems.qualityDecidedAt,
        })
        .from(workItems)
        // Cerrada = cierre de envasado real O decisión de Calidad registrada (no se saltean aprobaciones).
        .where(and(or(isNotNull(workItems.packagingClosedAt), isNotNull(workItems.qualityDecidedAt)), isNull(workItems.deletedAt))),
    ]);
    return buildOperationalLocks({
      deliveries: deliveries.flatMap((d) => [
        { client: d.client, product: d.product, date: iso(d.planned) },
        { client: d.client, product: d.product, date: iso(d.actual) },
      ]),
      remitos: remitoRows.map((r) => ({ client: r.client, date: String(r.date).slice(0, 10) })),
      closedWorkItems: closed.map((c) => ({
        product: c.product,
        client: c.client,
        dates: [iso(c.planned), iso(c.plannedTo), iso(c.closedAt), iso(c.decidedAt)].filter((x): x is string => Boolean(x)),
      })),
    });
  } catch {
    return UNKNOWN_LOCKS;
  }
}
