/**
 * Disponibilidad de materias primas contra las necesidades de producción — reglas PURAS (sin I/O).
 *
 * Fuente: filas del Stock MP (columna DESCRIPCIÓN y KG LOTE = kg ACTUALES del lote; el consumo de las OE descuenta del
 * mismo lote). No exige código: hay filas de stock sin código y siguen siendo stock.
 *
 * Identificación de la MP (segura):
 *   1. Nombre IGUAL normalizado (sin mayúsculas/tildes/signos ni el sufijo « — Proveedor»): «GLICERINA» = «Glicerina».
 *   2. Equivalencia APROBADA a nivel de materia prima (no por lote): «GLICERINA» ⇒ «GLICERINA VEGETAL». Se recuerda.
 *   Nombres que solo comparten palabras («GLICERINA VEGETAL», «EXTRACTO HIDROGLICERINADO») NO se suman solos: se ofrecen
 *   como «posibles equivalentes» para que alguien autorizado los incluya (una sola vez por materia prima).
 *
 * Stock utilizable = kg > 0, no archivado, no bloqueado/rechazado/en cuarentena, no vencido y, si el lote es de un
 * cliente, solo para las producciones de ese cliente. El físico se informa aparte.
 * Las necesidades de TODA la semana se suman ANTES de compararlas con el stock.
 */

export type StockLot = {
  id: string;
  codigo: string;
  codigosAnteriores?: string[];
  descripcion: string;
  proveedor: string;
  cliente?: string;
  lote: string;
  ubicacion?: string;
  cantidadKg: number | null;
  vencimiento?: string;
  estadoStock?: string;
  estadoStockManual?: string;
  archived?: boolean;
};

export type FormulaLine = { materiaPrima: string; codigo?: string; codigoMp?: string; /** % de la fórmula (solo informativo para la vista por producto). */ pct?: number | null };
/** Equivalencia aprobada: la MP `formulaName` (normalizada) también usa el stock de `stockName` (normalizado). */
export type NameAlias = { formulaName: string; stockName: string };

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

/** Número tal como lo guarda/muestra la planilla («8,8», 8.8, «1.234,5») → número; null si no es un número. */
export function toNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const t = String(v ?? "").trim().replace(/\s/g, "");
  if (!t) return null;
  const n = /^[-+]?\d{1,3}(\.\d{3})+(,\d+)?$/.test(t) ? Number(t.replace(/\./g, "").replace(",", ".")) : Number(t.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

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

/** Nombres que comparten palabras pero NO son iguales: solo se SUGIEREN, nunca se suman solos. */
export function namesRelated(formulaName: string, stockName: string): boolean {
  const a = normText(formulaName);
  if (!a || !stockName || a === stockName) return false;
  const ta = tokens(a);
  const tb = tokens(stockName);
  if (ta.length === 0 || tb.length === 0) return false;
  const inB = new Set(tb);
  const inA = new Set(ta);
  return ta.every((t) => inB.has(t)) || tb.every((t) => inA.has(t));
}

const BLOCKED = /bloquead|rechazad|cuarentena|retenid|no liberad|observad/i;
export type LotUse = { usable: boolean; reason: string };
export function lotUsability(lot: StockLot, todayIso: string): LotUse {
  const kg = toNumber(lot.cantidadKg);
  if (lot.archived) return { usable: false, reason: "Archivado" };
  if (kg == null || kg <= 0) return { usable: false, reason: "Sin kg" };
  const estado = `${lot.estadoStockManual ?? ""} ${lot.estadoStock ?? ""}`;
  if (BLOCKED.test(estado)) return { usable: false, reason: "Bloqueado / no liberado" };
  const v = (lot.vencimiento ?? "").slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(v) && v < todayIso) return { usable: false, reason: "Vencido" };
  return { usable: true, reason: "" };
}

export type Need = {
  productionId: string;
  label: string;
  kg: number;
  client?: string;
  /** Línea de la fórmula que originó la necesidad (para la vista por producto). */
  line?: string;
  codigo?: string;
  pct?: number | null;
  /** La línea no tiene cantidad confiable (fórmula incompleta, cantidad no convertible…): no se sumó. */
  unreliable?: boolean;
};
export type ProductionInput = {
  id: string;
  label: string;
  client?: string;
  /** false = falta dato confiable (cantidad, unidad no convertible, fórmula no encontrada…). */
  reliable: boolean;
  unreliableReason?: string;
  lines: Array<FormulaLine & { kg: number | null }>;
  /** Datos de presentación para la vista por producto (no intervienen en el cálculo). */
  product?: string;
  oeNumber?: string;
  days?: string;
  /** Cantidad a elaborar en la semana (kg) — ya repartida si la OE tiene varias programaciones. */
  weekKg?: number | null;
  source?: "OE" | "FORMULA" | "SIN_FORMULA";
  note?: string;
  /** Kg ya consumidos y descontados del inventario para esta producción (libro mayor), por CÓDIGO DE INVENTARIO. */
  consumedByCode?: Record<string, number>;
};

export type AvailabilityStatus = "SUFICIENTE" | "FALTANTE" | "SIN STOCK" | "SIN STOCK UTILIZABLE" | "MP NO IDENTIFICADA" | "DATOS INCOMPLETOS";

export type LotDetail = { descripcion: string; codigo: string; proveedor: string; cliente: string; lote: string; ubicacion: string; kgRegistrados: number; usable: boolean; motivo: string; vencimiento: string; fuente: "nombre" | "equivalencia aprobada" };
export type RelatedName = { stockName: string; descripcion: string; kg: number; filas: number };
export type AvailabilityRow = {
  key: string;
  materiaPrima: string;
  /** Código(s) de inventario de las filas de stock sumadas (puede estar vacío si las filas no tienen código). */
  codigoMaestro: string;
  /** Stock físico actual: kg de todas las filas que coinciden (sin archivadas ni en cero). */
  stockFisico: number;
  /** Kg que pueden usarse para las producciones de esta semana. */
  stockUtilizable: number;
  /** Kg físicos que existen pero no se pueden usar acá: reservados para un cliente que no los necesita esta semana. */
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
  /** Nombres del Stock MP que comparten palabras pero NO se sumaron (ofrecer «incluir»). */
  related: RelatedName[];
  notas: string[];
};

export type AvailabilityResult = {
  rows: AvailabilityRow[];
  excluded: Array<{ id: string; label: string; reason: string }>;
  summary: Record<AvailabilityStatus, number> & { total: number };
  stockRowsRead: number;
  stockRowsActive: number;
};

type Prepared = { lot: StockLot; name: string; kg: number };
const prepare = (lots: StockLot[]): Prepared[] =>
  lots
    .filter((l) => !l.archived && String(l.descripcion ?? "").trim())
    .map((lot) => ({ lot, name: baseName(lot.descripcion, lot.proveedor), kg: toNumber(lot.cantidadKg) ?? 0 }));

function matchedLots(prepared: Prepared[], formulaName: string, aliases: NameAlias[]): Array<Prepared & { fuente: LotDetail["fuente"] }> {
  const f = normText(formulaName);
  const aliasNames = new Set(aliases.filter((a) => a.formulaName === f).map((a) => a.stockName));
  const out: Array<Prepared & { fuente: LotDetail["fuente"] }> = [];
  for (const p of prepared) {
    if (p.name === f) out.push({ ...p, fuente: "nombre" });
    else if (aliasNames.has(p.name)) out.push({ ...p, fuente: "equivalencia aprobada" });
  }
  return out;
}

/**
 * Nivel 1 de identificación: el CÓDIGO de la línea de la fórmula coincide EXACTO con el código de inventario de filas de
 * stock que comparten un único nombre → la MP es esa, aunque la fórmula la llame distinto. Si el código apunta a nombres
 * distintos (ambiguo) no se infiere nada. Se expresa como equivalencia implícita (no se guarda ni modifica nada).
 */
export function impliedCodeAliases(lots: StockLot[], productions: ProductionInput[]): NameAlias[] {
  const byCode = new Map<string, Set<string>>();
  for (const l of lots) {
    if (l.archived) continue;
    const nm = baseName(l.descripcion, l.proveedor);
    if (!nm) continue;
    for (const c of [l.codigo, ...(l.codigosAnteriores ?? [])]) {
      const k = normCode(c);
      if (k.length < 3) continue;
      const set = byCode.get(k) ?? new Set<string>();
      set.add(nm);
      byCode.set(k, set);
    }
  }
  const out: NameAlias[] = [];
  const seen = new Set<string>();
  for (const p of productions) {
    for (const line of p.lines) {
      const k = normCode(line.codigoMp || line.codigo);
      const names = k ? byCode.get(k) : undefined;
      const formulaName = normText(line.materiaPrima);
      if (!names || names.size !== 1 || !formulaName) continue;
      const stockName = [...names][0]!;
      const key = `${formulaName}|${stockName}`;
      if (stockName === formulaName || seen.has(key)) continue;
      seen.add(key);
      out.push({ formulaName, stockName });
    }
  }
  return out;
}

export function computeAvailability(params: { lots: StockLot[]; productions: ProductionInput[]; todayIso: string; aliases?: NameAlias[] }): AvailabilityResult {
  const aliases = [...(params.aliases ?? []), ...impliedCodeAliases(params.lots, params.productions)];
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
        const hit = matchedLots(prepared, rawLine.materiaPrima, aliases)[0];
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
        acc.needs.push({ productionId: prod.id, label: prod.label, kg: 0, client: prod.client, line: name, codigo: rawLine.codigo, pct: rawLine.pct ?? null, unreliable: true });
      } else {
        acc.requerido = round3(acc.requerido + kg);
        acc.needs.push({ productionId: prod.id, label: prod.label, kg: round3(kg), client: prod.client, line: name, codigo: rawLine.codigo, pct: rawLine.pct ?? null });
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
  const lotsOfName = new Map<string, ReturnType<typeof matchedLots>>();
  for (const n of names) {
    const ms = matchedLots(prepared, byName.get(n)!.name, aliases);
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
    const lotsById = new Map<string, ReturnType<typeof matchedLots>[number]>();
    for (const n of members) for (const m of lotsOfName.get(n) ?? []) lotsById.set(m.lot.id, m);
    const matched = [...lotsById.values()];
    const accs = members.map((n) => byName.get(n)!);
    const requerido = round3(accs.reduce((s, a) => s + a.requerido, 0));
    const needs = accs.flatMap((a) => a.needs);
    const unreliable = accs.reduce((s, a) => s + a.unreliable, 0);

    const details: LotDetail[] = matched
      .filter((p) => p.kg !== 0)
      .map((p) => {
        const u = lotUsability(p.lot, params.todayIso);
        return {
          descripcion: p.lot.descripcion, codigo: p.lot.codigo, proveedor: p.lot.proveedor || "(sin proveedor)", cliente: p.lot.cliente ?? "", lote: p.lot.lote || "(sin lote)",
          ubicacion: p.lot.ubicacion ?? "", kgRegistrados: round3(p.kg), usable: u.usable, motivo: u.reason, vencimiento: p.lot.vencimiento ?? "", fuente: p.fuente,
        };
      });
    const fisico = round3(details.reduce((s, d) => s + (d.kgRegistrados > 0 ? d.kgRegistrados : 0), 0));

    // Stock utilizable con la regla de clientes: lo libre sirve a todos; lo de un cliente solo a sus producciones.
    const free = details.filter((d) => d.usable && !normText(d.cliente));
    const freeKg = round3(free.reduce((s, d) => s + d.kgRegistrados, 0));
    const clientKg = new Map<string, number>();
    for (const d of details) if (d.usable && normText(d.cliente)) clientKg.set(normText(d.cliente), round3((clientKg.get(normText(d.cliente)) ?? 0) + d.kgRegistrados));
    const needByClient = new Map<string, number>();
    for (const n of needs) {
      const c = [...clientKg.keys()].find((k) => n.client && k === normText(n.client)) ?? "";
      needByClient.set(c, round3((needByClient.get(c) ?? 0) + n.kg));
    }
    let usedFromClients = 0;
    let reservado = 0;
    for (const [c, kg] of clientKg) {
      const used = Math.min(kg, needByClient.get(c) ?? 0);
      usedFromClients = round3(usedFromClients + used);
      reservado = round3(reservado + (kg - used));
    }
    const util = round3(freeKg + usedFromClients);

    const prov = new Map<string, { proveedor: string; kgUtilizable: number; kgTotal: number }>();
    for (const d of details) {
      const p = prov.get(d.proveedor) ?? { proveedor: d.proveedor, kgUtilizable: 0, kgTotal: 0 };
      if (d.kgRegistrados > 0) p.kgTotal = round3(p.kgTotal + d.kgRegistrados);
      if (d.usable) p.kgUtilizable = round3(p.kgUtilizable + d.kgRegistrados);
      prov.set(d.proveedor, p);
    }
    const stockNames = [...new Set(matched.map((p) => String(p.lot.descripcion).trim()))];
    const codes = [...new Set(matched.map((p) => normCode(p.lot.codigo)).filter(Boolean))];
    const saldo = round3(util - requerido);

    // Posibles equivalentes (comparten palabras pero NO son el mismo nombre): se muestran, no se suman.
    const includedNames = new Set(matched.map((p) => p.name));
    const relMap = new Map<string, RelatedName>();
    for (const n of members) {
      for (const p of prepared) {
        if (includedNames.has(p.name) || !namesRelated(byName.get(n)!.name, p.name) || p.kg <= 0) continue;
        const cur = relMap.get(p.name) ?? { stockName: p.name, descripcion: String(p.lot.descripcion).trim(), kg: 0, filas: 0 };
        cur.kg = round3(cur.kg + p.kg);
        cur.filas += 1;
        relMap.set(p.name, cur);
      }
    }

    const notas: string[] = [];
    const noUsable = round3(fisico - util - reservado);
    if (noUsable > 0) notas.push(`${noUsable} kg físicos NO utilizables (bloqueados, vencidos o no liberados).`);
    if (reservado > 0) notas.push(`${reservado} kg están reservados para un cliente que no los necesita esta semana.`);
    if (unreliable > 0) notas.push("Hay producciones sin cantidad confiable que no se sumaron.");
    if (members.length > 1) notas.push(`Este stock también cubre: ${members.map((m) => byName.get(m)!.name).join(", ")}.`);

    const allUnreliable = needs.length > 0 && unreliable === needs.length;
    let estado: AvailabilityStatus;
    if (allUnreliable) estado = "DATOS INCOMPLETOS";
    else if (matched.length === 0) estado = "MP NO IDENTIFICADA";
    else if (fisico <= 0) estado = "SIN STOCK";
    else if (util <= 0 && requerido > 0) estado = "SIN STOCK UTILIZABLE";
    else if (saldo < 0) estado = "FALTANTE";
    else estado = "SUFICIENTE";

    rows.push({
      key: root,
      materiaPrima: accs.map((a) => a.name).join(" / "),
      codigoMaestro: codes.join(", "),
      stockFisico: fisico,
      stockUtilizable: util,
      reservado,
      requerido,
      saldoProyectado: saldo,
      faltante: saldo < 0 ? round3(-saldo) : 0,
      estado,
      proveedores: [...prov.values()],
      lotes: details,
      needs,
      formulaNames: accs.map((a) => a.name),
      stockNames,
      related: [...relMap.values()].sort((a, b) => b.kg - a.kg),
      notas,
    });
  }
  rows.sort(order);
  const summary = { total: rows.length, SUFICIENTE: 0, FALTANTE: 0, "SIN STOCK": 0, "SIN STOCK UTILIZABLE": 0, "MP NO IDENTIFICADA": 0, "DATOS INCOMPLETOS": 0 } as AvailabilityResult["summary"];
  for (const r of rows) summary[r.estado] += 1;
  return { rows, excluded, summary, stockRowsRead: params.lots.length, stockRowsActive: prepared.length };
}

const ORDER: Record<AvailabilityStatus, number> = { "MP NO IDENTIFICADA": 0, "SIN STOCK": 1, "SIN STOCK UTILIZABLE": 2, FALTANTE: 3, "DATOS INCOMPLETOS": 4, SUFICIENTE: 5 };
function order(a: AvailabilityRow, b: AvailabilityRow) {
  return ORDER[a.estado] - ORDER[b.estado] || a.materiaPrima.localeCompare(b.materiaPrima, "es");
}

/** Stock utilizable (suma de las filas del Stock MP con ese nombre o equivalencia aprobada) para UNA línea de control. */
export function stockForLine(lots: StockLot[], line: FormulaLine, todayIso: string, aliases: NameAlias[] = []): { linked: boolean; stockUtilizable: number; stockFisico: number } {
  const ms = matchedLots(prepare(lots), line.materiaPrima, aliases);
  if (ms.length === 0) return { linked: false, stockUtilizable: 0, stockFisico: 0 };
  let util = 0;
  let fis = 0;
  for (const m of ms) {
    if (m.kg > 0) fis += m.kg;
    if (lotUsability(m.lot, todayIso).usable) util += m.kg;
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
