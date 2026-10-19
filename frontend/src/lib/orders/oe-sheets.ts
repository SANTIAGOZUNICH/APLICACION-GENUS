/**
 * Hojas de elaboración (tambores / ollas) dentro de UNA OE — reglas PURAS (cliente y servidor).
 *
 * - La fórmula (MP, códigos, %) sale SIEMPRE de la OE principal; una hoja nueva copia solo eso. Lotes, kg reales,
 *   firmas, responsables, fechas y estados NO se copian: cada hoja arranca como una preparación independiente.
 * - Los kg teóricos de cada MP = kg planificados de la hoja × % de la fórmula (mismo redondeo que la OE: 4 decimales).
 * - Consumo de stock: UNA sola fuente de verdad. Si hay hojas, se consumen los kg reales de las hojas (las
 *   pendientes sin datos no cuentan); la hoja principal solo cuenta si ya traía datos reales (OE histórica).
 */
import type { OeContent, OeMaterialRow, OeSheet, OeSheetKind, OeSheetStatus } from "@/lib/orders/types";
import { recomputeOeDerived } from "@/lib/orders/content";

export const SHEET_KIND_LABEL: Record<OeSheetKind, string> = { tambor: "Tambor", olla: "Olla", otro: "Preparación" };
export const SHEET_STATUS_LABEL: Record<OeSheetStatus, string> = {
  pendiente: "Pendiente",
  en_elaboracion: "En elaboración",
  elaborado: "Elaborado",
  observado: "Observado / Retenido",
  aprobado: "Aprobado",
};
const KINDS = Object.keys(SHEET_KIND_LABEL) as OeSheetKind[];
const STATUSES = Object.keys(SHEET_STATUS_LABEL) as OeSheetStatus[];
export const MAX_SHEETS = 40;

const round4 = (n: number) => Number(n.toFixed(4));
const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
const numOrNull = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : v == null || v === "" ? NaN : Number(v);
  return Number.isFinite(n) && n >= 0 ? round4(n) : null;
};

export function newSheetId(): string {
  const r = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `sh_${r}`;
}

export const sheetLabel = (s: Pick<OeSheet, "kind" | "number" | "name">) =>
  s.name.trim() || `${SHEET_KIND_LABEL[s.kind]}${s.number.trim() ? ` ${s.number.trim()}` : ""}`;

export const hasRealData = (m: OeMaterialRow) => m.kgReal != null || Boolean(m.lote.trim());
export const sheetHasRealData = (s: OeSheet) => s.materials.some(hasRealData);

/** Fila de hoja a partir de la fila de fórmula: SOLO estructura (sin lote, kg reales ni ajustes). */
function sheetRowFromFormula(sheetId: string, row: OeMaterialRow): OeMaterialRow {
  return {
    id: `${sheetId}:${row.id}`,
    materiaPrima: row.materiaPrima,
    codigo: row.codigo,
    formulaPct: row.formulaPct,
    kgAPesar: null,
    ajuste: null,
    ajusteMotivo: "",
    ajusteAt: null,
    ajusteBy: null,
    lote: "",
    codigoMp: row.codigoMp,
    kgReal: null,
    parentRowId: null,
  };
}

/** Recalcula kg teóricos y diferencias de una hoja (nunca toca kg reales ni lotes). */
export function recomputeSheet(content: OeContent, sheet: OeSheet): OeSheet {
  const base: OeContent = { ...content, sheets: undefined, materials: sheet.materials, header: { ...content.header, quantityKg: sheet.kgPlanificados } };
  return { ...sheet, materials: recomputeOeDerived(base).materials };
}

export function createSheet(content: OeContent, opts: { kind: OeSheetKind; kg: number | null; number?: string; name?: string; by: string; now?: string }): OeSheet {
  const id = newSheetId();
  const existing = content.sheets ?? [];
  const sameKind = existing.filter((s) => s.kind === opts.kind).length;
  const sheet: OeSheet = {
    id,
    kind: opts.kind,
    number: opts.number ?? String(sameKind + 1),
    name: opts.name ?? "",
    kgPlanificados: opts.kg,
    kgElaborados: null,
    status: "pendiente",
    operario: "",
    inicioAt: "",
    finAt: "",
    incidencias: "",
    observaciones: "",
    materials: content.materials.filter((m) => !m.parentRowId).map((m) => sheetRowFromFormula(id, m)),
    createdAt: opts.now ?? new Date().toISOString(),
    createdBy: opts.by,
    history: [{ at: opts.now ?? new Date().toISOString(), by: opts.by, text: "Hoja creada" }],
  };
  return recomputeSheet(content, sheet);
}

/**
 * Valida y normaliza las hojas que llegan del cliente (SERVIDOR y cliente): la estructura de la fórmula se
 * reconstruye SIEMPRE desde la OE principal (nadie puede inventar ingredientes ni porcentajes); del cliente solo se
 * aceptan los datos operativos. Agrega al historial lo que cambió. Hojas con datos reales no se pueden quitar.
 */
export function mergeSheets(current: OeContent, incoming: OeSheet[] | undefined, actorEmail: string, now = new Date().toISOString()): OeSheet[] | undefined {
  const prevSheets = current.sheets ?? [];
  if (incoming === undefined) return current.sheets;
  const prevById = new Map(prevSheets.map((s) => [s.id, s]));
  const main = current.materials.filter((m) => !m.parentRowId);
  const out: OeSheet[] = [];
  const seen = new Set<string>();
  for (const inc of incoming.slice(0, MAX_SHEETS)) {
    if (!inc || typeof inc.id !== "string" || !inc.id.startsWith("sh_") || seen.has(inc.id)) continue;
    seen.add(inc.id);
    const prev = prevById.get(inc.id);
    const incRows = new Map((inc.materials ?? []).map((m) => [m.id, m]));
    const materials: OeMaterialRow[] = [];
    for (const row of main) {
      const sid = `${inc.id}:${row.id}`;
      const before = prev?.materials.find((x) => x.id === sid);
      const base = before ?? sheetRowFromFormula(inc.id, row);
      const from = incRows.get(sid);
      const patched = patchOps({ ...base, materiaPrima: row.materiaPrima, codigo: row.codigo, formulaPct: row.formulaPct }, from, actorEmail, now, row.codigoMp);
      materials.push(patched);
      for (const child of (inc.materials ?? []).filter((x) => x.parentRowId === sid)) {
        const b = prev?.materials.find((x) => x.id === child.id && x.parentRowId === sid);
        const childBase: OeMaterialRow = b ?? { ...sheetRowFromFormula(inc.id, row), id: String(child.id), parentRowId: sid, formulaPct: null };
        materials.push({
          ...patchOps(childBase, child, actorEmail, now, patched.codigoMp),
          id: childBase.id,
          materiaPrima: patched.materiaPrima,
          codigo: patched.codigo,
          codigoMp: patched.codigoMp,
          parentRowId: sid,
          formulaPct: null,
          kgAPesar: null,
        });
      }
    }
    // Fila de una MP que ya no está en la fórmula pero tiene datos reales en esta hoja: se conserva (trazabilidad).
    const mainIds = new Set(main.map((r) => `${inc.id}:${r.id}`));
    for (const o of prev?.materials ?? []) {
      const parentOk = o.parentRowId ? mainIds.has(o.parentRowId) : mainIds.has(o.id);
      if (!parentOk && hasRealData(o) && !materials.some((x) => x.id === o.id)) materials.push(o);
    }
    const kind = KINDS.includes(inc.kind) ? inc.kind : "otro";
    const status = STATUSES.includes(inc.status) ? inc.status : "pendiente";
    const next: OeSheet = {
      id: inc.id,
      kind,
      number: str(inc.number, 20),
      name: str(inc.name, 80),
      kgPlanificados: numOrNull(inc.kgPlanificados),
      kgElaborados: numOrNull(inc.kgElaborados),
      status,
      operario: str(inc.operario, 80),
      inicioAt: str(inc.inicioAt, 40),
      finAt: str(inc.finAt, 40),
      incidencias: str(inc.incidencias, 2000),
      observaciones: str(inc.observaciones, 2000),
      materials,
      createdAt: prev?.createdAt ?? now,
      createdBy: prev?.createdBy ?? actorEmail,
      history: prev?.history ?? [{ at: now, by: actorEmail, text: "Hoja creada" }],
    };
    if (prev) {
      const notes: string[] = [];
      if (prev.status !== next.status) notes.push(`Estado: ${SHEET_STATUS_LABEL[prev.status]} → ${SHEET_STATUS_LABEL[next.status]}`);
      if (prev.kgPlanificados !== next.kgPlanificados) notes.push(`Kg planificados: ${prev.kgPlanificados ?? "—"} → ${next.kgPlanificados ?? "—"}`);
      if (prev.kgElaborados !== next.kgElaborados) notes.push(`Kg elaborados: ${prev.kgElaborados ?? "—"} → ${next.kgElaborados ?? "—"}`);
      if (prev.operario !== next.operario) notes.push(`Responsable: ${prev.operario || "—"} → ${next.operario || "—"}`);
      if (prev.incidencias !== next.incidencias) notes.push("Incidencias modificadas");
      const realChanged = materials.some((m, i) => {
        const o = prev.materials.find((x) => x.id === m.id);
        return !o || o.kgReal !== m.kgReal || o.lote !== m.lote;
      });
      if (realChanged) notes.push("Kg reales / lotes modificados");
      if (notes.length) next.history = [...next.history, { at: now, by: actorEmail, text: notes.join(" · ") }].slice(-200);
    }
    out.push(recomputeSheet(current, next));
  }
  // Hojas con datos reales que el cliente no mandó (o intentó quitar): se conservan.
  for (const prev of prevSheets) if (!seen.has(prev.id) && sheetHasRealData(prev)) out.push(prev);
  return out;
}

function patchOps(m: OeMaterialRow, next: OeMaterialRow | undefined, by: string, now: string, formulaCodigoMp: string): OeMaterialRow {
  if (!next) return { ...m, codigoMp: m.codigoMp || formulaCodigoMp };
  const kgReal = next.kgReal == null ? null : Number.isFinite(Number(next.kgReal)) && Number(next.kgReal) >= 0 ? Number(next.kgReal) : m.kgReal;
  const lote = str(next.lote, 80);
  const codigoMp = str(next.codigoMp, 60);
  const motivo = str(next.ajusteMotivo, 500);
  const changed = kgReal !== m.kgReal || lote !== m.lote || codigoMp !== m.codigoMp || motivo !== m.ajusteMotivo;
  return { ...m, kgReal, lote, codigoMp, ajusteMotivo: motivo, ajusteAt: changed ? now : m.ajusteAt, ajusteBy: changed ? by : m.ajusteBy };
}

/** Filas que alimentan el descuento de stock de la OE (única fuente de verdad). */
export function consumptionMaterials(content: OeContent): OeMaterialRow[] {
  const sheets = content.sheets ?? [];
  if (sheets.length === 0) return content.materials;
  const mainHasData = content.materials.some(hasRealData);
  const fromSheets = sheets.filter((s) => s.status !== "pendiente" || sheetHasRealData(s)).flatMap((s) => s.materials);
  return mainHasData ? [...content.materials, ...fromSheets] : fromSheets;
}

export type SheetsSummary = {
  requestedKg: number | null;
  plannedKg: number;
  elaboratedKg: number;
  pendingKg: number | null;
  exceedsKg: number;
  count: number;
  byStatus: Record<OeSheetStatus, number>;
  consolidated: Array<{ codigoMp: string; materiaPrima: string; kgTeorico: number; kgReal: number; lots: Array<{ lote: string; kg: number }> }>;
};

export function summarizeSheets(content: OeContent): SheetsSummary {
  const sheets = content.sheets ?? [];
  const requestedKg = content.header.quantityKg ?? null;
  const plannedKg = round4(sheets.reduce((s, x) => s + (x.kgPlanificados ?? 0), 0));
  const elaboratedKg = round4(sheets.reduce((s, x) => s + (x.status === "elaborado" || x.status === "aprobado" ? (x.kgElaborados ?? 0) : 0), 0));
  const byStatus = Object.fromEntries(STATUSES.map((st) => [st, sheets.filter((x) => x.status === st).length])) as Record<OeSheetStatus, number>;
  const map = new Map<string, SheetsSummary["consolidated"][number]>();
  for (const s of sheets) {
    const parentOf = new Map(s.materials.map((m) => [m.id, m]));
    for (const m of s.materials) {
      const p = m.parentRowId ? parentOf.get(m.parentRowId) : m;
      const key = (p?.codigoMp || p?.codigo || p?.materiaPrima || "?").toUpperCase();
      const e = map.get(key) ?? { codigoMp: p?.codigoMp || p?.codigo || "", materiaPrima: p?.materiaPrima ?? "", kgTeorico: 0, kgReal: 0, lots: [] };
      e.kgTeorico = round4(e.kgTeorico + (m.kgAPesar ?? 0));
      if (m.kgReal != null) {
        e.kgReal = round4(e.kgReal + m.kgReal);
        const lote = m.lote.trim() || "(sin lote)";
        const lot = e.lots.find((l) => l.lote === lote);
        if (lot) lot.kg = round4(lot.kg + m.kgReal);
        else e.lots.push({ lote, kg: round4(m.kgReal) });
      }
      map.set(key, e);
    }
  }
  return {
    requestedKg,
    plannedKg,
    elaboratedKg,
    pendingKg: requestedKg == null ? null : Math.max(0, round4(requestedKg - elaboratedKg)),
    exceedsKg: requestedKg != null && plannedKg > requestedKg ? round4(plannedKg - requestedKg) : 0,
    count: sheets.length,
    byStatus,
    consolidated: [...map.values()],
  };
}
