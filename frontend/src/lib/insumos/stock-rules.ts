/**
 * INSUMOS — control de stock: reglas PURAS (sin E/S). Mismo modelo que Cajas Genus (libro de movimientos con baseline por `seq`).
 *   STOCK = STOCK INICIAL + INGRESOS − RETIROS + AJUSTES NETOS  (solo lo registrado DESPUÉS del stock inicial vigente).
 */
export const STOCK_KINDS = ["STOCK_INICIAL", "INGRESO", "EGRESO_RETIRO", "AJUSTE_RETIRO", "AJUSTE_MANUAL"] as const;
export type StockKind = (typeof STOCK_KINDS)[number];
export const STOCK_KIND_LABEL: Record<StockKind, string> = {
  STOCK_INICIAL: "Stock inicial",
  INGRESO: "Ingreso",
  EGRESO_RETIRO: "Retiro",
  AJUSTE_RETIRO: "Ajuste de retiro",
  AJUSTE_MANUAL: "Ajuste manual",
};

export const MAX_STOCK_QTY = 10_000_000;
export const MAX_UNIT_LENGTH = 30;
export const DEFAULT_UNIT = "unidades";

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const toNumber = (v: unknown): number => (typeof v === "string" ? (v.trim() === "" ? Number.NaN : Number(v.trim())) : typeof v === "number" ? v : Number.NaN);

/** Entero ≥ min (cantidad de un ingreso: ≥ 1; stock inicial / mínimo: ≥ 0). */
export function parseStockInt(raw: unknown, label: string, min: number): Parsed<number> {
  const n = toNumber(raw);
  if (!Number.isFinite(n)) return { ok: false, error: `${label} tiene que ser un número.` };
  if (!Number.isInteger(n)) return { ok: false, error: `${label} tiene que ser un número entero.` };
  if (n < min) return { ok: false, error: min > 0 ? `${label} tiene que ser mayor a cero.` : `${label} no puede ser negativo.` };
  if (n > MAX_STOCK_QTY) return { ok: false, error: `${label} es demasiado grande.` };
  return { ok: true, value: n };
}
export const parseIngresoQty = (raw: unknown) => parseStockInt(raw, "La cantidad", 1);
export const parseInitialStock = (raw: unknown) => parseStockInt(raw, "El stock inicial", 0);
export const parseMinStock = (raw: unknown) => parseStockInt(raw, "El stock mínimo", 0);

/** Ajuste manual: entero distinto de cero (positivo suma, negativo resta). */
export function parseAdjustDelta(raw: unknown): Parsed<number> {
  const n = toNumber(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return { ok: false, error: "El ajuste tiene que ser un número entero." };
  if (n === 0) return { ok: false, error: "El ajuste no puede ser cero." };
  if (Math.abs(n) > MAX_STOCK_QTY) return { ok: false, error: "El ajuste es demasiado grande." };
  return { ok: true, value: n };
}

export function parseUnit(raw: unknown): Parsed<string> {
  const s = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim().toLowerCase() : "";
  if (!s) return { ok: false, error: "Indicá la unidad de medida (rollos, cajas, paquetes, unidades…)." };
  if (s.length > MAX_UNIT_LENGTH) return { ok: false, error: `La unidad no puede superar ${MAX_UNIT_LENGTH} caracteres.` };
  return { ok: true, value: s };
}

export const isIsoDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

export function parseObservaciones(raw: unknown): Parsed<string | null> {
  if (raw == null || raw === "") return { ok: true, value: null };
  const s = typeof raw === "string" ? raw.trim() : "";
  if (s.length > 500) return { ok: false, error: "Las observaciones no pueden superar 500 caracteres." };
  return { ok: true, value: s || null };
}

// ───────────────────────── Stock ─────────────────────────

export type LedgerRow = { id?: string; seq: number; kind: StockKind; delta: number; status: string; occurredOn?: string };

export type StockSummary = {
  /** Hay un stock inicial vigente. Sin él NO hay stock calculable ni alertas (distinto de «stock 0»). */
  configured: boolean;
  baseline: number | null;
  baselineSeq: number | null;
  stock: number | null;
  ingresosDesdeBase: number;
  retirosDesdeBase: number;
  ajustesNetosDesdeBase: number;
  /** Totales de todo lo registrado (activo), con o sin stock inicial. */
  totalIngresos: number;
  totalRetiros: number;
};

export function computeStock(rows: readonly LedgerRow[]): StockSummary {
  const active = rows.filter((r) => r.status === "ACTIVO");
  const base = active.filter((r) => r.kind === "STOCK_INICIAL").sort((a, b) => b.seq - a.seq)[0] ?? null;
  const after = base ? active.filter((r) => r.kind !== "STOCK_INICIAL" && r.seq > base.seq) : [];
  const sum = (rs: readonly LedgerRow[], kinds: readonly StockKind[]) => rs.filter((r) => kinds.includes(r.kind)).reduce((a, r) => a + r.delta, 0);
  const ingresosDesdeBase = sum(after, ["INGRESO"]);
  const retirosDesdeBase = -sum(after, ["EGRESO_RETIRO", "AJUSTE_RETIRO"]);
  const ajustesNetosDesdeBase = sum(after, ["AJUSTE_MANUAL"]);
  const all = active.filter((r) => r.kind !== "STOCK_INICIAL");
  return {
    configured: Boolean(base),
    baseline: base ? base.delta : null,
    baselineSeq: base ? base.seq : null,
    stock: base ? base.delta + ingresosDesdeBase - retirosDesdeBase + ajustesNetosDesdeBase : null,
    ingresosDesdeBase,
    retirosDesdeBase,
    ajustesNetosDesdeBase,
    totalIngresos: sum(all, ["INGRESO"]),
    totalRetiros: -sum(all, ["EGRESO_RETIRO", "AJUSTE_RETIRO"]),
  };
}

/** Saldo acumulado tras cada movimiento (orden de registro). null = anterior al stock inicial vigente: no cuenta. */
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

// ───────────────────────── Estado por insumo ─────────────────────────

export type StockStatus = "SIN_CONFIGURAR" | "DISPONIBLE" | "STOCK_BAJO" | "SIN_STOCK";
export const STOCK_STATUS_LABEL: Record<StockStatus, string> = {
  SIN_CONFIGURAR: "SIN STOCK INICIAL",
  DISPONIBLE: "DISPONIBLE",
  STOCK_BAJO: "STOCK BAJO",
  SIN_STOCK: "SIN STOCK",
};

/** SIN STOCK (≤ 0) tiene prioridad sobre STOCK BAJO (≤ mínimo). Sin stock inicial no hay estado de alerta. */
export function stockStatus(input: { configured: boolean; stock: number | null; minStock: number }): StockStatus {
  if (!input.configured || input.stock == null) return "SIN_CONFIGURAR";
  if (input.stock <= 0) return "SIN_STOCK";
  if (input.stock <= input.minStock) return "STOCK_BAJO";
  return "DISPONIBLE";
}
export const needsRestock = (s: StockStatus) => s === "STOCK_BAJO" || s === "SIN_STOCK";

// ───────────────────────── Descuento por retiro ─────────────────────────

export type RetiroForStock = { status: string; lines: ReadonlyArray<{ insumoId: string; cantidad: number }> };

/** Cantidad que debe figurar descontada por insumo según el ESTADO ACTUAL del retiro (anulado = nada). Renglones en 0 no cuentan. */
export function desiredEgress(retiro: RetiroForStock): Map<string, number> {
  const out = new Map<string, number>();
  if (retiro.status !== "ACTIVO") return out;
  for (const l of retiro.lines) if (l.cantidad > 0) out.set(l.insumoId, (out.get(l.insumoId) ?? 0) + l.cantidad);
  return out;
}

/** Movimiento de diferencia entre lo ya descontado y lo que corresponde (null = nada que hacer). delta < 0 descuenta; > 0 devuelve. */
export function egressDiff(already: number, desired: number): { delta: number; kind: "EGRESO_RETIRO" | "AJUSTE_RETIRO" } | null {
  if (already === desired) return null;
  return { delta: -(desired - already), kind: already === 0 ? "EGRESO_RETIRO" : "AJUSTE_RETIRO" };
}

/** ¿El retiro entra al seguimiento de stock? Los anteriores al inicio del seguimiento (y sin movimientos) no descuentan solos. */
export const isRetiroTracked = (createdAt: Date, trackingStartedAt: Date, hasMovements: boolean) => hasMovements || createdAt.getTime() >= trackingStartedAt.getTime();

// ───────────────────────── Alerta por insumo (episodios) ─────────────────────────

export type AlertState = "NORMAL" | "CRITICO";
export function alertDecision(input: { active: boolean; configured: boolean; stock: number | null; minStock: number; state: AlertState }): { next: AlertState; notify: boolean; critical: boolean; level: "STOCK_BAJO" | "SIN_STOCK" | null } {
  if (!input.active || !input.configured || input.stock == null) return { next: "NORMAL", notify: false, critical: false, level: null };
  const status = stockStatus({ configured: true, stock: input.stock, minStock: input.minStock });
  const critical = needsRestock(status);
  if (critical && input.state === "NORMAL") return { next: "CRITICO", notify: true, critical, level: status as "STOCK_BAJO" | "SIN_STOCK" };
  if (critical) return { next: "CRITICO", notify: false, critical, level: status as "STOCK_BAJO" | "SIN_STOCK" };
  return { next: "NORMAL", notify: false, critical: false, level: null };
}

/** Id determinístico de la notificación: una por insumo y por EPISODIO. */
export const alertNotificationKey = (insumoId: string, episode: number) => `insumos:bajo:${insumoId}:${episode}`;

export const alertTitle = (level: "STOCK_BAJO" | "SIN_STOCK") => (level === "SIN_STOCK" ? "SIN STOCK DE INSUMOS" : "STOCK BAJO DE INSUMOS");
export function alertMessage(input: { name: string; stock: number; minStock: number; unit: string; level: "STOCK_BAJO" | "SIN_STOCK" }): string {
  const head = input.level === "SIN_STOCK" ? "SIN STOCK DE INSUMOS" : "STOCK BAJO DE INSUMOS";
  return `${head}: ${input.name} — stock ${input.stock} ${input.unit}, mínimo ${input.minStock}. Es necesario reponer.`;
}
