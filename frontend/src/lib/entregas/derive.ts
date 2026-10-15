/**
 * Entregas recuperadas de los trabajos — lógica PURA (sin React ni base de datos).
 *
 * El calendario no copia nada: en cada lectura une
 *   (a) las entregas PROGRAMADAS a mano (scheduled_deliveries*), con
 *   (b) lo que ya existe en los trabajos: entregas REALES (work_item_deliveries, fecha real) y trabajos vigentes con
 *       fecha de entrega (work_items.delivery_date) que nadie cargó en la pestaña Entregas.
 * Regla de oro: un trabajo = una sola aparición. Si el trabajo está vinculado (vínculo activo) a una entrega programada,
 * esa entrega es su contenedor y acá NO se crea otra. Jamás se inventa una fecha: sin fecha real o sin fecha de entrega
 * el trabajo no se ubica en el calendario (y el diagnóstico dice cuántos son y por qué).
 */
import { clientKey, deriveDeliveryStatus, deriveItemStatus, summarizeRealDeliveries } from "./rules";
import type {
  CalendarHidden,
  DateReviewFlag,
  DeliveryOrigin,
  EntregasRecoveryStats,
  ItemSector,
  LinkedWork,
  ScheduledDelivery,
  ScheduledDeliveryItem,
} from "./types";

export const NO_CLIENT_LABEL = "Sin cliente";
export const NO_PRODUCT_LABEL = "Sin producto";

/** Lo que se necesita saber de un trabajo (lectura fresca de work_items + sus entregas reales + su vínculo). */
export type WorkFacts = Omit<LinkedWork, "linkId" | "linkedAt" | "linkedBy" | "snapshot" | "delivered" | "deliveredQty" | "deliveredAt" | "cancelled"> & {
  /** Unidades entregables embaladas (work_items.deliverable_units), si hubo cierre. */
  deliverableUnits: number | null;
  /** Eliminado (tombstone) o cancelado operativamente. */
  cancelled: boolean;
  /** Tiene un vínculo ACTIVO con una entrega programada (su contenedor). */
  linked: boolean;
  /** Fecha de la entrega programada que lo contiene (solo si está vinculado). */
  containerDate: string | null;
  /** Estado de la entrega programada que lo contiene. */
  containerCancelled: boolean;
  /** Producción quitó del calendario su aparición «Desde trabajo» (activo = no se muestra). */
  hidden?: CalendarHidden | null;
};

/**
 * Fechas contradictorias de un trabajo (solo se MARCAN para Producción; nunca se corrigen solas):
 *  - una entrega real guardada exactamente a las 00:00 UTC (fecha sin hora → en Argentina cae el día anterior);
 *  - fecha de entrega anterior a la de producción;
 *  - trabajo vinculado con una fecha de entrega distinta de la de su entrega programada (y todavía sin entregar).
 */
export function workReviewFlags(
  w: Pick<WorkFacts, "realDeliveries" | "deliveryDate" | "plannedDate">,
  opts: { containerDate?: string | null; delivered?: boolean; event?: WorkFacts["realDeliveries"][number] } = {}
): DateReviewFlag[] {
  const flags: DateReviewFlag[] = [];
  const events = opts.event ? [opts.event] : w.realDeliveries;
  if (events.some((e) => e.utcMidnight)) flags.push("entrega_hora_utc_medianoche");
  if (!opts.event && w.deliveryDate && w.plannedDate && w.deliveryDate < w.plannedDate) flags.push("entrega_antes_de_produccion");
  if (!opts.event && !opts.delivered && opts.containerDate && w.deliveryDate && w.deliveryDate !== opts.containerDate) flags.push("trabajo_con_otra_fecha");
  return flags;
}

const inRange = (iso: string | null, range: { from: string; to: string }): iso is string => !!iso && iso >= range.from && iso <= range.to;

/** El trabajo como lo ven las tarjetas: con el resumen de lo realmente entregado (y los datos del vínculo, si lo hay). */
export function toLinkedWork(
  w: WorkFacts,
  opts: { deliveredAt?: string | null; link?: Pick<LinkedWork, "linkId" | "linkedAt" | "linkedBy" | "snapshot"> } = {}
): LinkedWork {
  const s = summarizeRealDeliveries(w);
  const rest: Partial<WorkFacts> = { ...w };
  delete rest.deliverableUnits;
  delete rest.linked;
  delete rest.containerDate;
  delete rest.containerCancelled;
  delete rest.hidden;
  return {
    ...(rest as Omit<WorkFacts, "deliverableUnits" | "linked" | "containerDate" | "containerCancelled">),
    ...(opts.link ?? { linkId: `derived:${w.workItemId}`, linkedAt: "", linkedBy: "", snapshot: {} }),
    delivered: s.delivered,
    deliveredQty: s.deliveredQty,
    deliveredAt: opts.deliveredAt ?? s.deliveredAt,
  };
}

function makeItem(w: WorkFacts, kind: "registrada" | "programada", event?: WorkFacts["realDeliveries"][number]): ScheduledDeliveryItem {
  const work = toLinkedWork(w, { deliveredAt: event?.date ?? null });
  const item: ScheduledDeliveryItem = {
    id: event ? `work:${w.workItemId}:${event.id}` : `work:${w.workItemId}`,
    deliveryId: "",
    product: w.product?.trim() || NO_PRODUCT_LABEL,
    quantity: w.plannedQuantity,
    unit: w.unit,
    sector: (w.sector as ItemSector | null) ?? null,
    plannedProductionDate: w.plannedDate,
    lot: event?.lote ?? w.packagingLote,
    vto: event?.vto ?? w.packagingVto,
    notes: w.notes,
    position: 0,
    version: 0,
    createdAt: "",
    updatedAt: "",
    works: [work],
    status: "programada",
  };
  // Con entrega real registrada nunca queda «lista»: es entregada (o parcial si falta entregar saldo).
  item.status = kind === "registrada" ? (work.delivered ? "entregada" : "entrega_parcial") : deriveItemStatus(item);
  const flags = workReviewFlags(w, { event });
  if (flags.length) item.reviewFlags = flags;
  if (kind === "programada" && w.hidden) item.hidden = w.hidden;
  return item;
}

/**
 * Apariciones recuperadas de los trabajos NO vinculados dentro de `range` (inclusive):
 *  - «Entrega registrada»: una por cada entrega real, ubicada en su FECHA REAL (jamás la de fin de producción).
 *  - «Desde trabajo»: el trabajo vigente que todavía no se entregó completo, en su fecha de entrega programada.
 * Agrupadas por cliente normalizado + fecha + origen (el calendario muestra al cliente una sola vez por día).
 */
export function buildDerivedDeliveries(
  works: readonly WorkFacts[],
  range: { from: string; to: string },
  opts: { includeHidden?: boolean; includeRealDeliveries?: boolean } = {}
): ScheduledDelivery[] {
  const groups = new Map<string, ScheduledDelivery>();
  const add = (w: WorkFacts, date: string, origin: DeliveryOrigin, item: ScheduledDeliveryItem) => {
    const client = w.client?.trim() || NO_CLIENT_LABEL;
    const key = `${origin}:${clientKey(client)}:${date}`;
    let d = groups.get(key);
    if (!d) {
      d = {
        id: `derived:${key}`,
        client,
        deliveryDate: date,
        responsible: null,
        notes: null,
        state: "programada",
        rescheduleCount: 0,
        version: 0,
        cancelledAt: null,
        cancelledBy: null,
        cancelReason: null,
        createdBy: "",
        createdAt: "",
        updatedAt: "",
        items: [],
        status: "programada",
        origin,
      };
      groups.set(key, d);
    }
    item.deliveryId = d.id;
    item.position = d.items.length;
    d.items.push(item);
  };

  for (const w of works) {
    if (w.linked) continue; // ya tiene contenedor: no se duplica
    const summary = summarizeRealDeliveries(w);
    // El calendario es una AGENDA de lo pendiente: las entregas físicas ya hechas se consultan en Entregados/Historial
    // (no se borran). Solo se listan si se piden explícitamente.
    if (opts.includeRealDeliveries) {
      for (const ev of w.realDeliveries) {
        if (inRange(ev.date, range)) add(w, ev.date, "entrega_registrada", makeItem(w, "registrada", ev));
      }
    }
    // «Quitada del calendario» por Producción: no vuelve a aparecer (solo se lista si se piden las quitadas, para restaurar).
    if (w.hidden && !opts.includeHidden) continue;
    if (!w.cancelled && !summary.delivered && inRange(w.deliveryDate, range)) add(w, w.deliveryDate!, "desde_trabajo", makeItem(w, "programada"));
  }

  const out = [...groups.values()];
  for (const d of out) {
    d.items.sort((a, b) => a.product.localeCompare(b.product, "es", { sensitivity: "base" }) || a.id.localeCompare(b.id));
    d.items.forEach((it, i) => { it.position = i; });
    d.status = deriveDeliveryStatus(d);
  }
  return out.sort((a, b) => a.deliveryDate.localeCompare(b.deliveryDate) || a.client.localeCompare(b.client, "es", { sensitivity: "base" }) || (a.origin ?? "").localeCompare(b.origin ?? ""));
}

/**
 * Diagnóstico (solo lectura): cuántas entregas históricas y futuras se recuperaron automáticamente y cuántos trabajos
 * quedaron fuera del calendario y por qué. `sinFechaDeEntrega` viene contado aparte en la base (son muchos y no hace falta
 * traerlos).
 */
export function computeRecoveryStats(works: readonly WorkFacts[], today: string, sinFechaDeEntrega: number): EntregasRecoveryStats {
  const stats: EntregasRecoveryStats = {
    historicas: { total: 0, sueltas: 0, enEntregaProgramada: 0 },
    futuras: { total: 0, sueltas: 0, enEntregaProgramada: 0 },
    vencidasSinEntregar: 0,
    fuera: { entregadoSinFechaReal: 0, sinFechaDeEntrega, canceladosOEliminados: 0 },
  };
  for (const w of works) {
    const summary = summarizeRealDeliveries(w);
    if (w.realDeliveries.length > 0) {
      stats.historicas.total += 1;
      if (w.linked) stats.historicas.enEntregaProgramada += 1;
      else stats.historicas.sueltas += 1;
    } else if (w.operationalStatus === "entregado" && !w.cancelled) {
      stats.fuera.entregadoSinFechaReal += 1;
    }
    if (w.cancelled) {
      if (w.deliveryDate && w.realDeliveries.length === 0) stats.fuera.canceladosOEliminados += 1;
      continue;
    }
    if (summary.delivered) continue;
    // Pendiente de entregar: en su entrega programada (contenedor) o en su propia fecha de entrega.
    const date = w.linked ? (w.containerCancelled ? null : w.containerDate) : w.deliveryDate;
    if (!date) continue;
    if (date >= today) {
      stats.futuras.total += 1;
      if (w.linked) stats.futuras.enEntregaProgramada += 1;
      else stats.futuras.sueltas += 1;
    } else {
      stats.vencidasSinEntregar += 1;
    }
  }
  return stats;
}
