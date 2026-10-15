/**
 * Entregas programadas — reglas puras (sin React ni servidor): validación, estados derivados, candidatos para vincular
 * y diferencias entre lo programado y el trabajo vinculado. El servidor y el navegador usan estas mismas funciones.
 */
import { clienteRelation, productoRelation } from "@/lib/asignacion-lotes/resolve-for-work-item";
import {
  DELIVERY_SECTORS,
  isDerivedDelivery,
  type DeliveryDisplayStatus,
  type DeliverySector,
  type DeliverySuggestion,
  type LinkedWork,
  type RealDelivery,
  type ScheduledDelivery,
  type ScheduledDeliveryItem,
  type WorkDivergence,
} from "./types";

export const MAX_DELIVERY_ITEMS = 40;
export const MIN_ENTREGAS_REASON = 8;

export interface DeliveryItemInput {
  /** Si viene, se actualiza ese producto; si no, es uno nuevo. */
  id?: string;
  product: string;
  quantity?: string | null;
  unit?: string | null;
  sector?: string | null;
  plannedProductionDate?: string | null;
  lot?: string | null;
  vto?: string | null;
  notes?: string | null;
}

export interface DeliveryInput {
  client: string;
  deliveryDate: string;
  responsible?: string | null;
  notes?: string | null;
  items: DeliveryItemInput[];
}

export interface CleanDeliveryItem {
  id?: string;
  product: string;
  quantity: string | null;
  unit: string | null;
  sector: DeliverySector | null;
  plannedProductionDate: string | null;
  lot: string | null;
  vto: string | null;
  notes: string | null;
}
export interface CleanDelivery {
  client: string;
  deliveryDate: string;
  responsible: string | null;
  notes: string | null;
  items: CleanDeliveryItem[];
}

const fold = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
export const clientKey = fold;

function isRealIso(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d && y >= 2000 && y <= 2100;
}

const clean = (v: string | null | undefined): string | null => {
  const t = (v ?? "").trim();
  return t ? t : null;
};

/** Cantidad con formato es-AR («1.200», «1200,5»). null si está vacía; undefined si es inválida. */
export function parseQuantity(raw: string | null | undefined): number | null | undefined {
  const text = (raw ?? "").trim().replace(/\s| /g, "");
  if (!text) return null;
  let normalized: string;
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(text)) normalized = text.replace(/\./g, "").replace(",", ".");
  else if (/^\d+(,\d+)?$/.test(text)) normalized = text.replace(",", ".");
  else if (/^\d+(\.\d+)?$/.test(text)) normalized = text;
  else return undefined;
  const n = Number(normalized);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/**
 * Valida y limpia una entrega. Los datos que todavía no se conocen quedan pendientes (null): nunca se inventan.
 * Obligatorios: cliente, fecha de entrega y al menos un producto con nombre.
 */
export function validateDeliveryInput(input: DeliveryInput): { ok: true; value: CleanDelivery } | { ok: false; message: string } {
  const client = (input.client ?? "").trim();
  if (!client) return { ok: false, message: "El cliente es obligatorio." };
  if (client.length > 200) return { ok: false, message: "El nombre del cliente es demasiado largo." };
  const deliveryDate = (input.deliveryDate ?? "").trim();
  if (!isRealIso(deliveryDate)) return { ok: false, message: "La fecha de entrega no es válida." };
  if (!Array.isArray(input.items) || input.items.length === 0) return { ok: false, message: "Agregá al menos un producto." };
  if (input.items.length > MAX_DELIVERY_ITEMS) return { ok: false, message: `Máximo ${MAX_DELIVERY_ITEMS} productos por entrega.` };
  const items: CleanDeliveryItem[] = [];
  for (let i = 0; i < input.items.length; i += 1) {
    const it = input.items[i]!;
    const n = i + 1;
    const product = (it.product ?? "").trim();
    if (!product) return { ok: false, message: `Producto ${n}: el nombre es obligatorio.` };
    const q = parseQuantity(it.quantity);
    if (q === undefined) return { ok: false, message: `Producto ${n} (${product}): la cantidad no es un número válido.` };
    const sector = clean(it.sector);
    if (sector && !(DELIVERY_SECTORS as readonly string[]).includes(sector)) {
      return { ok: false, message: `Producto ${n} (${product}): el sector debe ser Envasado Masivo o Premium.` };
    }
    const prod = clean(it.plannedProductionDate);
    if (prod && !isRealIso(prod)) return { ok: false, message: `Producto ${n} (${product}): la fecha de producción no es válida.` };
    const vto = clean(it.vto);
    items.push({
      id: it.id,
      product,
      quantity: q === null ? null : String(it.quantity).trim(),
      unit: clean(it.unit),
      sector: (sector as DeliverySector | null) ?? null,
      plannedProductionDate: prod,
      lot: clean(it.lot),
      vto,
      notes: clean(it.notes),
    });
  }
  return { ok: true, value: { client, deliveryDate, responsible: clean(input.responsible), notes: clean(input.notes), items } };
}

// ───────────────────────── Estados ─────────────────────────

/** Estados del trabajo que indican que la producción/envasado terminó (ya no hay nada más que fabricar). */
export const FINISHED_WORK = new Set(["completo", "revision", "entregado", "codificado_completo"]);

const STAGE_ORDER: DeliveryDisplayStatus[] = [
  "programada",
  "produccion_pendiente",
  "produccion_en_proceso",
  "lista_para_entregar",
  "entrega_parcial",
  "entregada",
];

const EPS = 1e-6;

/**
 * Cuánto se entregó REALMENTE de un trabajo y si esa entrega lo completa. Se mira lo mismo que usa el flujo de entrega
 * para fijar la cantidad entregada: lo embalado (unidades entregables), si no la cantidad final declarada y si no la
 * planificada. Si las cantidades no son numéricas, cualquier entrega real cuenta como completa (no se puede comparar).
 */
export function summarizeRealDeliveries(w: {
  plannedQuantity: string | null;
  finishedQty: string | null;
  deliverableUnits?: number | null;
  realDeliveries: readonly RealDelivery[];
}): { deliveredQty: number | null; deliveredAt: string | null; delivered: boolean } {
  if (w.realDeliveries.length === 0) return { deliveredQty: null, deliveredAt: null, delivered: false };
  const nums = w.realDeliveries.map((d) => parseQuantity(d.quantity)).filter((n): n is number => typeof n === "number");
  const deliveredQty = nums.length ? nums.reduce((a, b) => a + b, 0) : null;
  const deliveredAt = w.realDeliveries.map((d) => d.date).sort().at(-1) ?? null;
  const targetRaw = w.deliverableUnits ?? parseQuantity(w.finishedQty) ?? parseQuantity(w.plannedQuantity);
  const target = typeof targetRaw === "number" ? targetRaw : null;
  const delivered = deliveredQty == null || target == null || target <= 0 || deliveredQty + EPS >= target;
  return { deliveredQty, deliveredAt, delivered };
}

/**
 * Estado de un producto según sus trabajos vinculados (los cancelados no cuentan). La aprobación de Calidad NO interviene.
 * - «Entregada» SOLO si existe la entrega real de TODOS los trabajos y la cantidad programada está cubierta.
 * - Con entregas reales pero faltando entregar (saldo pendiente): «Entrega parcial». Nunca «Entregada» hasta completar.
 * - Trabajos terminados (completo/revisión/entregado/codificado completo) y sin entregar: «Lista para entregar».
 * - Si los trabajos cubren menos que la cantidad programada, todavía falta producir: «en proceso» como máximo.
 */
export function deriveItemStatus(item: Pick<ScheduledDeliveryItem, "quantity" | "works">): DeliveryDisplayStatus {
  const works = item.works.filter((w) => !w.cancelled);
  if (works.length === 0) return "programada";
  const target = parseQuantity(item.quantity);
  const covered = works.reduce((sum, w) => sum + (parseQuantity(w.plannedQuantity) ?? 0), 0);
  const fullyCovered = typeof target !== "number" || target === 0 || covered >= target;

  const anyStarted = works.some((w) => w.operationalStatus === "en_curso" || FINISHED_WORK.has(w.operationalStatus));
  const allFinished = works.every((w) => FINISHED_WORK.has(w.operationalStatus));
  const allDelivered = works.every((w) => w.delivered);
  const anyDelivered = works.some((w) => w.delivered || (w.deliveredQty ?? 0) > 0 || w.realDeliveries.length > 0);

  if (allDelivered && fullyCovered) return "entregada";
  if (anyDelivered) return "entrega_parcial";
  if (!fullyCovered) return anyStarted ? "produccion_en_proceso" : "produccion_pendiente";
  if (allFinished) return "lista_para_entregar";
  if (anyStarted) return "produccion_en_proceso";
  return "produccion_pendiente";
}

/** Cantidades de un producto: planificada, producida, entregada y pendiente (null = no registrado / no numérico). */
export function itemQuantities(item: Pick<ScheduledDeliveryItem, "quantity" | "works">): {
  planned: number | null;
  produced: number | null;
  delivered: number | null;
  pending: number | null;
} {
  const works = item.works.filter((w) => !w.cancelled);
  const fromWorks = works.map((w) => parseQuantity(w.plannedQuantity)).filter((n): n is number => typeof n === "number");
  const itemQty = parseQuantity(item.quantity);
  const planned = typeof itemQty === "number" ? itemQty : fromWorks.length ? fromWorks.reduce((a, b) => a + b, 0) : null;
  const sum = (vals: Array<number | null>) => {
    const nums = vals.filter((n): n is number => typeof n === "number");
    return nums.length ? nums.reduce((a, b) => a + b, 0) : null;
  };
  const produced = sum(works.map((w) => { const q = parseQuantity(w.finishedQty); return typeof q === "number" ? q : null; }));
  const delivered = sum(works.map((w) => w.deliveredQty));
  const pending = planned == null ? null : Math.max(0, planned - (delivered ?? 0));
  return { planned, produced, delivered, pending };
}

/** Estado de la entrega completa: cancelada, o la etapa MÁS ATRASADA entre sus productos. */
export function deriveDeliveryStatus(delivery: Pick<ScheduledDelivery, "state" | "items">): DeliveryDisplayStatus {
  if (delivery.state === "cancelada") return "cancelada";
  if (delivery.items.length === 0) return "programada";
  let min = STAGE_ORDER.length - 1;
  for (const it of delivery.items) min = Math.min(min, STAGE_ORDER.indexOf(it.status));
  return STAGE_ORDER[Math.max(0, min)]!;
}

// ───────────────────────── Vinculación ─────────────────────────

/**
 * Entregas candidatas para un trabajo que se está asignando (cliente + producto + sector). Determinístico (mismas
 * reglas que Asignación de Lotes): nunca elige solo; devuelve TODAS las opciones y Producción confirma cuál es.
 * Se excluyen entregas canceladas, productos eliminados y de otro sector. Un producto ya cubierto sigue disponible
 * (una entrega puede completarse con varios trabajos), indicando cuánto está cubierto.
 */
export function matchDeliveryCandidates(
  deliveries: readonly ScheduledDelivery[],
  criteria: { client: string; product: string; sector: string | null }
): DeliverySuggestion[] {
  if (!criteria.client.trim() || !criteria.product.trim()) return [];
  const out: DeliverySuggestion[] = [];
  for (const d of deliveries) {
    if (d.state === "cancelada" || isDerivedDelivery(d)) continue; // lo recuperado de los trabajos no se «vincula»
    const clientRel = clienteRelation(criteria.client, d.client);
    if (clientRel === "NONE") continue;
    for (const it of d.items) {
      if (criteria.sector && it.sector && it.sector !== criteria.sector) continue;
      const prodRel = productoRelation({ producto: it.product, codigo: "", marca: d.client }, criteria.product);
      if (prodRel === "NONE") continue;
      const works = it.works.filter((w) => !w.cancelled);
      const covered = works.reduce((s, w) => s + (parseQuantity(w.plannedQuantity) ?? 0), 0);
      out.push({
        deliveryId: d.id,
        itemId: it.id,
        client: d.client,
        deliveryDate: d.deliveryDate,
        product: it.product,
        quantity: it.quantity,
        unit: it.unit,
        sector: it.sector as DeliverySector | null,
        plannedProductionDate: it.plannedProductionDate,
        lot: it.lot,
        vto: it.vto,
        notes: it.notes,
        linkedWorks: works.length,
        coveredQuantity: works.length ? covered : null,
        match: clientRel === "EXACT" && prodRel === "EXACT" ? "exacta" : "compatible",
      });
    }
  }
  // Más exactas primero, luego la entrega más próxima.
  return out.sort((a, b) => (a.match === b.match ? a.deliveryDate.localeCompare(b.deliveryDate) : a.match === "exacta" ? -1 : 1));
}

const norm = (v: string | null | undefined) => (v ?? "").trim();
const numEq = (a: string | null | undefined, b: string | null | undefined) => {
  const x = parseQuantity(a);
  const y = parseQuantity(b);
  return typeof x === "number" && typeof y === "number" ? x === y : norm(a) === norm(b);
};
const textEq = (a: string | null | undefined, b: string | null | undefined) => norm(a) === norm(b);
const unitEq = (a: string | null | undefined, b: string | null | undefined) => norm(a).toLowerCase() === norm(b).toLowerCase();

/** Lo que cuenta de una entrega para detectar cambios posteriores a la asignación. */
export function snapshotOf(
  delivery: Pick<ScheduledDelivery, "deliveryDate">,
  item: Pick<ScheduledDeliveryItem, "quantity" | "unit" | "lot" | "vto">
): Record<WorkDivergence["field"], string | null> {
  return {
    plannedQuantity: item.quantity ?? null,
    unit: item.unit ?? null,
    deliveryDate: delivery.deliveryDate,
    packagingLote: item.lot ?? null,
    packagingVto: item.vto ?? null,
  };
}

/**
 * Qué CAMBIÓ en la entrega DESPUÉS de asignar el trabajo y todavía no está reflejado en él. Un campo solo se informa si:
 *  - la entrega lo tiene cargado (lo pendiente nunca pisa nada),
 *  - difiere de lo que la entrega decía cuando se vinculó el trabajo (no se alerta por diferencias previas ni por lo que
 *    el operario/Producción editaron a mano en el trabajo), y
 *  - difiere de lo que hoy tiene el trabajo.
 * La cantidad solo se compara si el producto lo cubre UN solo trabajo: con varios trabajos cada uno cubre una parte y la
 * cobertura se muestra aparte. NUNCA incluye la cantidad realizada ni avances. Producción confirma antes de aplicar.
 */
export function computeWorkDivergences(
  delivery: Pick<ScheduledDelivery, "deliveryDate">,
  item: Pick<ScheduledDeliveryItem, "quantity" | "unit" | "lot" | "vto">,
  work: Pick<LinkedWork, "plannedQuantity" | "unit" | "deliveryDate" | "packagingLote" | "packagingVto" | "snapshot">,
  activeWorks = 1
): WorkDivergence[] {
  const out: WorkDivergence[] = [];
  const add = (
    field: WorkDivergence["field"],
    label: string,
    current: string | null,
    workValue: string | null,
    eq: (a: string | null | undefined, b: string | null | undefined) => boolean
  ) => {
    if (!norm(current)) return;
    const snap = work.snapshot?.[field];
    const baseline = field in (work.snapshot ?? {});
    if (baseline && eq(current, snap)) return; // no cambió desde que se asignó
    if (eq(current, workValue)) return; // el trabajo ya lo tiene
    out.push({ field, label, itemValue: norm(current), workValue: norm(workValue) || "—" });
  };
  if (activeWorks <= 1) add("plannedQuantity", "Cantidad planificada", item.quantity, work.plannedQuantity, numEq);
  add("unit", "Unidad", item.unit, work.unit, unitEq);
  add("deliveryDate", "Fecha de entrega", delivery.deliveryDate, work.deliveryDate, textEq);
  add("packagingLote", "Lote", item.lot, work.packagingLote, textEq);
  add("packagingVto", "Vencimiento", item.vto, work.packagingVto, textEq);
  return out;
}

/** Cuánto de la cantidad programada cubren los trabajos vinculados (si ambos son números). */
export function coverageOf(item: Pick<ScheduledDeliveryItem, "quantity" | "works">): { target: number | null; covered: number; missing: number | null } {
  const target = parseQuantity(item.quantity);
  const covered = item.works.filter((w) => !w.cancelled).reduce((sum, w) => sum + (parseQuantity(w.plannedQuantity) ?? 0), 0);
  const t = typeof target === "number" ? target : null;
  return { target: t, covered, missing: t == null ? null : Math.max(0, t - covered) };
}

/** Texto del motivo auditado cuando se reprograma/cancela: obligatorio y con largo mínimo. */
export function validateReason(reason: unknown): { ok: true; value: string } | { ok: false; message: string } {
  const t = typeof reason === "string" ? reason.trim() : "";
  if (t.length < MIN_ENTREGAS_REASON) return { ok: false, message: `Escribí el motivo (mín. ${MIN_ENTREGAS_REASON} caracteres): queda auditado.` };
  return { ok: true, value: t };
}

/** Agrupa las entregas de un día por cliente (una sola entrada por cliente, aunque tenga varios productos/entregas). */
export function groupDeliveriesByClient(deliveries: readonly ScheduledDelivery[]): Array<{ client: string; deliveries: ScheduledDelivery[] }> {
  const map = new Map<string, { client: string; deliveries: ScheduledDelivery[] }>();
  for (const d of deliveries) {
    const key = clientKey(d.client);
    const cur = map.get(key);
    if (cur) cur.deliveries.push(d);
    else map.set(key, { client: d.client, deliveries: [d] });
  }
  return [...map.values()].sort((a, b) => a.client.localeCompare(b.client, "es", { sensitivity: "base" }));
}
