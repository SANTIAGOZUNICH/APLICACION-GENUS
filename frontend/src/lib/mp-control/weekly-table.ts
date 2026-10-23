/**
 * Control semanal de MP como planilla (PRODUCTO · MATERIA PRIMA · CANT. NECESARIA · EN INVENTARIO · FALTA · ESTADO ·
 * OBSERVACIÓN · FECHA) — reglas PURAS (sin I/O). Parte de `WeeklyAvailability` (ya calculada con el Stock MP real, las OE y
 * el acumulado por fecha) y solo la presenta en filas. No calcula stock, no toca OE, fórmulas ni consumos.
 *
 * EN INVENTARIO = stock utilizable que le queda a ESE producto tras los que se elaboran antes (el stock es compartido: nunca
 * se cuenta dos veces). FALTA = MAX(0, necesaria − en inventario). Sin dato confiable → SIN DATOS (nunca HAY).
 */
import type { ProductLine, ProductSection } from "./product-breakdown";
import { round3 } from "./availability";
import type { WeeklyAvailability } from "./weekly-availability-service";

export type TableEstado = "HAY" | "FALTA" | "SIN DATOS";
export const TABLE_ESTADOS: Array<"TODOS" | TableEstado> = ["TODOS", "HAY", "FALTA", "SIN DATOS"];

export type TableRow = {
  id: string;
  groupId: string;
  firstOfGroup: boolean;
  producto: string;
  /** «100 kg · OE-2026-000123» (varias elaboraciones del mismo producto quedan identificadas una por una). */
  detalle: string;
  materiaPrima: string;
  codigo: string;
  necesaria: number | null;
  enInventario: number | null;
  /** Stock utilizable total de la MP (compartido entre productos); solo informativo. */
  stockTotal: number | null;
  falta: number | null;
  estado: TableEstado;
  /** Clave de observación (por MP y semana). null en filas sin MP identificable. */
  rowKey: string | null;
  observacion: string;
  fecha: string | null;
  nota: string | null;
  compartido: boolean;
};

const estadoOf = (l: ProductLine): TableEstado => (l.tone === "ok" ? "HAY" : l.tone === "unknown" ? "SIN DATOS" : "FALTA");
const isDup = (note?: string) => /^Misma OE/.test(note ?? "");

export function dateOf(section: ProductSection): string | null {
  return /^\d{4}-\d{2}-\d{2}$/.test(section.startDate) && section.startDate !== "9999-12-31" ? section.startDate : null;
}

export function detailOf(section: ProductSection): string {
  const jobs = section.oes.filter((o) => !isDup(o.note));
  const parts = jobs.map((o) => [o.kg != null ? `${new Intl.NumberFormat("es-AR", { maximumFractionDigits: 3 }).format(o.kg)} kg` : null, o.oeNumber ? `OE ${o.oeNumber}` : "sin OE", jobs.length > 1 ? o.days : null].filter(Boolean).join(" · "));
  return parts.join(" + ");
}

export function buildTableRows(data: Pick<WeeklyAvailability, "products" | "rows" | "excludedRows">): TableRow[] {
  const obs = new Map<string, string>();
  for (const r of [...data.rows, ...data.excludedRows]) obs.set(r.key, r.state.observacion ?? "");
  const out: TableRow[] = [];
  for (const s of data.products) {
    const producto = [s.client, s.product].filter(Boolean).join(" — ");
    const incompleto = s.overall === "DATOS_INCOMPLETOS" ? (s.notes.join(" · ") || "Datos incompletos") : "";
    const base = { groupId: s.id, producto, detalle: [detailOf(s), incompleto].filter(Boolean).join(" · "), fecha: dateOf(s) };
    const lines = s.lines.filter((l) => !l.excluded);
    if (lines.length === 0) {
      // Sin ingredientes/cantidades: se dice QUÉ falta completar; nunca se muestra HAY.
      out.push({ ...base, id: `${s.id}#sin-formula`, firstOfGroup: true, materiaPrima: "—", codigo: "", necesaria: null, enInventario: null, stockTotal: null, falta: null, estado: "SIN DATOS", rowKey: null, observacion: "", nota: s.notes.join(" · ") || "Fórmula pendiente", compartido: false });
      continue;
    }
    lines.forEach((l, i) => {
      const unknown = l.tone === "unknown";
      const need = l.needKg;
      const have = unknown ? null : l.availableForThis;
      out.push({
        ...base,
        id: `${s.id}#${l.rowKey}`,
        firstOfGroup: i === 0,
        materiaPrima: l.materiaPrima,
        codigo: l.codigo,
        necesaria: need,
        enInventario: have,
        stockTotal: unknown ? null : l.stockUtilizable,
        falta: unknown || need == null || have == null ? null : round3(Math.max(0, need - have)),
        estado: estadoOf(l),
        rowKey: l.rowKey,
        observacion: obs.get(l.rowKey) ?? "",
        nota: l.note ?? null,
        compartido: l.shared,
      });
    });
  }
  return out;
}

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Filtra por estado y por texto (producto, cliente, materia prima o código). Si coincide el producto se muestra su fórmula completa. */
export function filterTableRows(rows: TableRow[], f: { estado: "TODOS" | TableEstado; q: string }): TableRow[] {
  const q = norm(f.q.trim());
  const byGroup = new Map<string, TableRow[]>();
  for (const r of rows) byGroup.set(r.groupId, [...(byGroup.get(r.groupId) ?? []), r]);
  const out: TableRow[] = [];
  for (const group of byGroup.values()) {
    const productHit = q !== "" && norm(`${group[0]!.producto} ${group[0]!.detalle}`).includes(q);
    const kept = group.filter((r) => (f.estado === "TODOS" || r.estado === f.estado) && (q === "" || productHit || norm(`${r.materiaPrima} ${r.codigo}`).includes(q)));
    kept.forEach((r, i) => out.push({ ...r, firstOfGroup: i === 0 }));
  }
  return out;
}

export type TableSummary = { programadas: number; suficientes: number; conFaltantes: number; sinDatos: number; mpConFaltante: number };

export function summarizeTable(data: Pick<WeeklyAvailability, "products">, rows: TableRow[]): TableSummary {
  const jobs = (s: ProductSection) => s.oes.filter((o) => !isDup(o.note)).length;
  return {
    programadas: data.products.reduce((n, s) => n + jobs(s), 0),
    suficientes: data.products.filter((s) => s.overall === "CUBIERTA").reduce((n, s) => n + jobs(s), 0),
    conFaltantes: data.products.filter((s) => s.counts.partial + s.counts.none > 0).reduce((n, s) => n + jobs(s), 0),
    sinDatos: data.products.filter((s) => s.counts.unknown > 0 || s.lines.length === 0).reduce((n, s) => n + jobs(s), 0),
    mpConFaltante: new Set(rows.filter((r) => r.estado === "FALTA" && r.rowKey).map((r) => r.rowKey)).size,
  };
}

const nf = new Intl.NumberFormat("es-AR", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
/** «2,000 kg» (decimal argentino) o «—» si no hay dato. */
export const fmtQty = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? "—" : `${nf.format(n)} kg`);
export const fmtFecha = (iso: string | null) => (iso ? iso.split("-").reverse().join("/") : "—");
