/**
 * Disponibilidad de materias primas contra las necesidades de producción — reglas PURAS (sin I/O).
 *
 * Una materia prima «maestra» es un CÓDIGO DE INVENTARIO (el que identifica el saldo en el libro mayor). Todo el stock de
 * esa materia prima (todos los proveedores, lotes e ingresos) se suma bajo ese código maestro. Una línea de fórmula se
 * asocia a un maestro solo por vías confiables, en este orden:
 *   1. equivalencia APROBADA por una persona (se recuerda: tabla mp_master_links);
 *   2. el código de la fórmula es un código de inventario (o uno anterior del mismo lote);
 *   3. el NOMBRE coincide exacto (sin mayúsculas, tildes ni espacios de más; sin el sufijo « — Proveedor») con una sola
 *      materia prima del inventario.
 * Nombres «parecidos» NUNCA se unen solos: quedan «PENDIENTE DE VINCULAR» con los candidatos para que alguien autorizado
 * confirme la equivalencia.
 *
 * Stock utilizable = existencias con kg > 0, no archivadas, no bloqueadas/rechazadas/en cuarentena y no vencidas.
 * Las necesidades de toda la semana se suman ANTES de compararlas contra el stock (no se evalúa cada trabajo aislado).
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

export type MpLinkKind = "formula_code" | "formula_name" | "inventory_code";
export type MpLink = { kind: MpLinkKind; key: string; masterCode: string; approvedBy?: string; approvedAt?: string };

export type MatchSource = "aprobada" | "codigo" | "nombre" | "pendiente";

/** `codigoMp` = código de INVENTARIO ya elegido en la OE (si existe); `codigo` = código de la fórmula. */
export type FormulaLine = { materiaPrima: string; codigo: string; codigoMp?: string };

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

type Index = {
  /** código de inventario (normalizado) → maestro (normalizado) */
  masterOfInventoryCode: Map<string, string>;
  /** código de inventario o anterior (normalizado) → código de inventario vigente (normalizado) */
  currentCodeOf: Map<string, string>;
  /** maestro → lotes */
  lotsByMaster: Map<string, StockLot[]>;
  /** nombre base normalizado → maestros que lo usan */
  mastersByName: Map<string, Set<string>>;
  linkByFormulaCode: Map<string, string>;
  linkByFormulaName: Map<string, string>;
};

export function buildIndex(lots: StockLot[], links: MpLink[]): Index {
  const inventoryAlias = new Map<string, string>();
  for (const l of links) if (l.kind === "inventory_code") inventoryAlias.set(normCode(l.key), normCode(l.masterCode));
  const rootOf = (code: string) => {
    let c = code;
    for (let i = 0; i < 5 && inventoryAlias.has(c) && inventoryAlias.get(c) !== c; i += 1) c = inventoryAlias.get(c)!;
    return c;
  };
  const idx: Index = {
    masterOfInventoryCode: new Map(),
    currentCodeOf: new Map(),
    lotsByMaster: new Map(),
    mastersByName: new Map(),
    linkByFormulaCode: new Map(),
    linkByFormulaName: new Map(),
  };
  for (const l of lots) {
    if (!normCode(l.codigo)) continue;
    const code = normCode(l.codigo);
    const master = rootOf(code);
    idx.masterOfInventoryCode.set(code, master);
    idx.currentCodeOf.set(code, code);
    for (const prev of l.codigosAnteriores ?? []) if (normCode(prev)) idx.currentCodeOf.set(normCode(prev), code);
    const arr = idx.lotsByMaster.get(master) ?? [];
    arr.push(l);
    idx.lotsByMaster.set(master, arr);
    const nm = baseName(l.descripcion, l.proveedor);
    if (nm) {
      const set = idx.mastersByName.get(nm) ?? new Set<string>();
      set.add(master);
      idx.mastersByName.set(nm, set);
    }
  }
  // Códigos de inventario con EXACTAMENTE el mismo nombre (sin el sufijo de proveedor) son la misma materia prima
  // comprada a distintos proveedores: se suman bajo el código menor. Nombres solo parecidos NUNCA se unen.
  const target = new Map<string, string>();
  for (const masters of idx.mastersByName.values()) {
    if (masters.size < 2) continue;
    const sorted = [...masters].sort();
    for (const m of sorted) target.set(m, target.get(m) ?? sorted[0]!);
  }
  if (target.size) {
    const resolve = (m: string) => target.get(m) ?? m;
    for (const [code, m] of idx.masterOfInventoryCode) idx.masterOfInventoryCode.set(code, resolve(m));
    const merged = new Map<string, StockLot[]>();
    for (const [m, arr] of idx.lotsByMaster) merged.set(resolve(m), [...(merged.get(resolve(m)) ?? []), ...arr]);
    idx.lotsByMaster = merged;
    for (const [name, set] of idx.mastersByName) idx.mastersByName.set(name, new Set([...set].map(resolve)));
  }
  const resolveMaster = (m: string) => target.get(m) ?? m;
  for (const l of links) {
    if (l.kind === "formula_code") idx.linkByFormulaCode.set(normCode(l.key), resolveMaster(rootOf(normCode(l.masterCode))));
    if (l.kind === "formula_name") idx.linkByFormulaName.set(normText(l.key), resolveMaster(rootOf(normCode(l.masterCode))));
  }
  return idx;
}

export type Candidate = { masterCode: string; descripcion: string; stockFisico: number };
export type Match =
  | { status: "vinculada"; source: Exclude<MatchSource, "pendiente">; masterCode: string }
  | { status: "pendiente"; reason: "sin_coincidencias" | "ambigua" | "similar"; candidates: Candidate[] };

const STOP = new Set(["de", "del", "la", "el", "y", "en", "para", "con", "a", "al"]);
const tokens = (s: string) => normText(s).split(" ").filter((t) => t.length > 2 && !STOP.has(t));

function describeMaster(idx: Index, master: string): Candidate {
  const lots = idx.lotsByMaster.get(master) ?? [];
  const nm = lots[0] ? String(lots[0].descripcion).split(/\s+[—–]\s+/)[0]!.trim() : master;
  return { masterCode: master, descripcion: nm, stockFisico: round3(lots.reduce((s, l) => s + (l.cantidadKg ?? 0), 0)) };
}

export function matchFormulaLine(idx: Index, line: FormulaLine): Match {
  const code = normCode(line.codigo);
  const name = normText(line.materiaPrima);
  const approved = (code && idx.linkByFormulaCode.get(code)) || (name && idx.linkByFormulaName.get(name)) || "";
  if (approved && idx.lotsByMaster.has(approved)) return { status: "vinculada", source: "aprobada", masterCode: approved };
  const mpCode = normCode(line.codigoMp);
  if (mpCode) {
    const cur = idx.currentCodeOf.get(mpCode);
    if (cur) return { status: "vinculada", source: "codigo", masterCode: idx.masterOfInventoryCode.get(cur) ?? cur };
  }
  if (code) {
    const current = idx.currentCodeOf.get(code);
    if (current) return { status: "vinculada", source: "codigo", masterCode: idx.masterOfInventoryCode.get(current) ?? current };
  }
  const exact = name ? idx.mastersByName.get(name) : undefined;
  if (exact && exact.size === 1) return { status: "vinculada", source: "nombre", masterCode: [...exact][0]! };
  if (exact && exact.size > 1) return { status: "pendiente", reason: "ambigua", candidates: [...exact].map((m) => describeMaster(idx, m)) };
  // Candidatos por palabras en común (SOLO para sugerir; nunca se unen solos).
  const want = new Set(tokens(line.materiaPrima));
  const scored: Array<{ master: string; score: number }> = [];
  if (want.size > 0) {
    for (const [master, lots] of idx.lotsByMaster) {
      const have = new Set(tokens(baseName(lots[0]!.descripcion, lots[0]!.proveedor)));
      let hit = 0;
      for (const t of want) if (have.has(t)) hit += 1;
      if (hit > 0) scored.push({ master, score: hit / Math.max(want.size, have.size) });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  const candidates = scored.slice(0, 5).map((s) => describeMaster(idx, s.master));
  return { status: "pendiente", reason: candidates.length ? "similar" : "sin_coincidencias", candidates };
}

export type Need = { productionId: string; label: string; kg: number };
export type ProductionInput = {
  id: string;
  label: string;
  /** false = falta dato confiable (cantidad, unidad no convertible, fórmula no vinculada…). */
  reliable: boolean;
  unreliableReason?: string;
  lines: Array<FormulaLine & { kg: number | null }>;
  /** Kg ya consumidos y descontados del inventario para esta producción (libro mayor), por CÓDIGO DE INVENTARIO. */
  consumedByCode?: Record<string, number>;
};

export type AvailabilityStatus = "SUFICIENTE" | "FALTANTE" | "SIN STOCK" | "PENDIENTE DE VINCULAR" | "SIN DATOS CONFIABLES";

export type LotDetail = { proveedor: string; lote: string; ubicacion: string; kg: number; usable: boolean; motivo: string; vencimiento: string };
export type AvailabilityRow = {
  key: string;
  materiaPrima: string;
  codigoMaestro: string;
  match: MatchSource;
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
  /** Fórmulas que usan nombres/códigos distintos para esta MP (para que se vea qué se vinculó). */
  formulaNames: string[];
  candidates: Candidate[];
  pendienteMotivo?: string;
  notas: string[];
};

export type AvailabilityResult = {
  rows: AvailabilityRow[];
  excluded: Array<{ id: string; label: string; reason: string }>;
  summary: Record<AvailabilityStatus, number> & { total: number };
};

export function computeAvailability(params: {
  lots: StockLot[];
  links: MpLink[];
  productions: ProductionInput[];
  todayIso: string;
}): AvailabilityResult {
  const idx = buildIndex(params.lots, params.links);
  const byKey = new Map<string, AvailabilityRow>();
  const excluded: AvailabilityResult["excluded"] = [];
  const unreliableProductions = new Set<string>();

  const rowFor = (key: string, init: () => AvailabilityRow) => {
    let r = byKey.get(key);
    if (!r) {
      r = init();
      byKey.set(key, r);
    }
    return r;
  };

  for (const prod of params.productions) {
    if (!prod.reliable) {
      excluded.push({ id: prod.id, label: prod.label, reason: prod.unreliableReason ?? "Sin datos confiables" });
      unreliableProductions.add(prod.id);
    }
    // Lo ya consumido (y descontado del stock) no se vuelve a necesitar: se resta por materia prima maestra.
    const consumedLeft = new Map<string, number>();
    for (const [code, kg] of Object.entries(prod.consumedByCode ?? {})) {
      const cur = idx.currentCodeOf.get(normCode(code)) ?? normCode(code);
      const master = idx.masterOfInventoryCode.get(cur) ?? cur;
      consumedLeft.set(master, round3((consumedLeft.get(master) ?? 0) + kg));
    }
    for (const rawLine of prod.lines) {
      const m = matchFormulaLine(idx, rawLine);
      let line = rawLine;
      if (m.status === "vinculada" && rawLine.kg != null) {
        const left = consumedLeft.get(m.masterCode) ?? 0;
        if (left > 0) {
          const used = Math.min(left, rawLine.kg);
          consumedLeft.set(m.masterCode, round3(left - used));
          line = { ...rawLine, kg: round3(rawLine.kg - used) };
        }
      }
      if (m.status === "vinculada") {
        const key = `M:${m.masterCode}`;
        const row = rowFor(key, () => baseRow(idx, key, m.masterCode, m.source, params.todayIso));
        if (m.source === "aprobada" || row.match !== "aprobada") row.match = row.match === "aprobada" ? "aprobada" : m.source;
        addNeed(row, prod, line);
      } else {
        const key = `P:${normText(line.materiaPrima) || normCode(line.codigo)}`;
        const row = rowFor(key, () => ({
          key,
          materiaPrima: line.materiaPrima || line.codigo,
          codigoMaestro: "",
          match: "pendiente",
          stockFisico: 0,
          stockUtilizable: 0,
          reservado: 0,
          requerido: 0,
          saldoProyectado: 0,
          faltante: 0,
          estado: "PENDIENTE DE VINCULAR",
          proveedores: [],
          lotes: [],
          needs: [],
          formulaNames: [],
          candidates: m.candidates,
          pendienteMotivo:
            m.reason === "ambigua"
              ? "Hay más de una materia prima del inventario con ese nombre: elegí cuál es."
              : m.reason === "similar"
                ? "No hay una coincidencia exacta: confirmá con cuál del inventario se corresponde."
                : "No se encontró en el inventario: vinculala o cargala.",
          notas: [],
        }));
        addNeed(row, prod, line);
      }
    }
  }

  const rows = [...byKey.values()].map(finalize).sort(order);
  const summary = { total: rows.length, SUFICIENTE: 0, FALTANTE: 0, "SIN STOCK": 0, "PENDIENTE DE VINCULAR": 0, "SIN DATOS CONFIABLES": 0 } as AvailabilityResult["summary"];
  for (const r of rows) summary[r.estado] += 1;
  return { rows, excluded, summary };

  function addNeed(row: AvailabilityRow, prod: ProductionInput, line: FormulaLine & { kg: number | null }) {
    const nm = (line.materiaPrima || line.codigo).trim();
    if (nm && !row.formulaNames.includes(nm)) row.formulaNames.push(nm);
    if (!prod.reliable || line.kg == null || !Number.isFinite(line.kg)) {
      row.needs.push({ productionId: prod.id, label: prod.label, kg: Number.NaN });
      return;
    }
    row.requerido = round3(row.requerido + line.kg);
    row.needs.push({ productionId: prod.id, label: prod.label, kg: round3(line.kg) });
  }
}

function baseRow(idx: Index, key: string, master: string, source: MatchSource, todayIso: string): AvailabilityRow {
  const lots = idx.lotsByMaster.get(master) ?? [];
  const details: LotDetail[] = lots
    .filter((l) => !l.archived && (l.cantidadKg ?? 0) !== 0)
    .map((l) => {
      const u = lotUsability(l, todayIso);
      return { proveedor: l.proveedor || "(sin proveedor)", lote: l.lote || "(sin lote)", ubicacion: l.ubicacion ?? "", kg: round3(l.cantidadKg ?? 0), usable: u.usable, motivo: u.reason, vencimiento: l.vencimiento ?? "" };
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
  const first = lots[0];
  const codes = [...new Set(lots.map((l) => normCode(l.codigo)))];
  return {
    key,
    materiaPrima: first ? String(first.descripcion).split(/\s+[—–]\s+/)[0]!.trim() : master,
    codigoMaestro: master,
    match: source,
    stockFisico: fisico,
    stockUtilizable: util,
    reservado: 0,
    requerido: 0,
    saldoProyectado: 0,
    faltante: 0,
    estado: "SUFICIENTE",
    proveedores: [...prov.values()],
    lotes: details,
    needs: [],
    formulaNames: [],
    candidates: [],
    notas: codes.length > 1 ? [`Suma ${codes.length} códigos de inventario de la misma materia prima: ${codes.join(", ")}.`] : [],
  };
}

function finalize(r: AvailabilityRow): AvailabilityRow {
  if (r.estado === "PENDIENTE DE VINCULAR") {
    return { ...r, needs: r.needs.map((n) => ({ ...n, kg: Number.isFinite(n.kg) ? n.kg : 0 })) };
  }
  const reliableNeeds = r.needs.filter((n) => Number.isFinite(n.kg));
  const allUnreliable = r.needs.length > 0 && reliableNeeds.length === 0;
  const saldo = round3(r.stockUtilizable - r.reservado - r.requerido);
  const notas = [...r.notas];
  const noUsable = round3(r.stockFisico - r.stockUtilizable);
  if (noUsable > 0) notas.push(`${noUsable} kg físicos NO utilizables (bloqueados, vencidos o no liberados).`);
  if (r.needs.length > reliableNeeds.length) notas.push("Hay producciones sin cantidad confiable que no se sumaron.");
  let estado: AvailabilityStatus;
  if (allUnreliable) estado = "SIN DATOS CONFIABLES";
  else if (r.stockFisico <= 0) estado = r.requerido > 0 ? "SIN STOCK" : "SUFICIENTE";
  else if (saldo < 0) estado = "FALTANTE";
  else estado = "SUFICIENTE";
  return {
    ...r,
    needs: r.needs.map((n) => ({ ...n, kg: Number.isFinite(n.kg) ? n.kg : 0 })),
    saldoProyectado: saldo,
    faltante: saldo < 0 ? round3(-saldo) : 0,
    estado,
    notas,
  };
}

const ORDER: Record<AvailabilityStatus, number> = { "SIN STOCK": 0, FALTANTE: 1, "PENDIENTE DE VINCULAR": 2, "SIN DATOS CONFIABLES": 3, SUFICIENTE: 4 };
function order(a: AvailabilityRow, b: AvailabilityRow) {
  return ORDER[a.estado] - ORDER[b.estado] || a.materiaPrima.localeCompare(b.materiaPrima, "es");
}

/** Stock utilizable consolidado de la MP de UNA línea de control (para las planillas de control individuales). */
export function stockForLine(lots: StockLot[], links: MpLink[], line: FormulaLine, todayIso: string): { linked: boolean; stockUtilizable: number; stockFisico: number; masterCode: string } {
  const idx = buildIndex(lots, links);
  const m = matchFormulaLine(idx, line);
  if (m.status !== "vinculada") return { linked: false, stockUtilizable: 0, stockFisico: 0, masterCode: "" };
  const row = baseRow(idx, `M:${m.masterCode}`, m.masterCode, m.source, todayIso);
  return { linked: true, stockUtilizable: row.stockUtilizable, stockFisico: row.stockFisico, masterCode: m.masterCode };
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
