/**
 * «Consumo de Materias Primas» de una OE — reglas PURAS de presentación (sin I/O): combina lo YA DESCONTADO (movimientos del libro
 * mayor) con lo todavía previsto/pendiente de las filas de la OE, y da el texto con signo y unidad.
 */
import { normMpCode } from "@/lib/orders/oe-mp-consumption";
import type { OeMaterialRow } from "@/lib/orders/types";

export type ConsumptionReportRow = {
  codigo: string;
  lote: string;
  consumido: number;
  stockAntes: number | null;
  stockDespues: number | null;
  negativo: boolean;
  ultimoAt: string;
  actorEmail: string;
};

export type ConsumptionViewRow = {
  key: string;
  materiaPrima: string;
  codigo: string;
  lote: string;
  /** confirmado = ya descontado del inventario; pendiente = kg reales cargados pero sin registrar; previsto = solo teórico. */
  estado: "confirmado" | "pendiente" | "previsto" | "sin_descuento";
  /** kg (siempre positivos); el signo se muestra al formatear. */
  kg: number;
  stockAntes: number | null;
  stockDespues: number | null;
  negativo: boolean;
  at: string | null;
  actorEmail: string | null;
};

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** «-5 kg» / «+2 kg» (una devolución neta) con unidad; sin decimales de más. */
export function fmtKg(n: number | null | undefined, opts: { signed?: boolean } = {}): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const v = r3(n);
  const txt = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 3 }).format(Math.abs(v));
  const sign = v < 0 ? "-" : opts.signed && v > 0 ? "+" : "";
  return `${sign}${txt} kg`;
}

export function buildConsumptionView(report: ConsumptionReportRow[], materials: OeMaterialRow[]): ConsumptionViewRow[] {
  const nameOf = new Map<string, string>();
  const rowsByCode = new Map<string, OeMaterialRow[]>();
  for (const m of materials) {
    const code = normMpCode(m.codigoMp || m.codigo);
    if (!code) continue;
    if (!nameOf.has(code) && m.materiaPrima.trim()) nameOf.set(code, m.materiaPrima.trim());
    rowsByCode.set(code, [...(rowsByCode.get(code) ?? []), m]);
  }
  const parentById = new Map(materials.map((m) => [m.id, m]));
  const out: ConsumptionViewRow[] = [];
  const registered = new Set<string>();
  for (const r of report) {
    registered.add(normMpCode(r.codigo));
    if (r.consumido === 0 && r.stockAntes == null) continue;
    out.push({
      key: `c|${normMpCode(r.codigo)}|${r.lote}`,
      materiaPrima: nameOf.get(normMpCode(r.codigo)) ?? r.codigo,
      codigo: r.codigo,
      lote: r.lote,
      estado: "confirmado",
      kg: r.consumido,
      stockAntes: r.stockAntes,
      stockDespues: r.stockDespues,
      negativo: r.negativo,
      at: r.ultimoAt,
      actorEmail: r.actorEmail,
    });
  }
  // Lo que todavía no se descontó: filas de la OE con código MP sin movimientos registrados.
  for (const m of materials) {
    if (m.parentRowId && !m.codigoMp.trim()) continue;
    const code = normMpCode(m.codigoMp || m.codigo);
    if (!code && !(m.codigoMp ?? "").trim() && m.kgReal != null && m.kgReal > 0) {
      // Kg utilizados sin CÓDIGO MP identificable: la OE se entrega igual, pero esta MP no se descuenta (no se inventa el código).
      out.push({
        key: `s|${m.id}`,
        materiaPrima: (m.materiaPrima || parentById.get(m.parentRowId ?? "")?.materiaPrima || "MP").trim(),
        codigo: "",
        lote: m.lote.trim(),
        estado: "sin_descuento",
        kg: m.kgReal,
        stockAntes: null,
        stockDespues: null,
        negativo: false,
        at: null,
        actorEmail: null,
      });
      continue;
    }
    if (!code || registered.has(code)) continue;
    const real = m.kgReal != null && m.kgReal > 0;
    const kg = real ? m.kgReal! : m.kgAPesar ?? 0;
    if (!(kg > 0)) continue;
    out.push({
      key: `p|${m.id}`,
      materiaPrima: m.materiaPrima.trim() || nameOf.get(code) || code,
      codigo: code,
      lote: m.lote.trim(),
      estado: real ? "pendiente" : "previsto",
      kg,
      stockAntes: null,
      stockDespues: null,
      negativo: false,
      at: null,
      actorEmail: null,
    });
  }
  return out;
}
