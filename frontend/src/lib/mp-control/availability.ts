/**
 * Disponibilidad de materias primas contra las necesidades de producción — reglas PURAS (sin I/O).
 *
 * Regla única y simple: la materia prima de la fórmula se busca por su NOMBRE en la columna DESCRIPCIÓN del Stock MP,
 * y se suman los KG de TODAS las filas de stock que coinciden (cualquier proveedor, lote, código o ingreso).
 * No hay vinculaciones ni equivalencias que mantener.
 *
 * Coincidencia de nombres (sin mayúsculas, tildes ni signos; sin el sufijo « — Proveedor»):
 *   1. igual:        «GLICERINA» = «Glicerina»
 *   2. contenido:    todas las palabras del nombre más corto están en el más largo («GLICERINA» ⊂ «Glicerina vegetal USP»)
 * Si dos nombres de la fórmula comparten filas de stock, se calculan JUNTOS contra ese stock (nunca se cuenta dos veces).
 *
 * Stock utilizable = kg > 0, no archivado, no bloqueado/rechazado/en cuarentena y no vencido. El físico se informa aparte.
 * Las necesidades de toda la semana se suman ANTES de compararlas con el stock.
 */

export type StockLot = {
  id: string;
  codigo: string;
  codigosAnteriores?: string[];
  descripcion: string;
  proveedor: string;
  lote: string;
  ubicacion?: string;
  cantidadKg: number | null;
  vencimiento?: string;
  estadoStock?: string;
  estadoStockManual?: string;
  archived?: boolean;
};

export type FormulaLine = { materiaPrima: string; codigo?: string; codigoMp?: string };

export const round3 = (n: number) => Math.round(n * 1000) / 1000;

export function normText(s: string | null | undefined): string {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
export const normCode = (s: string | null | undefined): string => String(s ?? "").trim().replace(/\s+/g, " ").toUpperCase();

/** Nombre de la MP sin el sufijo « — Proveedor» (solo separadores largos o el proveedor exacto del lote). */
export function baseName(descripcion: string, proveedor = ""): string {
  let d = String(descripcion ?? "").trim();
  const dash = d.split(/\s+[—–]\s+/);
  if (dash.length > 1) d = dash[0]!;
  const prov = normText(proveedor);
  if (prov) {
    const m = /^(.*?)\s+-\s+(.+)$/.exec(d);
    if (m && normText(m[2]) === prov) d = m[1]!;
  }
  return normText(d);
}

const STOP = new Set(["de", "del", "la", "el", "y", "en", "para", "con", "a", "al", "usp", "grado", "tipo"]);
const tokens = (s: string) => s.split(" ").filter((t) => t.length > 1 && !STOP.has(t));

/** ¿El nombre de la fórmula corresponde a la descripción del stock? */
export function namesMatch(formulaName: string, stockName: string): boolean {
  const a = normText(formulaName);
  const b = stockName;
  if (!a || !b) return false;
  if (a === b) return true;
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.length === 0 || tb.length === 0) return false;
  const inB = new Set(tb);
  const inA = new Set(ta);
  return ta.every((t) => inB.has(t)) || tb.every((t) => inA.has(t));
}

const BLOCKED = /bloquead|rechazad|cuarentena|retenid|no liberad|observad/i;
export type LotUse = { usable: boolean; reason: string };
export function lotUsability(lot: StockLot, todayIso: string): LotUse {
  const kg = lot.cantidadKg;
  if (lot.archived) return { usable: false, reason: "Archivado" };
  if (kg == null || !Number.isFinite(kg) || kg <= 0) return { usable: false, reason: "Sin kg" };
  const estado = `${lot.estadoStockManual ?? ""} ${lot.estadoStock ?? ""}`;
  if (BLOCKED.test(estado)) return { usable: false, reason: "Bloqueado / no liberado" };
  const v = (lot.vencimiento ?? "").slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(v) && v < todayIso) return { usable: false, reason: "Vencido" };
  return { usable: true, reason: "" };
}

export type Need = { productionId: string; label: string; kg: number };
export type ProductionInput = {
  id: string;
  label: string;
  /** false = falta dato confiable (cantidad, unidad no convertible, fórmula no encontrada…). */
  reliable: boolean;
  unreliableReason?: string;
  lines: Array<FormulaLine & { kg: number | null }>;
  /** Kg ya consumidos y descontados del inventario para esta producción (libro mayor), por CÓDIGO DE INVENTARIO. */
  consumedByCode?: Record<string, number>;
};

export type AvailabilityStatus = "SUFICIENTE" | "FALTANTE" | "SIN STOCK" | "SIN DATOS CONFIABLES";

export type LotDetail = { descripcion: string; codigo: string; proveedor: string; lote: string; ubicacion: string; kg: number; usable: boolean; motivo: string; vencimiento: string };
export type AvailabilityRow = {
  key: string;
  materiaPrima: string;
  /** Código(s) de inventario de las filas de stock sumadas. */
  codigoMaestro: string;
  stockFisico: number;
  stockUtilizable: number;
  reservado: number;
  requerido: number;
  saldoProyectado: number;
  faltante: number;
  estado: AvailabilityStatus;
  proveedores: Array<{ proveedor: string; kgUtilizable: number; kgTotal: number }>;
  lotes: LotDetail[];
  needs: Need[];
  /** Nombres de la fórmula que se calcularon contra este stock. */
  formulaNames: string[];
  /** Descripciones distintas del Stock MP que se sumaron. */
  stockNames: string[];
  notas: string[];
};

export type AvailabilityResult = {
  rows: AvailabilityRow[];
  excluded: Array<{ id: string; label: string; reason: string }>;
  summary: Record<AvailabilityStatus, number> & { total: number };
};

type Prepared = { lot: StockLot; name: string };
const prepare = (lots: StockLot[]): Prepared[] =>
  lots.filter((l) => !l.archived && String(l.descripcion ?? "").trim()).map((lot) => ({ lot, name: baseName(lot.descripcion, lot.proveedor) }));

function matchedLots(prepared: Prepared[], formulaName: string): Prepared[] {
  return prepared.filter((p) => namesMatch(formulaName, p.name));
}

export function computeAvailability(params: { lots: StockLot[]; productions: ProductionInput[]; todayIso: string }): AvailabilityResult {
  const prepared = prepare(params.lots);
  const excluded: AvailabilityResult["excluded"] = [];

  // 1) Necesidades por nombre de la fórmula (ya restado lo consumido).
  type NeedAcc = { name: string; requerido: number; needs: Need[]; unreliable: number };
  const byName = new Map<string, NeedAcc>();
  for (const prod of params.productions) {
    if (!prod.reliable) excluded.push({ id: prod.id, label: prod.label, reason: prod.unreliableReason ?? "Sin datos confiables" });
    // Lo ya consumido (y descontado del stock) no se vuelve a necesitar: se resta por nombre de stock.
    const consumedLeft = new Map<string, number>();
    for (const [code, kg] of Object.entries(prod.consumedByCode ?? {})) {
      const lot = params.lots.find((l) => normCode(l.codigo) === normCode(code) || (l.codigosAnteriores ?? []).some((c) => normCode(c) === normCode(code)));
      if (!lot) continue;
      const nm = baseName(lot.descripcion, lot.proveedor);
      consumedLeft.set(nm, round3((consumedLeft.get(nm) ?? 0) + kg));
    }
    for (const rawLine of prod.lines) {
      const name = normText(rawLine.materiaPrima);
      if (!name) continue;
      let kg = rawLine.kg;
      if (kg != null) {
        const hit = matchedLots(prepared, rawLine.materiaPrima)[0];
        const left = hit ? (consumedLeft.get(hit.name) ?? 0) : 0;
        if (hit && left > 0) {
          const used = Math.min(left, kg);
          consumedLeft.set(hit.name, round3(left - used));
          kg = round3(kg - used);
        }
      }
      const acc = byName.get(name) ?? { name: rawLine.materiaPrima.trim(), requerido: 0, needs: [], unreliable: 0 };
      if (!prod.reliable || kg == null || !Number.isFinite(kg)) {
        acc.unreliable += 1;
        acc.needs.push({ productionId: prod.id, label: prod.label, kg: 0 });
      } else {
        acc.requerido = round3(acc.requerido + kg);
        acc.needs.push({ productionId: prod.id, label: prod.label, kg: round3(kg) });
      }
      byName.set(name, acc);
    }
  }

  // 2) Nombres de la fórmula que comparten filas de stock se calculan juntos (stock contado una sola vez).
  const names = [...byName.keys()];
  const parent = new Map<string, string>(names.map((n) => [n, n]));
  const find = (n: string): string => {
    const p = parent.get(n)!;
    if (p === n) return n;
    const r = find(p);
    parent.set(n, r);
    return r;
  };
  const lotOwner = new Map<string, string>();
  const lotsOfName = new Map<string, Prepared[]>();
  for (const n of names) {
    const ms = matchedLots(prepared, byName.get(n)!.name);
    lotsOfName.set(n, ms);
    for (const m of ms) {
      const other = lotOwner.get(m.lot.id);
      if (other) parent.set(find(n), find(other));
      else lotOwner.set(m.lot.id, n);
    }
  }
  const clusters = new Map<string, string[]>();
  for (const n of names) clusters.set(find(n), [...(clusters.get(find(n)) ?? []), n]);

  const rows: AvailabilityRow[] = [];
  for (const [root, members] of clusters) {
    const lotsById = new Map<string, Prepared>();
    for (const n of members) for (const m of lotsOfName.get(n) ?? []) lotsById.set(m.lot.id, m);
    const matched = [...lotsById.values()];
    const accs = members.map((n) => byName.get(n)!);
    const requerido = round3(accs.reduce((s, a) => s + a.requerido, 0));
    const needs = accs.flatMap((a) => a.needs);
    const unreliable = accs.reduce((s, a) => s + a.unreliable, 0);
    const details: LotDetail[] = matched
      .filter((p) => (p.lot.cantidadKg ?? 0) !== 0)
      .map((p) => {
        const u = lotUsability(p.lot, params.todayIso);
        return { descripcion: p.lot.descripcion, codigo: p.lot.codigo, proveedor: p.lot.proveedor || "(sin proveedor)", lote: p.lot.lote || "(sin lote)", ubicacion: p.lot.ubicacion ?? "", kg: round3(p.lot.cantidadKg ?? 0), usable: u.usable, motivo: u.reason, vencimiento: p.lot.vencimiento ?? "" };
      });
    const fisico = round3(details.reduce((s, d) => s + (d.kg > 0 ? d.kg : 0), 0));
    const util = round3(details.reduce((s, d) => s + (d.usable ? d.kg : 0), 0));
    const prov = new Map<string, { proveedor: string; kgUtilizable: number; kgTotal: number }>();
    for (const d of details) {
      const p = prov.get(d.proveedor) ?? { proveedor: d.proveedor, kgUtilizable: 0, kgTotal: 0 };
      if (d.kg > 0) p.kgTotal = round3(p.kgTotal + d.kg);
      if (d.usable) p.kgUtilizable = round3(p.kgUtilizable + d.kg);
      prov.set(d.proveedor, p);
    }
    const stockNames = [...new Set(matched.map((p) => String(p.lot.descripcion).trim()))];
    const codes = [...new Set(matched.map((p) => normCode(p.lot.codigo)).filter(Boolean))];
    const saldo = round3(util - requerido);
    const notas: string[] = [];
    const noUsable = round3(fisico - util);
    if (noUsable > 0) notas.push(`${noUsable} kg físicos NO utilizables (bloqueados, vencidos o no liberados).`);
    if (unreliable > 0) notas.push("Hay producciones sin cantidad confiable que no se sumaron.");
    if (members.length > 1) notas.push(`Este stock también cubre: ${members.map((m) => byName.get(m)!.name).join(", ")}.`);
    const allUnreliable = needs.length > 0 && unreliable === needs.length;
    let estado: AvailabilityStatus;
    if (allUnreliable) estado = "SIN DATOS CONFIABLES";
    else if (fisico <= 0) estado = requerido > 0 ? "SIN STOCK" : "SUFICIENTE";
    else if (saldo < 0) estado = "FALTANTE";
    else estado = "SUFICIENTE";
    rows.push({
      key: root,
      materiaPrima: accs.map((a) => a.name).join(" / "),
      codigoMaestro: codes.join(", "),
      stockFisico: fisico,
      stockUtilizable: util,
      reservado: 0,
      requerido,
      saldoProyectado: saldo,
      faltante: saldo < 0 ? round3(-saldo) : 0,
      estado,
      proveedores: [...prov.values()],
      lotes: details,
      needs,
      formulaNames: accs.map((a) => a.name),
      stockNames,
      notas,
    });
  }
  rows.sort(order);
  const summary = { total: rows.length, SUFICIENTE: 0, FALTANTE: 0, "SIN STOCK": 0, "SIN DATOS CONFIABLES": 0 } as AvailabilityResult["summary"];
  for (const r of rows) summary[r.estado] += 1;
  return { rows, excluded, summary };
}

const ORDER: Record<AvailabilityStatus, number> = { "SIN STOCK": 0, FALTANTE: 1, "SIN DATOS CONFIABLES": 2, SUFICIENTE: 3 };
function order(a: AvailabilityRow, b: AvailabilityRow) {
  return ORDER[a.estado] - ORDER[b.estado] || a.materiaPrima.localeCompare(b.materiaPrima, "es");
}

/** Stock utilizable (suma de todas las filas del Stock MP con ese nombre) para UNA línea de control. */
export function stockForLine(lots: StockLot[], line: FormulaLine, todayIso: string): { linked: boolean; stockUtilizable: number; stockFisico: number } {
  const ms = matchedLots(prepare(lots), line.materiaPrima);
  if (ms.length === 0) return { linked: false, stockUtilizable: 0, stockFisico: 0 };
  let util = 0;
  let fis = 0;
  for (const m of ms) {
    const kg = m.lot.cantidadKg ?? 0;
    if (kg > 0) fis += kg;
    if (lotUsability(m.lot, todayIso).usable) util += kg;
  }
  return { linked: true, stockUtilizable: round3(util), stockFisico: round3(fis) };
}

/** Kg → kg si la unidad es de masa; null si no se puede convertir sin densidad (L, unidades…). */
export function toKg(qty: number | null, unit: string | null | undefined): number | null {
  if (qty == null || !Number.isFinite(qty) || qty < 0) return null;
  const u = normText(unit ?? "kg").replace(/\s/g, "");
  if (["kg", "kgs", "kilo", "kilos", "kilogramo", "kilogramos", ""].includes(u)) return qty;
  if (["g", "gr", "grs", "gramo", "gramos"].includes(u)) return qty / 1000;
  if (["t", "tn", "ton", "tonelada", "toneladas"].includes(u)) return qty * 1000;
  return null;
}
