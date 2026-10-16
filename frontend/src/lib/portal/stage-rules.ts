/**
 * Etapas del Portal de Clientes: traducción PURA de los trabajos reales de GENUS OS al estado que ve el cliente.
 * Sin E/S. Todo lo que no se puede verificar queda en null: NUNCA se inventan fechas, estados ni cantidades.
 *
 * Etapas visibles (4): ELABORACION → ENVASADO → LISTO (para entregar) → ENTREGADO.
 *  - Codificado NO es una etapa propia para el cliente: es «proceso de finalización» dentro de ENVASADO. Un producto
 *    que pasó de Envasado a Codificado sigue en proceso y nunca figura como entregado.
 *  - Una transferencia interna entre sectores (Elaboración → Envasado → Codificado) NO es una entrega. Solo las entregas
 *    finales registradas en GENUS OS (work_item_deliveries / líneas) cuentan como entregado.
 *
 * Reglas (por producto = conjunto de trabajos vivos de un mismo pedido-producto):
 *  1. Si hay trabajos de Envasado/Codificado, mandan ellos (la Elaboración ya se envió: su estado «completo» es traspaso).
 *  2. ENTREGADO: todos los trabajos de Envasado/Codificado tienen su entrega final completa.
 *  3. LISTO: SOLO por confirmación EXPLÍCITA («Marcar listo para entregar») de un usuario autorizado del último sector.
 *     Que un sector haya terminado su tarea NO alcanza (ni hay plazos automáticos): un trabajo terminado sin confirmación
 *     queda «en proceso de finalización». La disponibilidad son marcas con cantidad (`marks`): disponible = marcado −
 *     entregado. Con una parte lista y otra pendiente el producto NO es LISTO: muestra lo disponible y lo pendiente.
 *  4. Con varios trabajos se muestra la etapa MENOS avanzada, y la cantidad ya disponible aparte (entrega parcial).
 *  5. Cantidades: solicitada, disponible (marcada y aún sin entregar), entregada y pendiente de producción o finalización
 *     (solicitada − entregada − disponible, nunca negativa); no es «entregado» hasta completar.
 */
import { parseQuantity } from "@/lib/entregas/rules";
import { availabilityFigures } from "./availability-rules";

export type PortalStageId = "ELABORACION" | "ENVASADO" | "LISTO" | "ENTREGADO";
/** FINALIZACION = en Codificado (o recién terminado en Envasado, a la espera de definir destino). */
export type PortalSubstage = "FINALIZACION" | "TERMINADA_EN_TRASPASO" | null;
export type PortalWorkSector = "ELABORACION" | "ENVASADO_MASIVO" | "ENVASADO_PREMIUM" | "CODIFICADO";

export const STAGE_ORDER: readonly PortalStageId[] = ["ELABORACION", "ENVASADO", "LISTO", "ENTREGADO"];
/** Días hábiles estimados por etapa (solo orientativos; no son una fecha de entrega comprometida). */
export const STAGE_ESTIMATE_DAYS: Partial<Record<PortalStageId, number>> = { ELABORACION: 10, ENVASADO: 5 };

export type DeliveryFact = {
  /** `line:<id>` (envío físico) o `delivery:<id>` (registro histórico sin líneas). Único por entrega. */
  key: string;
  at: string;
  quantity: number | null;
  unit: string | null;
};

export type WorkFact = {
  id: string;
  sector: PortalWorkSector;
  /** operational_status del trabajo. */
  status: string;
  /** 'native' | 'import_sheets' | null */
  source: string | null;
  createdAt: string | null;
  /** Evento ITEM_ASSIGNED (asignación real por Producción). */
  assignedAt: string | null;
  /** Evento RECEIVED_FROM_ELABORACION (ingreso real a Envasado por el circuito). */
  receivedFromElaboracionAt: string | null;
  completedAt: string | null;
  progressUpdatedAt: string | null;
  sentToCodificadoAt: string | null;
  viaCodificado: boolean;
  plannedQuantity: string | null;
  unit: string | null;
  finishedQty: string | null;
  deliverableUnits: number | null;
  packagingTotalUnits: number | null;
  /** Entregas finales vigentes (no anuladas) de este trabajo. */
  deliveries: DeliveryFact[];
  /** Marcas de disponibilidad vigentes (no retiradas): confirmaciones explícitas de «Listo para entregar». */
  marks: MarkFact[];
  /** Unidades ya entregadas al hacerse la primera confirmación del trabajo (null = nunca hubo una). */
  markBase?: number | null;
};

export type MarkFact = { id: string; quantity: number; at: string };

export type StartSource = "asignacion" | "ingreso_envasado" | "carga_nativa";

/** Fechas REALES verificables de cada hito (null = sin dato verificable: no se inventa). */
export type Milestones = { elaboracion: string | null; envasado: string | null; listo: string | null; entregado: string | null };

export type ProductStage = {
  stage: PortalStageId;
  substage: PortalSubstage;
  /** Ingreso REAL verificable a la etapa actual (null = no hay dato verificable: no se inventa). */
  stageStartedAt: string | null;
  stageStartSource: StartSource | null;
  quantities: {
    unit: string | null;
    /** Cantidad solicitada (suma de lo planificado en los trabajos de la etapa vigente). */
    requested: number | null;
    delivered: number;
    /** Lo que falta producir o finalizar: solicitado − entregado − disponible (nunca negativo). */
    pending: number | null;
    /** Lo que un usuario autorizado confirmó como disponible y todavía no se entregó. */
    available: number;
    /** true si hay trabajos con unidades distintas: no se suma entre unidades. */
    mixedUnits: boolean;
  };
  partialDelivery: boolean;
  /** Fecha de la última entrega final registrada. */
  lastDeliveryAt: string | null;
  milestones: Milestones;
  /** Marcas de disponibilidad con cantidad aún sin entregar (disparan el aviso «listo», una vez por marca). */
  readyWorks: Array<{ workItemId: string; markId: string; available: number; readySince: string }>;
  /** Fecha y hora de la primera disponibilidad vigente (null si no hay). */
  availableSince: string | null;
};

const FINISHED = new Set(["completo", "revision", "entregado"]);
const EPS = 1e-6;

const num = (raw: string | null | undefined): number | null => {
  const n = parseQuantity(raw);
  return typeof n === "number" ? n : null;
};

/**
 * Cantidad total a entregar de un trabajo. Terminado: unidades entregables → embaladas → final declarada → planificada
 * (misma regla que la entrega). En curso: lo PEDIDO (planificada) manda: «Guardar avance» informa lo realizado hasta ahora,
 * no el total que pidió el cliente.
 */
export function workTarget(w: Pick<WorkFact, "deliverableUnits" | "packagingTotalUnits" | "finishedQty" | "plannedQuantity"> & { status?: string }): number | null {
  const inProgress = w.status != null && !FINISHED.has(w.status);
  const candidates = [
    inProgress ? num(w.plannedQuantity) : null,
    w.deliverableUnits != null && Number.isFinite(w.deliverableUnits) ? w.deliverableUnits : null,
    w.packagingTotalUnits != null && Number.isFinite(w.packagingTotalUnits) ? w.packagingTotalUnits : null,
    num(w.finishedQty),
    num(w.plannedQuantity),
  ];
  for (const c of candidates) if (c != null && c > 0) return c;
  return null;
}

const sumDelivered = (w: WorkFact) => w.deliveries.reduce((s, d) => s + (d.quantity ?? 0), 0);
const hasDelivery = (w: WorkFact) => w.deliveries.length > 0;

function isDeliveredComplete(w: WorkFact): boolean {
  if (w.status !== "entregado") return false;
  // Marcado entregado pero sin ninguna entrega real registrada: no hay prueba de entrega física.
  if (!hasDelivery(w)) return false;
  const target = workTarget(w);
  const delivered = sumDelivered(w);
  return target == null || delivered + EPS >= target || w.deliveries.every((d) => d.quantity == null);
}

const earliest = (values: Array<string | null>): string | null => {
  const v = values.filter((x): x is string => Boolean(x) && !Number.isNaN(new Date(x as string).getTime())).sort();
  return v[0] ?? null;
};

/** Ingreso real verificable a Elaboración. */
function elaboracionStart(w: WorkFact): { at: string | null; source: StartSource | null } {
  if (w.assignedAt) return { at: w.assignedAt, source: "asignacion" };
  // Un trabajo cargado en el sistema nativo se crea al asignarlo; uno importado de una hoja no tiene fecha real.
  if (w.source === "native" && w.createdAt) return { at: w.createdAt, source: "carga_nativa" };
  return { at: null, source: null };
}

/** Ingreso real verificable a Envasado. */
function envasadoStart(w: WorkFact): { at: string | null; source: StartSource | null } {
  if (w.receivedFromElaboracionAt) return { at: w.receivedFromElaboracionAt, source: "ingreso_envasado" };
  if (w.assignedAt) return { at: w.assignedAt, source: "asignacion" };
  if (w.source === "native" && w.createdAt) return { at: w.createdAt, source: "carga_nativa" };
  return { at: null, source: null };
}


function milestonesOf(elab: readonly WorkFact[], down: readonly WorkFact[], entregadoAt: string | null): Milestones {
  const readySinces = down.flatMap((w) => w.marks.map((m) => m.at));
  return {
    elaboracion: earliest(elab.map((w) => elaboracionStart(w).at)),
    envasado: earliest(down.map((w) => envasadoStart(w).at)),
    listo: earliest(readySinces),
    entregado: entregadoAt,
  };
}


/**
 * Etapa de un producto a partir de sus trabajos VIVOS (sin cancelados ni borrados). null si no hay trabajos.
 */
// Sin reloj: ninguna regla depende del tiempo transcurrido (la disponibilidad es una confirmación explícita).
export function deriveProductStage(works: readonly WorkFact[]): ProductStage | null {
  if (works.length === 0) return null;
  const elab = works.filter((w) => w.sector === "ELABORACION");
  const down = works.filter((w) => w.sector !== "ELABORACION");

  const units = new Set(
    (down.length ? down : elab).map((w) => (w.unit ?? "").trim().toLowerCase()).filter(Boolean)
  );
  const mixedUnits = units.size > 1;
  const unit = units.size === 1 ? ((down.length ? down : elab).find((w) => w.unit)?.unit ?? null) : null;

  // ── Solo Elaboración (todavía no pasó a Envasado) ────────────────────────────────────────────────────────────────
  if (down.length === 0) {
    const active = elab.filter((w) => !FINISHED.has(w.status));
    const base = active.length ? active : elab;
    const starts = base.map(elaboracionStart).filter((s) => s.at);
    const start = starts.sort((a, b) => (a.at! < b.at! ? -1 : 1))[0] ?? { at: null, source: null };
    const requested = sumKnown(elab.map((w) => num(w.plannedQuantity)));
    return {
      stage: "ELABORACION",
      substage: active.length === 0 ? "TERMINADA_EN_TRASPASO" : null,
      stageStartedAt: start.at,
      stageStartSource: start.source,
      quantities: { unit, requested: mixedUnits ? null : requested, delivered: 0, pending: mixedUnits ? null : requested, available: 0, mixedUnits },
      partialDelivery: false,
      lastDeliveryAt: null,
      milestones: milestonesOf(elab, [], null),
      readyWorks: [],
      availableSince: null,
    };
  }

  // ── Envasado / Codificado: mandan sus trabajos ───────────────────────────────────────────────────────────────────
  const delivered = down.reduce((s, w) => s + sumDelivered(w), 0);
  const allDelivered = down.every(isDeliveredComplete);
  const allDeliveries = down.flatMap((w) => w.deliveries).map((d) => d.at).sort();
  const lastDeliveryAt = allDeliveries.at(-1) ?? null;
  const requestedRaw = sumKnown(down.map((w) => num(w.plannedQuantity)));
  const targetSum = sumKnown(down.map((w) => workTarget(w)));
  const requested = mixedUnits ? null : (targetSum ?? requestedRaw);

  if (allDelivered) {
    return {
      stage: "ENTREGADO",
      substage: null,
      stageStartedAt: null,
      stageStartSource: null,
      quantities: { unit, requested, delivered, pending: 0, available: 0, mixedUnits },
      partialDelivery: false,
      lastDeliveryAt,
      milestones: milestonesOf(elab, down, lastDeliveryAt),
      readyWorks: [],
      availableSince: null,
    };
  }

  const open = down.filter((w) => !isDeliveredComplete(w));
  type Base = "envasado" | "codificado" | "finalizing";
  type Cls = { w: WorkFact; kind: "ready" | "partial" | Base; base: Base; available: number };
  const classified: Cls[] = open.map((w) => {
    const target = workTarget(w);
    const deliveredHere = sumDelivered(w);
    const marked = w.marks.reduce((s, m) => s + m.quantity, 0);
    // Disponible = marcado − entregado desde la confirmación, sin pasar de lo que falta entregar. Sin marca explícita NO hay disponibilidad.
    const figs = availabilityFigures({ marked, delivered: deliveredHere, markBase: w.markBase ?? null });
    let available = figs.available;
    if (target != null) available = Math.min(available, Math.max(0, target - deliveredHere));
    const pendingUnits = target == null ? 0 : Math.max(0, target - figs.covered);
    // Un trabajo terminado pero sin confirmar sigue «en finalización»; el que no terminó, en su sector.
    const base: Base = FINISHED.has(w.status) ? "finalizing" : w.sector === "CODIFICADO" ? "codificado" : "envasado";
    if (available > EPS) return { w, kind: pendingUnits <= EPS ? "ready" : "partial", base, available };
    return { w, kind: base, base, available: 0 };
  });

  const withStock = classified.filter((c) => c.available > EPS);
  const available = withStock.reduce((s, c) => s + c.available, 0);
  const allReady = classified.every((c) => c.kind === "ready");
  const partialDelivery = delivered > EPS;
  const pending = requested == null ? null : Math.max(0, requested - delivered - available);
  // Marcas con unidades aún sin entregar: lo entregado se descuenta de las marcas más antiguas.
  const readyWorks: ProductStage["readyWorks"] = [];
  for (const c of withStock) {
    let toDeduct = availabilityFigures({ marked: c.w.marks.reduce((s2, m) => s2 + m.quantity, 0), delivered: sumDelivered(c.w), markBase: c.w.markBase ?? null }).deliveredSince;
    for (const m of [...c.w.marks].sort((a, b) => (a.at < b.at ? -1 : 1))) {
      const used = Math.min(toDeduct, m.quantity);
      toDeduct -= used;
      const left = m.quantity - used;
      if (left > EPS) readyWorks.push({ workItemId: c.w.id, markId: m.id, available: left, readySince: m.at });
    }
  }
  const availableSince = readyWorks.map((r) => r.readySince).sort()[0] ?? null;

  if (allReady) {
    return {
      stage: "LISTO",
      substage: null,
      stageStartedAt: null,
      stageStartSource: null,
      quantities: { unit, requested, delivered, pending, available, mixedUnits },
      partialDelivery,
      lastDeliveryAt,
      milestones: milestonesOf(elab, down, null),
      readyWorks,
      availableSince,
    };
  }

  // Todavía hay algo sin confirmar o en proceso: etapa 2 (Envasado). «Finalización» si lo que falta está en Codificado o
  // terminó y espera la confirmación de disponibilidad.
  const notReady = classified.filter((c) => c.kind !== "ready");
  const finalizing = notReady.every((c) => c.base === "codificado" || c.base === "finalizing");
  const starts = notReady
    .map((c) => envasadoStart(c.w))
    .filter((s) => s.at)
    .sort((a, b) => (a.at! < b.at! ? -1 : 1));
  const start = starts[0] ?? { at: null, source: null };
  return {
    stage: "ENVASADO",
    substage: finalizing ? "FINALIZACION" : null,
    stageStartedAt: start.at,
    stageStartSource: start.source,
    quantities: { unit, requested, delivered, pending, available, mixedUnits },
    partialDelivery,
    lastDeliveryAt,
    milestones: milestonesOf(elab, down, null),
    readyWorks,
    availableSince,
  };
}

function sumKnown(values: Array<number | null>): number | null {
  const known = values.filter((v): v is number => v != null);
  return known.length ? known.reduce((a, b) => a + b, 0) : null;
}

/** Mensaje del cliente por etapa (textos acordados con el laboratorio). */
export const STAGE_MESSAGES: Record<PortalStageId, string> = {
  ELABORACION: "Estamos elaborando tu producto en nuestro laboratorio.",
  ENVASADO: "Tu producto finalizó la elaboración y se encuentra en proceso de envasado.",
  LISTO: "¡Tu producto está listo! Podés coordinar la entrega con nuestro equipo.",
  ENTREGADO: "Tu producto fue entregado. ¡Gracias por confiar en Laboratorio Genus!",
};

export const FINALIZATION_MESSAGE = "Tu producto está en proceso de finalización.";
export const PARTIAL_READY_MESSAGE = "Una parte de tu pedido ya está lista para entregar; el resto sigue en proceso.";
export const ESTIMATE_DISCLAIMER = "Los tiempos son estimativos y pueden variar según las características de cada producción.";

export const STAGE_LABELS: Record<PortalStageId, string> = {
  ELABORACION: "Elaboración",
  ENVASADO: "Envasado",
  LISTO: "Listo para entregar",
  ENTREGADO: "Entregado",
};

export function stageIndex(stage: PortalStageId): number {
  return STAGE_ORDER.indexOf(stage);
}
