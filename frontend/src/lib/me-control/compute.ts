/**
 * Control de ME — cálculo PURO de necesidades, faltantes y alertas. Sin base de datos, sin efectos.
 *
 *   Necesario = Cantidad programada × Consumo por unidad.
 *   Faltante  = máx(0, Necesario − stock disponible utilizable).
 *
 * El stock se reparte entre los trabajos de la semana EN ORDEN (fecha, alta): las mismas unidades nunca se dan por
 * suficientes para dos trabajos. Planificar NO descuenta stock (nada acá escribe). Solo los materiales CONFIRMADOS
 * consumen stock; una sugerencia (IA / inventario) se muestra pero no reserva ni se da por buena.
 */
import { accessoriesNeededBy, classifyRole, keyOf, ME_ROLE_LABELS, type MeRole } from "./families";

export type ConfigStatus = "CONFIRMADO" | "SUGERIDO" | "PENDIENTE" | "RECHAZADO";
export type ConfigSource = "MANUAL" | "IA" | "INVENTARIO" | "COMPATIBILIDAD";

export type ConfigRow = {
  id: string;
  materialCodigo: string | null;
  role: MeRole;
  qtyPerUnit: number;
  required: boolean;
  status: ConfigStatus;
  source: ConfigSource;
  reason: string;
};

export type MeJob = {
  id: string;
  client: string;
  product: string;
  sector: string;
  /** Unidades programadas; null = la cantidad no está en unidades (p. ej. kg) o no es legible. */
  qty: number | null;
  unit: string;
  date: string | null;
  createdAt: string;
};

export type LineState = "OK" | "FALTANTE" | "SIN_IDENTIFICAR" | "PENDIENTE_CONFIRMACION";
export type JobState = "COMPLETO" | "STOCK_INSUFICIENTE" | "MATERIAL_SIN_IDENTIFICAR" | "PENDIENTE_CONFIRMACION";

export const JOB_STATE_LABELS: Record<JobState, string> = {
  COMPLETO: "Completo",
  STOCK_INSUFICIENTE: "Stock insuficiente",
  MATERIAL_SIN_IDENTIFICAR: "Material sin identificar",
  PENDIENTE_CONFIRMACION: "Pendiente de confirmación",
};

export type JobLine = {
  rowId: string | null;
  materialCodigo: string | null;
  materialLabel: string;
  role: MeRole;
  roleLabel: string;
  confirmation: "CONFIRMADO" | "SUGERIDO" | "PENDIENTE";
  source: ConfigSource | "SISTEMA";
  reason: string;
  qtyPerUnit: number;
  /** Necesario (null si no se puede calcular). En SIN_IDENTIFICAR es una estimación del componente. */
  needed: number | null;
  stock: number | null;
  faltante: number;
  state: LineState;
  required: boolean;
};

export type JobResult = {
  job: MeJob;
  lines: JobLine[];
  state: JobState;
  /** El producto no tiene NINGÚN material asociado. */
  sinAsociacion: boolean;
  qtyIssue: boolean;
};

const roleLabel = (r: MeRole) => ME_ROLE_LABELS[r];
const round = (n: number) => Math.round(n * 1000) / 1000;

export const productKey = (client: string, product: string) => `${keyOf(client)}||${keyOf(product)}`;

export type EvaluateInput = {
  jobs: readonly MeJob[];
  /** Config por clave cliente||producto. */
  configs: ReadonlyMap<string, readonly ConfigRow[]>;
  /** Stock por código normalizado (puede ser negativo: se usa máx(0, …)). */
  stock: ReadonlyMap<string, number>;
  /** Descripción por código normalizado. */
  labels: ReadonlyMap<string, string>;
};

export function evaluateJobs(input: EvaluateInput): JobResult[] {
  const remaining = new Map<string, number>();
  for (const [k, v] of input.stock) remaining.set(k, Math.max(0, v));
  const ordered = [...input.jobs].sort((a, b) => (a.date ?? "9999").localeCompare(b.date ?? "9999") || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const out: JobResult[] = [];
  for (const job of ordered) {
    const rows = (input.configs.get(productKey(job.client, job.product)) ?? []).filter((r) => r.status !== "RECHAZADO");
    const lines: JobLine[] = [];
    const qtyIssue = job.qty == null || !(job.qty > 0);
    const labelOf = (c: string | null) => (c ? (input.labels.get(keyOf(c)) ? `${c} — ${input.labels.get(keyOf(c))}` : c) : "");

    for (const r of rows) {
      const needed = qtyIssue ? null : round(job.qty! * r.qtyPerUnit);
      const base = { rowId: r.id, role: r.role, roleLabel: roleLabel(r.role), source: r.source, reason: r.reason, qtyPerUnit: r.qtyPerUnit, required: r.required };
      if (!r.materialCodigo || r.status === "PENDIENTE") {
        lines.push({ ...base, materialCodigo: null, materialLabel: `${roleLabel(r.role)} sin identificar`, confirmation: "PENDIENTE", needed, stock: null, faltante: 0, state: "SIN_IDENTIFICAR" });
        continue;
      }
      const code = keyOf(r.materialCodigo);
      const available = remaining.get(code) ?? 0;
      const known = input.stock.has(code);
      if (r.status === "SUGERIDO") {
        // Se muestra la necesidad y el stock, pero NO se reserva ni se da por confirmado.
        const falt = needed == null ? 0 : round(Math.max(0, needed - available));
        lines.push({ ...base, materialCodigo: r.materialCodigo, materialLabel: labelOf(r.materialCodigo), confirmation: "SUGERIDO", needed, stock: known ? round(available) : null, faltante: falt, state: "PENDIENTE_CONFIRMACION" });
        continue;
      }
      if (needed == null) {
        lines.push({ ...base, materialCodigo: r.materialCodigo, materialLabel: labelOf(r.materialCodigo), confirmation: "CONFIRMADO", needed: null, stock: known ? round(available) : null, faltante: 0, state: "PENDIENTE_CONFIRMACION" });
        continue;
      }
      const falt = round(Math.max(0, needed - available));
      remaining.set(code, round(Math.max(0, available - needed)));
      lines.push({ ...base, materialCodigo: r.materialCodigo, materialLabel: labelOf(r.materialCodigo), confirmation: "CONFIRMADO", needed, stock: round(available), faltante: falt, state: falt > 0 ? "FALTANTE" : "OK" });
    }

    // Accesorios que la familia del envase suele necesitar y que nadie asoció (ni siquiera como sugerencia/pendiente).
    for (const r of rows) {
      if (r.role !== "ENVASE") continue;
      const desc = r.materialCodigo ? (input.labels.get(keyOf(r.materialCodigo)) ?? r.materialCodigo) : "";
      for (const need of accessoriesNeededBy(desc)) {
        if (rows.some((x) => x.role === need.role)) continue;
        if (lines.some((l) => l.role === need.role && l.source === "SISTEMA")) continue;
        lines.push({ rowId: null, materialCodigo: null, materialLabel: `${need.label[0]!.toUpperCase()}${need.label.slice(1)} sin identificar`, role: need.role, roleLabel: roleLabel(need.role), confirmation: "PENDIENTE", source: "SISTEMA", reason: `No se identificó un ${need.label} compatible (${need.hint}).`, qtyPerUnit: r.qtyPerUnit, needed: qtyIssue ? null : round(job.qty! * r.qtyPerUnit), stock: null, faltante: 0, state: "SIN_IDENTIFICAR", required: true });
      }
    }

    const sinAsociacion = rows.length === 0;
    let state: JobState = "COMPLETO";
    if (lines.some((l) => l.state === "FALTANTE")) state = "STOCK_INSUFICIENTE";
    else if (sinAsociacion || lines.some((l) => l.state === "SIN_IDENTIFICAR")) state = "MATERIAL_SIN_IDENTIFICAR";
    else if (qtyIssue || lines.some((l) => l.state === "PENDIENTE_CONFIRMACION")) state = "PENDIENTE_CONFIRMACION";
    out.push({ job, lines, state, sinAsociacion, qtyIssue });
  }
  return out;
}

// ───────────────────────────── Alertas ─────────────────────────────

export type AlertShortage = { codigo: string; label: string; needed: number; stock: number; faltante: number; confirmation: "CONFIRMADO" | "SUGERIDO" };
export type AlertUnidentified = { role: MeRole; label: string; estimated: number | null; reason: string };
export type AlertFinding = {
  alertKey: string;
  weekStart: string;
  client: string;
  product: string;
  jobs: Array<{ id: string; qty: number | null; date: string | null; sector: string }>;
  totalQty: number | null;
  shortages: AlertShortage[];
  unidentified: AlertUnidentified[];
  sinAsociacion: boolean;
  /** Huella cuantitativa: clave → cantidad. Sirve para decidir si el problema EMPEORÓ. */
  keys: Record<string, number>;
};

/** Agrupa los resultados de UNA semana por producto y arma los hallazgos (solo productos con algo que avisar). */
export function buildFindings(weekStart: string, results: readonly JobResult[]): AlertFinding[] {
  const byProduct = new Map<string, JobResult[]>();
  for (const r of results) {
    const k = productKey(r.job.client, r.job.product);
    byProduct.set(k, [...(byProduct.get(k) ?? []), r]);
  }
  const out: AlertFinding[] = [];
  for (const [pk, list] of byProduct) {
    const shortMap = new Map<string, AlertShortage>();
    const unidMap = new Map<string, AlertUnidentified>();
    let sinAsociacion = false;
    for (const r of list) {
      if (r.sinAsociacion) sinAsociacion = true;
      for (const l of r.lines) {
        if (l.materialCodigo && (l.confirmation === "CONFIRMADO" || l.confirmation === "SUGERIDO")) {
          const k = `${l.confirmation}|${keyOf(l.materialCodigo)}`;
          const cur = shortMap.get(k);
          // Necesidad total del producto en la semana; el stock es el que había al empezar (se cuenta una sola vez).
          shortMap.set(k, { codigo: l.materialCodigo, label: l.materialLabel, needed: round((cur?.needed ?? 0) + (l.needed ?? 0)), stock: cur?.stock ?? l.stock ?? 0, faltante: round((cur?.faltante ?? 0) + l.faltante), confirmation: l.confirmation });
        }
        if (l.state === "SIN_IDENTIFICAR") {
          const k = l.role;
          const cur = unidMap.get(k);
          unidMap.set(k, { role: l.role, label: l.materialLabel, estimated: l.needed == null ? (cur?.estimated ?? null) : round((cur?.estimated ?? 0) + l.needed), reason: l.reason });
        }
      }
    }
    const shortages = [...shortMap.values()].filter((x) => x.faltante > 0).sort((a, b) => a.label.localeCompare(b.label));
    const unidentified = [...unidMap.values()].sort((a, b) => a.role.localeCompare(b.role));
    if (!shortages.length && !unidentified.length && !sinAsociacion) continue;
    const keys: Record<string, number> = {};
    for (const s of shortages) keys[`F|${s.confirmation}|${keyOf(s.codigo)}`] = s.faltante;
    for (const u of unidentified) keys[`I|${u.role}`] = 1;
    if (sinAsociacion) keys["A"] = 1;
    for (const r of list) keys[`J|${r.job.id}`] = 1;
    const qtys = list.map((r) => r.job.qty);
    out.push({
      alertKey: `${weekStart}|${pk}`,
      weekStart,
      client: list[0]!.job.client,
      product: list[0]!.job.product,
      jobs: list.map((r) => ({ id: r.job.id, qty: r.job.qty, date: r.job.date, sector: r.job.sector })),
      totalQty: qtys.every((q) => q != null) ? qtys.reduce<number>((a, q) => a + (q ?? 0), 0) : null,
      shortages,
      unidentified,
      sinAsociacion,
      keys,
    });
  }
  return out.sort((a, b) => a.client.localeCompare(b.client) || a.product.localeCompare(b.product));
}

/** Huella estable de un hallazgo (cambia con cualquier variación de lo que falta). */
export function findingHash(f: Pick<AlertFinding, "keys">): string {
  const body = Object.keys(f.keys).sort().map((k) => `${k}=${f.keys[k]}`).join(";");
  let h = 5381;
  for (let i = 0; i < body.length; i++) h = ((h * 33) ^ body.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/** ¿El problema EMPEORÓ respecto de la base (cuando se cerró)? Nueva clave, o un faltante que creció ≥ 10 % y ≥ 1 unidad. */
export function worsened(base: Record<string, number>, now: Record<string, number>): boolean {
  for (const [k, v] of Object.entries(now)) {
    if (!(k in base)) return true;
    if (k.startsWith("F|") && v - base[k]! >= 1 && v >= base[k]! * 1.1) return true;
  }
  return false;
}

export type AlertStatus = "ABIERTA" | "CERRADA" | "RESUELTA";
export type AlertTransition =
  | { type: "create" }
  | { type: "update"; status: AlertStatus; reopened: boolean }
  | { type: "resolve" }
  | { type: "noop" };

/**
 * Decide qué hacer con la alerta de una clave. Sin duplicados: una clave = una fila.
 *  - abierta: se actualiza el detalle;
 *  - cerrada: sigue cerrada salvo que el problema EMPEORE (entonces se reabre);
 *  - resuelta que vuelve a aparecer: se reabre.
 */
export function decideTransition(existing: { status: AlertStatus; closedKeys?: Record<string, number> | null } | null, finding: AlertFinding | null): AlertTransition {
  if (!finding) {
    if (!existing || existing.status === "RESUELTA") return { type: "noop" };
    return { type: "resolve" };
  }
  if (!existing) return { type: "create" };
  if (existing.status === "ABIERTA") return { type: "update", status: "ABIERTA", reopened: false };
  if (existing.status === "RESUELTA") return { type: "update", status: "ABIERTA", reopened: true };
  const base = existing.closedKeys ?? {};
  return worsened(base, finding.keys) ? { type: "update", status: "ABIERTA", reopened: true } : { type: "update", status: "CERRADA", reopened: false };
}

// ───────────────────────────── Texto para personas ─────────────────────────────

const fmt = (n: number) => new Intl.NumberFormat("es-AR", { maximumFractionDigits: 3 }).format(n);
export { fmt as formatQty };

export function describeShortage(s: AlertShortage): string {
  return s.confirmation === "CONFIRMADO" ? `${fmt(s.faltante)} × ${s.label}` : `${fmt(s.faltante)} × ${s.label} (sugerido por IA / sin confirmar)`;
}
export function describeUnidentified(u: AlertUnidentified): string {
  return `${u.label}${u.estimated != null ? ` — necesidad estimada: ${fmt(u.estimated)} (falta identificar el material exacto)` : ""}`;
}
export { classifyRole };
