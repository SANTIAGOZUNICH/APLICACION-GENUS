/**
 * Consumo de materias primas de una OE — reglas PURAS (cliente y servidor, sin base de datos).
 *
 * Qué se descuenta al entregar una OE: los KG REAL UTILIZADO de cada fila (nunca los kg teóricos), del CÓDIGO MP
 * (código de Stock MP) y del LOTE MP indicados. Una MP usada desde varios lotes tiene filas de «lote adicional»; una
 * MP repetida en varias fases suma por (código, lote) sin duplicar.
 *
 * Antes de descontar, cada fila con consumo debe tener CÓDIGO MP existente en Stock MP, KG REAL y LOTE MP. Si algo
 * falta se informa la fila exacta y no se descuenta NADA.
 *
 * Fila de Stock MP que se descuenta (nunca se adivina):
 *  - el lote tiene su propia fila en Stock MP para ese código → esa fila;
 *  - el código tiene UNA sola fila en Stock MP (Ingresos MP acumula todos los lotes de un código en esa fila) → esa
 *    fila; el lote real queda registrado igual en el libro mayor y en la auditoría;
 *  - el código tiene varias filas y ninguna es de ese lote → se pide corregir el lote (no se elige una al azar).
 */
import type { OeMaterialRow } from "@/lib/orders/types";
import { normalizeSearchKey } from "@/lib/formulas/types";

/** Lote de la planilla Stock MP (catálogo con lotes y kg). */
export type MpCatalogLot = {
  id: string;
  codigo: string;
  codigosAnteriores?: string[];
  descripcion: string;
  lote: string;
  cantidadKg: number | null;
  archived?: boolean;
};

export const normMpCode = (c: string | null | undefined) => String(c ?? "").trim().replace(/\s+/g, " ").toUpperCase();
export const normMpLote = (l: string | null | undefined) => String(l ?? "").trim().replace(/\s+/g, " ").toUpperCase();

export type ConsumptionIssue = {
  rowId: string;
  /** Número de fila tal como se ve en la tabla de la OE (1, 2, 3…). */
  rowNumber: number;
  materiaPrima: string;
  field: "codigoMp" | "kgReal" | "lote" | "fila";
  message: string;
};

/** Un consumo a descontar: (código, lote real) con la suma de kg reales de las filas que lo usan. */
export type ConsumptionLine = {
  codigo: string;
  /** Lote real informado por Elaboración. */
  lote: string;
  /** Fila de Stock MP que se descuenta. */
  lotId: string;
  /** true si el lote no tiene fila propia y se descuenta de la única fila del código. */
  viaCodigo: boolean;
  kg: number;
  materiaPrima: string;
  rowIds: string[];
};

const activeLots = (catalog: MpCatalogLot[]) => catalog.filter((l) => !l.archived);

function lotsForCode(catalog: MpCatalogLot[], code: string): MpCatalogLot[] {
  return activeLots(catalog).filter(
    (l) => normMpCode(l.codigo) === code || (l.codigosAnteriores ?? []).some((c) => normMpCode(c) === code)
  );
}

export function codeExistsInCatalog(catalog: MpCatalogLot[], codigo: string): boolean {
  const code = normMpCode(codigo);
  return Boolean(code) && lotsForCode(catalog, code).length > 0;
}

/** Fila completamente vacía (sin MP, código, % ni datos): no participa. */
function isBlankRow(m: OeMaterialRow): boolean {
  return (
    !m.materiaPrima.trim() &&
    !m.codigo.trim() &&
    !m.codigoMp.trim() &&
    m.formulaPct == null &&
    m.kgReal == null &&
    !m.lote.trim()
  );
}

export function buildOeConsumptionPlan(
  materials: OeMaterialRow[],
  catalog: MpCatalogLot[],
  /** `progress`: «Guardar avance». Una fila sin KG REAL UTILIZADO todavía NO se consumió: se ignora (no es un faltante). */
  opts: { progress?: boolean } = {}
): { lines: ConsumptionLine[]; issues: ConsumptionIssue[] } {
  const issues: ConsumptionIssue[] = [];
  const grouped = new Map<string, ConsumptionLine>();
  const parentOf = new Map(materials.map((m) => [m.id, m]));

  materials.forEach((m, i) => {
    if (isBlankRow(m)) return;
    const parent = m.parentRowId ? parentOf.get(m.parentRowId) : undefined;
    const materiaPrima = (parent?.materiaPrima || m.materiaPrima || m.codigo || "MP").trim();
    const where = `Fila ${i + 1}${m.parentRowId ? " (lote adicional)" : ""} — ${materiaPrima}`;
    const issue = (field: ConsumptionIssue["field"], message: string) =>
      issues.push({ rowId: m.id, rowNumber: i + 1, materiaPrima, field, message: `${where}: ${message}` });

    if (m.kgReal == null) {
      if (!opts.progress) issue("kgReal", "falta KG REAL UTILIZADO.");
      return;
    }
    if (!(m.kgReal >= 0)) {
      issue("kgReal", "KG REAL UTILIZADO no puede ser negativo.");
      return;
    }
    if (m.kgReal === 0) return; // se informó que no se usó: no hay consumo
    const code = normMpCode(m.codigoMp || parent?.codigoMp);
    if (!code) {
      issue("codigoMp", "falta CÓDIGO MP (el código de Stock MP).");
      return;
    }
    const codeLots = lotsForCode(catalog, code);
    if (codeLots.length === 0) {
      issue("codigoMp", `el CÓDIGO MP «${code}» no existe en Stock MP.`);
      return;
    }
    const lote = normMpLote(m.lote);
    if (!lote) {
      issue("lote", "falta LOTE MP.");
      return;
    }
    const matches = codeLots.filter((l) => normMpLote(l.lote) === lote);
    if (matches.length > 1) {
      issue("lote", `hay ${matches.length} lotes «${m.lote.trim()}» del código ${code} en Stock MP: Materia Prima debe unificarlos.`);
      return;
    }
    if (matches.length === 0 && codeLots.length > 1) {
      issue(
        "lote",
        `el lote «${m.lote.trim()}» no está en Stock MP para el código ${code} (lotes: ${codeLots.map((l) => l.lote.trim() || "sin lote").join(", ")}).`
      );
      return;
    }
    const lot = matches[0] ?? codeLots[0]!;
    const realLote = m.lote.trim().replace(/\s+/g, " ");
    const key = `${code}|${lote}`;
    const prev = grouped.get(key);
    if (prev) {
      prev.kg = Number((prev.kg + m.kgReal).toFixed(4));
      prev.rowIds.push(m.id);
    } else {
      grouped.set(key, {
        codigo: code,
        lote: matches[0] ? lot.lote.trim() : realLote,
        lotId: lot.id,
        viaCodigo: !matches[0],
        kg: Number(m.kgReal.toFixed(4)),
        materiaPrima,
        rowIds: [m.id],
      });
    }
  });

  return { lines: [...grouped.values()], issues };
}

export type LotShortage = { codigo: string; lote: string; disponible: number; requerido: number; faltante: number; tipo: "lote" | "codigo" };

/** Stock de la fila de Stock MP insuficiente para lo que se le va a descontar (suma de todas las líneas que la usan;
 * sin conciliar con el stock por código). */
export function lotShortages(lines: Array<{ codigo: string; lote: string; lotId: string; delta: number }>, catalog: MpCatalogLot[]): LotShortage[] {
  const byLot = new Map<string, { codigo: string; lotes: string[]; delta: number }>();
  for (const l of lines) {
    const prev = byLot.get(l.lotId) ?? { codigo: l.codigo, lotes: [], delta: 0 };
    prev.delta = Number((prev.delta + l.delta).toFixed(4));
    if (!prev.lotes.includes(l.lote)) prev.lotes.push(l.lote);
    byLot.set(l.lotId, prev);
  }
  const out: LotShortage[] = [];
  for (const [lotId, l] of byLot) {
    if (l.delta >= 0) continue;
    const lot = catalog.find((x) => x.id === lotId);
    const disponible = Number((lot?.cantidadKg ?? 0).toFixed(4));
    const requerido = Number((-l.delta).toFixed(4));
    if (disponible < requerido) {
      out.push({ codigo: l.codigo, lote: l.lotes.join(" + "), disponible, requerido, faltante: Number((requerido - disponible).toFixed(4)), tipo: "lote" });
    }
  }
  return out;
}

export type CodigoMpSuggestion = { kind: "one"; codigo: string } | { kind: "none" } | { kind: "many"; codigos: string[] };

/**
 * Sugerencia de CÓDIGO MP: si el código de la fórmula coincide con un código de Stock MP (o uno anterior) de forma
 * inequívoca; si no, si el nombre de la MP coincide exacto con la descripción de un único código. Nunca inventa.
 */
export function suggestCodigoMp(row: Pick<OeMaterialRow, "codigo" | "materiaPrima">, catalog: MpCatalogLot[]): CodigoMpSuggestion {
  const lots = activeLots(catalog);
  const formulaCode = normMpCode(row.codigo);
  if (formulaCode) {
    const byCode = new Set(
      lots
        .filter((l) => normMpCode(l.codigo) === formulaCode || (l.codigosAnteriores ?? []).some((c) => normMpCode(c) === formulaCode))
        .map((l) => normMpCode(l.codigo))
    );
    if (byCode.size === 1) return { kind: "one", codigo: [...byCode][0]! };
    if (byCode.size > 1) return { kind: "many", codigos: [...byCode].sort() };
  }
  const name = normalizeSearchKey(row.materiaPrima ?? "");
  if (name) {
    const byName = new Set(lots.filter((l) => normalizeSearchKey(l.descripcion) === name).map((l) => normMpCode(l.codigo)));
    if (byName.size === 1) return { kind: "one", codigo: [...byName][0]! };
    if (byName.size > 1) return { kind: "many", codigos: [...byName].sort() };
  }
  return { kind: "none" };
}

/** Completa CÓDIGO MP vacíos con sugerencias inequívocas. Nunca pisa uno ya cargado. */
export function fillCodigoMpSuggestions(materials: OeMaterialRow[], catalog: MpCatalogLot[]): OeMaterialRow[] {
  return materials.map((m) => {
    if (m.parentRowId || m.codigoMp.trim()) return m;
    const s = suggestCodigoMp(m, catalog);
    return s.kind === "one" ? { ...m, codigoMp: s.codigo } : m;
  });
}

/** Marca en `completion.pendingAtCompletion`: la OE se entregó pero su descuento de MP quedó pendiente. */
export const MP_CONSUMO_PENDIENTE = "Descuento de materias primas";

/** ¿La OE entregada tiene el descuento de MP todavía pendiente? (marca puesta y sin resolver) */
export function hasMpConsumoPendiente(content: { kind?: string; completion?: { pendingAtCompletion: string[]; resolved: Array<{ field: string }> } | null } | null | undefined): boolean {
  const c = content?.completion;
  return Boolean(content?.kind === "OE" && c?.pendingAtCompletion.includes(MP_CONSUMO_PENDIENTE) && !c.resolved.some((r) => r.field === MP_CONSUMO_PENDIENTE));
}
