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
 *  3. LISTO: los trabajos que faltan entregar terminaron (completo/revisión). Es la misma regla que ya usa el calendario
 *     interno de Entregas (FINISHED_WORK). Como un Envasado terminado todavía puede pasar a Codificado, un Envasado
 *     recién terminado espera `readyStableMinutes` antes de mostrarse como LISTO (evita avisar «listo» y retroceder).
 *  4. Con varios trabajos se muestra la etapa MENOS avanzada, y la cantidad ya disponible aparte (entrega parcial).
 *  5. Entrega parcial: cantidad solicitada, entregada, pendiente y disponible; no es «entregado» hasta completar.
 */
import { parseQuantity } from "@/lib/entregas/rules";

export type PortalStageId = "ELABORACION" | "ENVASADO" | "LISTO" | "ENTREGADO";
/** FINALIZACION = en Codificado (o recién terminado en Envasado, a la espera de definir destino). */
export type PortalSubstage = "FINALIZACION" | "TERMINADA_EN_TRASPASO" | null;
export type PortalWorkSector = "ELABORACION" | "ENVASADO_MASIVO" | "ENVASADO_PREMIUM" | "CODIFICADO";

export const STAGE_ORDER: readonly PortalStageId[] = ["ELABORACION", "ENVASADO", "LISTO", "ENTREGADO"];
/** Días hábiles estimados por etapa (solo orientativos; no son una fecha de entrega comprometida). */
export const STAGE_ESTIMATE_DAYS: Partial<Record<PortalStageId, number>> = { ELABORACION: 10, ENVASADO: 5 };
export const DEFAULT_READY_STABLE_MINUTES = 60;

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
};

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
    /** Lo que todavía no se entregó (solicitado − entregado, nunca negativo). */
    pending: number | null;
    /** Lo que ya está disponible para entregar ahora. */
    available: number;
    /** true si hay trabajos con unidades distintas: no se suma entre unidades. */
    mixedUnits: boolean;
  };
  partialDelivery: boolean;
  /** Fecha de la última entrega final registrada. */
  lastDeliveryAt: string | null;
  milestones: Milestones;
  /** Trabajos de Envasado/Codificado con producto ya disponible (para avisar «listo»). */
  readyWorks: Array<{ workItemId: string; available: number | null; readySince: string | null }>;
};

const FINISHED = new Set(["completo", "revision", "entregado"]);
const EPS = 1e-6;

const num = (raw: string | null | undefined): number | null => {
  const n = parseQuantity(raw);
  return typeof n === "number" ? n : null;
};

/** Cantidad total a entregar de un trabajo: unidades entregables → embaladas → final declarada → planificada. */
export function workTarget(w: Pick<WorkFact, "deliverableUnits" | "packagingTotalUnits" | "finishedQty" | "plannedQuantity">): number | null {
  const candidates = [
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

const iso = (v: string | null | undefined) => (v ? v : null);
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

const readySinceOf = (w: WorkFact) => iso(w.completedAt) ?? iso(w.progressUpdatedAt);

function milestonesOf(elab: readonly WorkFact[], down: readonly WorkFact[], entregadoAt: string | null): Milestones {
  const readySinces = down.filter((w) => FINISHED.has(w.status)).map(readySinceOf);
  return {
    elaboracion: earliest(elab.map((w) => elaboracionStart(w).at)),
    envasado: earliest(down.map((w) => envasadoStart(w).at)),
    listo: earliest(readySinces),
    entregado: entregadoAt,
  };
}

export type DeriveOptions = { now: Date; readyStableMinutes?: number };

/**
 * Etapa de un producto a partir de sus trabajos VIVOS (sin cancelados ni borrados). null si no hay trabajos.
 */
export function deriveProductStage(works: readonly WorkFact[], opts: DeriveOptions): ProductStage | null {
  if (works.length === 0) return null;
  const stable = (opts.readyStableMinutes ?? DEFAULT_READY_STABLE_MINUTES) * 60_000;
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
    };
  }

  const open = down.filter((w) => !isDeliveredComplete(w));
  type Cls = { w: WorkFact; kind: "ready" | "stabilizing" | "codificado" | "envasado"; available: number | null };
  const classified: Cls[] = open.map((w) => {
    const target = workTarget(w);
    const deliveredHere = sumDelivered(w);
    const remaining = target == null ? null : Math.max(0, target - deliveredHere);
    if (FINISHED.has(w.status)) {
      const since = readySinceOf(w);
      const isEnvasado = w.sector !== "CODIFICADO";
      if (isEnvasado && since) {
        const age = opts.now.getTime() - new Date(since).getTime();
        if (!Number.isNaN(age) && age < stable) return { w, kind: "stabilizing", available: null };
      }
      return { w, kind: "ready", available: remaining };
    }
    return { w, kind: w.sector === "CODIFICADO" ? "codificado" : "envasado", available: null };
  });

  const ready = classified.filter((c) => c.kind === "ready");
  const available = ready.reduce((s, c) => s + (c.available ?? 0), 0);
  const allReady = ready.length === classified.length;
  const partialDelivery = delivered > EPS;
  const pending = requested == null ? null : Math.max(0, requested - delivered);
  const readyWorks = ready.map((c) => ({ workItemId: c.w.id, available: c.available, readySince: readySinceOf(c.w) }));

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
    };
  }

  // Todavía hay algo en proceso: etapa 2 (Envasado). Finalización si lo que falta está en Codificado o por definir destino.
  const notReady = classified.filter((c) => c.kind !== "ready");
  const finalizing = notReady.every((c) => c.kind === "codificado" || c.kind === "stabilizing");
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
