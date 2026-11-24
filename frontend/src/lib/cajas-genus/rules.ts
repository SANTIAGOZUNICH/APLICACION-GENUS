/**
 * CAJAS GENUS — reglas PURAS (sin E/S): cómo se cuentan las cajas de una entrega, qué clientes usan cajas propias, cómo se calcula el stock
 * a partir del libro de movimientos y cuándo se activa la alerta de stock crítico.
 */
import { clientKey } from "@/lib/entregas/rules";
import { normalizeClientName, similarityKey } from "@/lib/portal/client-identity-rules";

/** Stock crítico: igual o inferior a este valor (cajas). */
export const CAJAS_LOW_STOCK_THRESHOLD = 300;

export const MOVEMENT_KINDS = ["STOCK_INICIAL", "INGRESO", "EGRESO_ENTREGA", "AJUSTE_ENTREGA", "AJUSTE_MANUAL"] as const;
export type CajasMovementKind = (typeof MOVEMENT_KINDS)[number];
export const KIND_LABEL: Record<CajasMovementKind, string> = {
  STOCK_INICIAL: "Stock inicial",
  INGRESO: "Ingreso",
  EGRESO_ENTREGA: "Egreso por entrega",
  AJUSTE_ENTREGA: "Ajuste de entrega",
  AJUSTE_MANUAL: "Ajuste de stock",
};

/**
 * Sectores cuyas líneas de entrega representan entrega de producto terminado en cajas. Elaboración entrega granel (kg): nunca descuenta cajas.
 * Las entregas INTERNAS entre sectores (Envasado → Codificado) no son líneas de entrega: viven en `work_item_codificado_transfers`.
 */
export const FINAL_DELIVERY_SECTORS: readonly string[] = ["ENVASADO_MASIVO", "ENVASADO_PREMIUM", "CODIFICADO", "PRODUCCION"];

export const MAX_INGRESO_TOTAL = 10_000_000;

// ───────────────────────── Ingreso ─────────────────────────

export type IngresoInput = { fecha: string; bultos: unknown; cantidad: unknown };

const isPositiveInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0;
const toNumber = (v: unknown): number => (typeof v === "string" ? Number(v.replace(/\./g, "").replace(",", ".").trim()) : typeof v === "number" ? v : Number.NaN);

/** BULTOS × CANTIDAD (cajas por bulto), validado: enteros positivos. El servidor lo recalcula siempre. */
export function ingresoTotal(bultos: unknown, cantidad: unknown): { ok: true; bultos: number; cantidad: number; total: number } | { ok: false; error: string } {
  const b = toNumber(bultos);
  const c = toNumber(cantidad);
  if (!isPositiveInt(b)) return { ok: false, error: "BULTOS debe ser un número entero mayor a cero." };
  if (!isPositiveInt(c)) return { ok: false, error: "CANTIDAD (cajas por bulto) debe ser un número entero mayor a cero." };
  const total = b * c;
  if (total > MAX_INGRESO_TOTAL) return { ok: false, error: "El total es demasiado grande: revisá bultos y cantidad." };
  return { ok: true, bultos: b, cantidad: c, total };
}

export const isIsoDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

// ───────────────────────── Cajas de una entrega ─────────────────────────

export type BoxGroup = { cajas: number; unidadesPorCaja: number };
export type BoxCount = { ok: true; total: number; groups: BoxGroup[] } | { ok: false; reason: "SIN_DETALLE" | "CAJAS_NO_ENTERAS" };

/** Suma las CAJAS de todos los grupos de la entrega (no las unidades): 4×100 + 1×50 = 5 cajas. Sin detalle no se inventa nada. */
export function cajasFromPackingGroups(groups: unknown): BoxCount {
  if (!Array.isArray(groups) || groups.length === 0) return { ok: false, reason: "SIN_DETALLE" };
  const out: BoxGroup[] = [];
  let total = 0;
  for (const g of groups as Array<{ cajas?: unknown; unidadesPorCaja?: unknown }>) {
    const cajas = Number(g?.cajas);
    if (!Number.isFinite(cajas) || cajas <= 0) continue;
    if (!Number.isInteger(cajas)) return { ok: false, reason: "CAJAS_NO_ENTERAS" };
    total += cajas;
    out.push({ cajas, unidadesPorCaja: Number(g?.unidadesPorCaja) || 0 });
  }
  if (total <= 0) return { ok: false, reason: "SIN_DETALLE" };
  return { ok: true, total, groups: out };
}

// ───────────────────────── Clientes ─────────────────────────

/**
 * Clave de comparación de un cliente: minúsculas, sin acentos, sin sufijo societario (S.A., SRL…), sin signos ni espacios. Une variantes de escritura
 * («B.L. Cosmetics S.A.» = «BL COSMETICS») sin mezclar clientes distintos («TRC» ≠ «TRC Cosmetics»). null = no es un cliente real (vacío, «sin cliente»…).
 */
export function boxClientKey(raw: unknown): string | null {
  const n = normalizeClientName(raw);
  if (!n) return null;
  const k = similarityKey(clientKey(n.label)).replace(/[^a-z0-9]/g, "");
  return k.length >= 2 ? k : null;
}

export type ClientSettingLite = { clientKey: string; usesOwnBoxes: boolean };
export type ClientClass =
  | { status: "SIN_CLIENTE" }
  | { status: "PROPIAS"; key: string }
  | { status: "GENUS"; key: string };

/**
 * ¿Usa cajas propias? Se evalúan las claves del nombre de la entrega y las de su cliente del maestro (nombre + alias): la clave exacta de la entrega
 * manda; si no tiene configuración se usa la del maestro; sin ninguna, el cliente usa cajas Genus (por defecto).
 */
export function classifyClient(rawName: unknown, settings: ReadonlyMap<string, ClientSettingLite>, masterKeys: readonly string[] = []): ClientClass {
  const key = boxClientKey(rawName);
  if (!key) return { status: "SIN_CLIENTE" };
  const own = settings.get(key);
  if (own) return own.usesOwnBoxes ? { status: "PROPIAS", key } : { status: "GENUS", key };
  const viaMaster = masterKeys.map((k) => settings.get(k)).filter((s): s is ClientSettingLite => Boolean(s));
  if (viaMaster.length) return viaMaster.some((s) => s.usesOwnBoxes) ? { status: "PROPIAS", key } : { status: "GENUS", key };
  return { status: "GENUS", key };
}

// ───────────────────────── Qué descontar de una entrega ─────────────────────────

export type ReviewReason = "SIN_CLIENTE" | "SIN_DETALLE" | "CAJAS_NO_ENTERAS";
export type EgressDecision = {
  /** Cajas que deben figurar descontadas por esta entrega (≥ 0). */
  cajas: number;
  /** La entrega se sigue en el libro (si no, no existe movimiento ni pendiente para ella). */
  tracked: boolean;
  /** Pendiente de revisión: no se descuenta nada nuevo hasta que se resuelva. */
  review: ReviewReason | null;
  /** Por qué NO descuenta (informativo). */
  exempt: "CLIENTE_CAJAS_PROPIAS" | "ENTREGA_ANULADA" | "SECTOR_NO_FINAL" | "ANTERIOR_AL_SEGUIMIENTO" | null;
  groups: BoxGroup[];
};

export type EgressInput = {
  lineStatus: string;
  workItemDeleted: boolean;
  sourceSector: string;
  /** Alta de la línea de entrega: las anteriores al inicio del seguimiento NO se descuentan solas (histórico = proceso explícito). */
  lineCreatedAt: Date;
  trackingStartedAt: Date;
  packingGroups: unknown;
  client: ClientClass;
};

export function decideEgress(i: EgressInput): EgressDecision {
  const none = (exempt: EgressDecision["exempt"], tracked = false): EgressDecision => ({ cajas: 0, tracked, review: null, exempt, groups: [] });
  if (!FINAL_DELIVERY_SECTORS.includes(i.sourceSector)) return none("SECTOR_NO_FINAL");
  if (i.lineCreatedAt.getTime() < i.trackingStartedAt.getTime()) return none("ANTERIOR_AL_SEGUIMIENTO");
  // Anulada (efectivamente): se revierte lo descontado. Ocultar del historial NO pasa por acá (no cambia la línea).
  if (i.lineStatus !== "ACTIVA" || i.workItemDeleted) return none("ENTREGA_ANULADA", true);
  if (i.client.status === "SIN_CLIENTE") return { cajas: 0, tracked: true, review: "SIN_CLIENTE", exempt: null, groups: [] };
  if (i.client.status === "PROPIAS") return none("CLIENTE_CAJAS_PROPIAS", true);
  const count = cajasFromPackingGroups(i.packingGroups);
  if (!count.ok) return { cajas: 0, tracked: true, review: count.reason, exempt: null, groups: [] };
  return { cajas: count.total, tracked: true, review: null, exempt: null, groups: count.groups };
}

/** Movimiento de diferencia entre lo ya descontado y lo que corresponde (null = nada que hacer). */
export function egressDiff(alreadyEgressed: number, desired: number): { delta: number; kind: "EGRESO_ENTREGA" | "AJUSTE_ENTREGA" } | null {
  if (alreadyEgressed === desired) return null;
  return { delta: -(desired - alreadyEgressed), kind: alreadyEgressed === 0 ? "EGRESO_ENTREGA" : "AJUSTE_ENTREGA" };
}

// ───────────────────────── Stock ─────────────────────────

export type LedgerRow = {
  id?: string;
  seq: number;
  kind: CajasMovementKind;
  delta: number;
  status: string;
  occurredOn: string;
  clientName?: string | null;
};

export type StockSummary = {
  /** Hay un stock inicial vigente. Sin él no hay stock calculable ni alertas. */
  configured: boolean;
  baseline: number | null;
  baselineSeq: number | null;
  /** STOCK ACTUAL = stock inicial + ingresos − egresos ± ajustes, contando solo lo registrado DESPUÉS del stock inicial. */
  stock: number | null;
  ingresosDesdeBase: number;
  egresosDesdeBase: number;
  ajustesNetosDesdeBase: number;
  /** Totales históricos (todo lo registrado, activo). */
  totalIngresos: number;
  totalEgresos: number;
};

export function computeStock(rows: readonly LedgerRow[]): StockSummary {
  const active = rows.filter((r) => r.status === "ACTIVO");
  const base = active.filter((r) => r.kind === "STOCK_INICIAL").sort((a, b) => b.seq - a.seq)[0] ?? null;
  const after = base ? active.filter((r) => r.kind !== "STOCK_INICIAL" && r.seq > base.seq) : [];
  const sum = (rs: readonly LedgerRow[], kinds: readonly CajasMovementKind[]) => rs.filter((r) => kinds.includes(r.kind)).reduce((a, r) => a + r.delta, 0);
  const ingresosDesdeBase = sum(after, ["INGRESO"]);
  const egresosDesdeBase = -sum(after, ["EGRESO_ENTREGA", "AJUSTE_ENTREGA"]);
  const ajustesNetosDesdeBase = sum(after, ["AJUSTE_MANUAL"]);
  const stock = base ? base.delta + ingresosDesdeBase - egresosDesdeBase + ajustesNetosDesdeBase : null;
  const all = active.filter((r) => r.kind !== "STOCK_INICIAL");
  return {
    configured: Boolean(base),
    baseline: base ? base.delta : null,
    baselineSeq: base ? base.seq : null,
    stock,
    ingresosDesdeBase,
    egresosDesdeBase,
    ajustesNetosDesdeBase,
    totalIngresos: sum(all, ["INGRESO"]),
    totalEgresos: -sum(all, ["EGRESO_ENTREGA", "AJUSTE_ENTREGA"]),
  };
}

/** Saldo acumulado después de cada movimiento (orden de registro). null = anterior al stock inicial o anulado: no cuenta. */
export function runningBalance(rows: readonly LedgerRow[]): Map<number, number | null> {
  const ordered = [...rows].sort((a, b) => a.seq - b.seq);
  const baseSeq = ordered.filter((r) => r.status === "ACTIVO" && r.kind === "STOCK_INICIAL").reduce((m, r) => Math.max(m, r.seq), -1);
  const out = new Map<number, number | null>();
  let saldo: number | null = null;
  for (const r of ordered) {
    if (r.status !== "ACTIVO") {
      out.set(r.seq, saldo);
      continue;
    }
    if (r.kind === "STOCK_INICIAL") {
      if (r.seq === baseSeq) saldo = r.delta;
      out.set(r.seq, r.seq === baseSeq ? saldo : null);
      continue;
    }
    if (saldo != null && r.seq > baseSeq) saldo += r.delta;
    out.set(r.seq, r.seq > baseSeq ? saldo : null);
  }
  return out;
}

// ───────────────────────── Alerta de stock crítico ─────────────────────────

export type AlertState = "NORMAL" | "CRITICO";
export function alertDecision(input: { configured: boolean; stock: number | null; threshold: number; state: AlertState }): { next: AlertState; notify: boolean; critical: boolean } {
  // Sin stock inicial configurado no hay alerta (no se avisa sobre un stock que todavía no existe).
  if (!input.configured || input.stock == null) return { next: "NORMAL", notify: false, critical: false };
  const critical = input.stock <= input.threshold;
  if (critical && input.state === "NORMAL") return { next: "CRITICO", notify: true, critical };
  if (critical) return { next: "CRITICO", notify: false, critical };
  return { next: "NORMAL", notify: false, critical };
}

export const criticalMessage = (stock: number) => `STOCK CRÍTICO DE CAJAS GENUS. Quedan solamente ${stock} cajas disponibles. Es necesario realizar una reposición`;

// ───────────────────────── Períodos ─────────────────────────

export type Period = "dia" | "semana" | "mes";
/** Inicio del período (YYYY-MM-DD) de una fecha ISO: día, lunes de la semana o primero del mes. */
export function periodStart(isoDate: string, period: Period): string {
  const [y, m, d] = isoDate.split("-").map(Number) as [number, number, number];
  if (period === "dia") return isoDate;
  if (period === "mes") return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-01`;
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = (dt.getUTCDay() + 6) % 7; // lunes = 0
  dt.setUTCDate(dt.getUTCDate() - dow);
  return dt.toISOString().slice(0, 10);
}
