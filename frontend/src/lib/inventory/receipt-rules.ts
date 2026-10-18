/**
 * Ingreso de MP / ME con foto de remito — reglas PURAS (cliente y servidor).
 * Nada de acá toca stock: valida, normaliza, sugiere materiales y detecta duplicados. El servidor vuelve a validar todo.
 */
import type { SectorId } from "@/types/operational/sector";
import { canReadInventory, canWriteInventory } from "@/lib/inventory/rbac";

export type ReceiptModule = "MP" | "ME";
export type ReceiptStatus = "BORRADOR" | "CONFIRMADO" | "DESCARTADO";

export const RECEIPT_MAX_LINES = 60;
export const RECEIPT_MAX_FILES = 20;

export const receiptInventoryModule = (m: ReceiptModule) => (m === "MP" ? ("mp_ingresos" as const) : ("me_ingresos" as const));
export const parseReceiptModule = (raw: unknown): ReceiptModule | null => {
  const v = String(raw ?? "").trim().toUpperCase();
  return v === "MP" || v === "ME" ? v : null;
};
/** Registrar ingresos: exactamente quien ya puede cargar ingresos del módulo (MP: Materia Prima; ME: Depósito; Dirección ambos). */
export const canWriteReceipts = (sector: SectorId | undefined, m: ReceiptModule) => canWriteInventory(sector, receiptInventoryModule(m));
export const canReadReceipts = (sector: SectorId | undefined, m: ReceiptModule) => canReadInventory(sector, receiptInventoryModule(m));

// ───────────────────────── Borrador ─────────────────────────

export type ReceiptHeaderDraft = {
  supplier: string;
  remitoNumber: string;
  /** Fecha impresa en el remito (la entrega el proveedor). */
  remitoDate: string;
  /** Fecha en que la mercadería llegó físicamente (la define quien recibe). */
  receivedDate: string;
  notes: string;
};

export type ReceiptLineDraft = {
  /** Id estable en pantalla (no es el id del ingreso). */
  id: string;
  /** Código impreso por el proveedor: NO es un código interno de GENUS OS. */
  supplierCode: string;
  description: string;
  /** Código interno elegido del catálogo real ("" = sin vincular). */
  materialCode: string;
  /** Cantidad efectivamente recibida, tal como se tipeó (es-AR). */
  quantity: string;
  /** Cantidad que dice el remito (para recepciones parciales). Opcional. */
  remitoQuantity: string;
  unit: string;
  packages: string;
  lote: string;
  /** ISO yyyy-mm-dd. */
  vencimiento: string;
  /** MP: la mercadería no trae vencimiento (confirmación explícita). */
  noExpiry: boolean;
  notes: string;
  /** Campos que la lectura automática marcó como ilegibles/ambiguos («Revisar»). */
  review: string[];
  matchSource?: "previo" | "codigo" | "manual" | "";
};

export type ReceiptDraftPayload = {
  header: ReceiptHeaderDraft;
  lines: ReceiptLineDraft[];
  /** Resultado de la lectura automática (solo sugerencia). */
  extraction?: { provider: string; at: string; ok: boolean; note?: string } | null;
};

export const emptyHeader = (): ReceiptHeaderDraft => ({ supplier: "", remitoNumber: "", remitoDate: "", receivedDate: "", notes: "" });
export const emptyLine = (id: string): ReceiptLineDraft => ({
  id, supplierCode: "", description: "", materialCode: "", quantity: "", remitoQuantity: "", unit: "", packages: "", lote: "", vencimiento: "", noExpiry: false, notes: "", review: [], matchSource: "",
});

// ───────────────────────── Normalización ─────────────────────────

const strip = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
/** Proveedor: sin tildes/mayúsculas/puntuación ni sufijos societarios, para comparar. */
export function supplierKey(raw: string): string {
  return strip(String(raw ?? ""))
    .toUpperCase()
    .replace(/\./g, "")
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\b(SA|SRL|SAS|SH|SACIF|SACI|SAIC|LTDA|INC|LLC|CIA)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
/** N.º de remito: «0001-00012345» y «1-12345» son el mismo. */
export function remitoKey(raw: string): string {
  const tokens = strip(String(raw ?? "")).toUpperCase().match(/[A-Z0-9]+/g) ?? [];
  return tokens.map((t) => (/^\d+$/.test(t) ? t.replace(/^0+/, "") || "0" : t)).join("-");
}
export const codeKey = (raw: string) => strip(String(raw ?? "")).toUpperCase().replace(/[^A-Z0-9]+/g, "");
export const normalizeMaterialCode = (raw: string) => String(raw ?? "").trim().replace(/\s+/g, " ").toUpperCase();

/** Número en formato es-AR o internacional: «1.200,5», «1200.5», «1,5». null si no es un número. */
export function parseNumber(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  let t = String(raw ?? "").trim().replace(/\s| /g, "");
  if (!t || !/^[-+]?[\d.,]+$/.test(t)) return null;
  const lastDot = t.lastIndexOf(".");
  const lastComma = t.lastIndexOf(",");
  if (lastDot >= 0 && lastComma >= 0) {
    const dec = lastDot > lastComma ? "." : ",";
    t = dec === "," ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
  } else if (lastComma >= 0) {
    t = t.split(",").length > 2 ? t.replace(/,/g, "") : t.replace(",", ".");
  } else if (lastDot >= 0 && /^[-+]?\d{1,3}(\.\d{3})+$/.test(t)) {
    t = t.replace(/\./g, "");
  }
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export const isIsoDate = (s: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

// ───────────────────────── Unidades ─────────────────────────

const UNIT_GROUPS: Array<{ canonical: string; aliases: string[] }> = [
  { canonical: "kg", aliases: ["kg", "kgs", "kilo", "kilos", "kilogramo", "kilogramos", "kgr"] },
  { canonical: "g", aliases: ["g", "gr", "grs", "gramo", "gramos"] },
  { canonical: "t", aliases: ["t", "tn", "ton", "tonelada", "toneladas"] },
  { canonical: "l", aliases: ["l", "lt", "lts", "litro", "litros"] },
  { canonical: "u", aliases: ["u", "un", "uni", "unid", "unidad", "unidades", "uds", "und", "unds"] },
];
export function canonicalUnit(raw: string): string {
  const t = strip(String(raw ?? "")).toLowerCase().replace(/[.\s]/g, "");
  if (!t) return "";
  return UNIT_GROUPS.find((g) => g.aliases.includes(t))?.canonical ?? t;
}
const MASS_TO_KG: Record<string, number> = { kg: 1, g: 0.001, t: 1000 };

/**
 * Convierte la cantidad de la línea a la unidad del material. MP trabaja en kg (se aceptan g y t); ME en la unidad del
 * material. Distinta e inconvertible ⇒ error: nunca se adivina (p. ej. litros → kg necesita densidad).
 */
export function convertQuantity(qty: number, lineUnit: string, materialUnit: string): { ok: true; value: number; unit: string } | { ok: false; message: string } {
  const to = canonicalUnit(materialUnit) || "u";
  const from = canonicalUnit(lineUnit) || to;
  if (from === to) return { ok: true, value: qty, unit: to };
  if (MASS_TO_KG[from] && MASS_TO_KG[to]) return { ok: true, value: Math.round(qty * MASS_TO_KG[from]! / MASS_TO_KG[to]! * 1e6) / 1e6, unit: to };
  return { ok: false, message: `La unidad «${lineUnit}» no coincide con la del material (${materialUnit || to}). Corregila o elegí el material correcto.` };
}

// ───────────────────────── Validación ─────────────────────────

export type CatalogItem = { code: string; description: string; unit: string };
export type ReceiptIssue = { line: number | null; field: string; code: string; message: string };

export type NormalizedLine = {
  index: number;
  supplierCode: string;
  description: string;
  materialCode: string;
  materialLabel: string;
  /** Cantidad recibida en la unidad del material. */
  quantity: number;
  unit: string;
  remitoQuantity: number | null;
  packages: number | null;
  lote: string;
  vencimiento: string;
  notes: string;
};

export type ValidationResult = { ok: boolean; issues: ReceiptIssue[]; lines: NormalizedLine[] };

/** Revisa el borrador completo. `catalog` es el catálogo REAL del módulo (el servidor lo lee de la base). */
export function validateReceipt(module: ReceiptModule, draft: ReceiptDraftPayload, catalog: Map<string, CatalogItem>, today: string): ValidationResult {
  const issues: ReceiptIssue[] = [];
  const add = (line: number | null, field: string, code: string, message: string) => issues.push({ line, field, code, message });
  const h = draft.header;
  if (!h.supplier.trim()) add(null, "supplier", "REQUIRED", "Falta el proveedor.");
  if (!h.remitoNumber.trim()) add(null, "remitoNumber", "REQUIRED", "Falta el número de remito.");
  if (!isIsoDate(h.receivedDate)) add(null, "receivedDate", "REQUIRED", "Indicá la fecha en que se recibió la mercadería.");
  else if (h.receivedDate > today) add(null, "receivedDate", "FUTURE", "La fecha de recepción no puede ser futura.");
  if (h.remitoDate && !isIsoDate(h.remitoDate)) add(null, "remitoDate", "INVALID", "La fecha del remito no es válida.");
  else if (h.remitoDate && isIsoDate(h.receivedDate) && h.remitoDate > h.receivedDate) add(null, "remitoDate", "ORDER", "La fecha del remito es posterior a la de recepción: revisala.");
  if (draft.lines.length === 0) add(null, "lines", "REQUIRED", "Agregá al menos un material.");
  if (draft.lines.length > RECEIPT_MAX_LINES) add(null, "lines", "TOO_MANY", `Máximo ${RECEIPT_MAX_LINES} líneas por remito.`);

  const lines: NormalizedLine[] = [];
  draft.lines.slice(0, RECEIPT_MAX_LINES).forEach((l, i) => {
    const code = normalizeMaterialCode(l.materialCode);
    const mat = code ? catalog.get(code) : undefined;
    if (!code) add(i, "materialCode", "NO_MATERIAL", "Elegí el material de GENUS OS que corresponde a esta línea.");
    else if (!mat) add(i, "materialCode", "UNKNOWN_MATERIAL", `El código «${code}» no existe en el catálogo. No se crean materiales desde un remito: elegí uno existente o pedí el alta autorizada.`);
    const qty = parseNumber(l.quantity);
    if (qty == null || !(qty > 0)) add(i, "quantity", "QTY", "La cantidad recibida debe ser un número mayor que 0.");
    const remitoQty = l.remitoQuantity.trim() ? parseNumber(l.remitoQuantity) : null;
    if (l.remitoQuantity.trim() && (remitoQty == null || remitoQty < 0)) add(i, "remitoQuantity", "QTY", "La cantidad del remito no es válida.");
    const packages = l.packages.trim() ? parseNumber(l.packages) : null;
    if (l.packages.trim() && (packages == null || !(packages > 0))) add(i, "packages", "QTY", "Los bultos deben ser un número mayor que 0.");
    let converted: number | null = null;
    let unit = mat ? canonicalUnit(mat.unit) || (module === "MP" ? "kg" : "u") : "";
    if (mat && qty != null && qty > 0) {
      const c = convertQuantity(qty, l.unit, module === "MP" ? "kg" : mat.unit);
      if (!c.ok) add(i, "unit", "UNIT", c.message);
      else {
        converted = c.value;
        unit = c.unit;
      }
    }
    if (module === "MP") {
      if (!l.lote.trim()) add(i, "lote", "LOTE", "Falta el lote del proveedor: es obligatorio para materias primas.");
      if (l.vencimiento.trim()) {
        if (!isIsoDate(l.vencimiento.trim())) add(i, "vencimiento", "INVALID", "El vencimiento no es una fecha válida.");
      } else if (!l.noExpiry) {
        add(i, "vencimiento", "VTO", "Falta el vencimiento. Si la mercadería no lo trae, tildá «Sin vencimiento».");
      }
    }
    if (mat && converted != null) {
      lines.push({
        index: i,
        supplierCode: l.supplierCode.trim(),
        description: l.description.trim(),
        materialCode: mat.code,
        materialLabel: mat.description,
        quantity: converted,
        unit,
        remitoQuantity: remitoQty == null ? null : (() => { const c = convertQuantity(remitoQty, l.unit, module === "MP" ? "kg" : mat.unit); return c.ok ? c.value : remitoQty; })(),
        packages,
        lote: l.lote.trim(),
        vencimiento: l.vencimiento.trim(),
        notes: l.notes.trim(),
      });
    }
  });
  return { ok: issues.length === 0, issues, lines };
}

/** Bultos × cantidad por bulto = total recibido (las planillas guardan ambos). Sin división exacta: bultos null y la cantidad total. */
export function splitPackages(total: number, packages: number | null): { bultos: number | null; cantidad: number } {
  if (packages && Number.isInteger(packages) && packages > 0 && Number.isInteger(total) && total % packages === 0) return { bultos: packages, cantidad: total / packages };
  return { bultos: null, cantidad: total };
}

// ───────────────────────── Sugerencia de materiales ─────────────────────────

export type MaterialSuggestion = { code: string; description: string; unit: string; score: number; reason: string };
/** Historial: (proveedor, código del proveedor) → material interno ya usado en un ingreso confirmado. */
export type MappingHistory = Map<string, { code: string; count: number }>;
export const mappingKey = (supplier: string, supplierCode: string) => `${supplierKey(supplier)}|${codeKey(supplierCode)}`;

const STOP = new Set(["DE", "DEL", "LA", "EL", "LOS", "LAS", "Y", "EN", "CON", "PARA", "POR", "A", "X", "UN", "UNA"]);
const tokens = (s: string) => strip(s).toUpperCase().replace(/[^A-Z0-9]+/g, " ").split(" ").filter((t) => t.length > 1 && !STOP.has(t));

/**
 * Sugiere materiales del catálogo para una línea. Es solo una ayuda: el operario confirma. El código del proveedor NO se
 * toma como código interno; solo se pre-selecciona con un uso previo confirmado (mismo proveedor + mismo código del proveedor).
 */
export function suggestMaterials(line: { supplier: string; supplierCode: string; description: string }, catalog: Iterable<CatalogItem>, history: MappingHistory, limit = 5): MaterialSuggestion[] {
  const out: MaterialSuggestion[] = [];
  const prev = line.supplierCode.trim() ? history.get(mappingKey(line.supplier, line.supplierCode)) : undefined;
  const want = new Set(tokens(`${line.description} ${line.supplierCode}`));
  for (const m of catalog) {
    let score = 0;
    let reason = "";
    if (prev && prev.code === m.code) {
      score = 1;
      reason = `Ya se usó con este proveedor y este código (${prev.count} vez${prev.count === 1 ? "" : "es"})`;
    } else {
      const have = new Set(tokens(`${m.description} ${m.code}`));
      if (want.size && have.size) {
        let inter = 0;
        for (const t of want) if (have.has(t)) inter++;
        score = inter / Math.max(want.size, have.size) * 0.9;
        if (score > 0) reason = "Descripción parecida";
      }
      if (line.supplierCode.trim() && codeKey(line.supplierCode) === codeKey(m.code)) {
        score = Math.max(score, 0.5) + 0.1;
        reason = "El código impreso coincide con el código interno (verificá que sea el mismo material)";
      }
    }
    if (score >= 0.2) out.push({ code: m.code, description: m.description, unit: m.unit, score: Math.round(score * 100) / 100, reason });
  }
  return out.sort((a, b) => b.score - a.score || a.code.localeCompare(b.code)).slice(0, limit);
}

/** Solo un uso previo confirmado se pre-selecciona. Todo lo demás queda como sugerencia a elegir. */
export function preselectFromHistory(line: { supplier: string; supplierCode: string }, history: MappingHistory): string {
  return line.supplierCode.trim() ? history.get(mappingKey(line.supplier, line.supplierCode))?.code ?? "" : "";
}

// ───────────────────────── Duplicados ─────────────────────────

export type ExistingEntry = {
  source: "recepcion" | "ingreso";
  id: string;
  label: string;
  supplierKey: string;
  remitoKey: string;
  lines: Array<{ materialCode: string; quantity: number }>;
};
export type DuplicateWarning = {
  kind: "remito_exacto" | "remito_parcial" | "archivo_repetido";
  refId: string;
  source: "recepcion" | "ingreso";
  label: string;
  /** Hay que reconocerla explícitamente para confirmar. */
  requiresAck: boolean;
  detail: string;
};

const sameQty = (a: number, b: number) => Math.abs(a - b) <= Math.max(1e-6, Math.abs(a) * 1e-9);

/**
 * Compara el remito nuevo con lo ya registrado. «Exacto» = todas las líneas coinciden (material + cantidad): casi seguro es el
 * mismo ingreso. «Parcial» = mismo remito pero distinto contenido: puede ser una recepción parcial legítima (no bloquea).
 */
export function classifyDuplicates(input: {
  supplier: string;
  remitoNumber: string;
  lines: Array<{ materialCode: string; quantity: number }>;
  existing: ExistingEntry[];
  fileMatches: Array<{ refId: string; source: "recepcion" | "ingreso"; label: string }>;
}): DuplicateWarning[] {
  const sk = supplierKey(input.supplier);
  const rk = remitoKey(input.remitoNumber);
  const out: DuplicateWarning[] = [];
  if (sk && rk) {
    const sameRemito = input.existing.filter((e) => e.supplierKey === sk && e.remitoKey === rk);
    // Un remito partido en varios ingresos: se compara contra la unión de lo ya registrado.
    const allPrev = sameRemito.flatMap((e) => e.lines);
    for (const e of sameRemito) {
      const covered = input.lines.length > 0 && input.lines.every((l) => e.lines.some((p) => normalizeMaterialCode(p.materialCode) === normalizeMaterialCode(l.materialCode) && sameQty(p.quantity, l.quantity)));
      if (covered) {
        out.push({ kind: "remito_exacto", refId: e.id, source: e.source, label: e.label, requiresAck: true, detail: `Mismo proveedor, remito, materiales y cantidades que ${e.label}. Si lo confirmás se sumaría el stock otra vez.` });
      }
    }
    if (sameRemito.length && !out.some((w) => w.kind === "remito_exacto")) {
      const overlap = input.lines.filter((l) => allPrev.some((p) => normalizeMaterialCode(p.materialCode) === normalizeMaterialCode(l.materialCode)));
      const first = sameRemito[0]!;
      out.push({
        kind: "remito_parcial", refId: first.id, source: first.source, label: first.label, requiresAck: false,
        detail: `Este remito ya tiene ${sameRemito.length} ingreso${sameRemito.length === 1 ? "" : "s"} registrado${sameRemito.length === 1 ? "" : "s"}${overlap.length ? ` y ${overlap.length} material${overlap.length === 1 ? "" : "es"} se repite${overlap.length === 1 ? "" : "n"} con otra cantidad` : ""}. Si es una recepción parcial, registrá solo lo que llegó ahora.`,
      });
    }
  }
  const seen = new Set<string>();
  for (const f of input.fileMatches) {
    if (seen.has(f.refId)) continue;
    seen.add(f.refId);
    out.push({ kind: "archivo_repetido", refId: f.refId, source: f.source, label: f.label, requiresAck: true, detail: `El mismo archivo ya está adjunto a ${f.label}.` });
  }
  return out;
}

// ───────────────────────── Lectura automática (sugerencia) ─────────────────────────

export type ExtractedLine = {
  supplierCode: string; description: string; quantity: string; unit: string; packages: string; lote: string; vencimiento: string; notes: string; review: string[];
};
export type ExtractedRemito = { supplier: string; remitoNumber: string; remitoDate: string; notes: string; headerReview: string[]; lines: ExtractedLine[] };

const str = (v: unknown, max = 300) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : typeof v === "number" && Number.isFinite(v) ? String(v) : "");
const isoOrEmpty = (v: unknown) => {
  const s = str(v, 20);
  if (isIsoDate(s)) return s;
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(s);
  if (m) {
    const y = m[3]!.length === 2 ? `20${m[3]}` : m[3]!;
    const iso = `${y}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
    if (isIsoDate(iso)) return iso;
  }
  return "";
};

/**
 * Valida y sanea la respuesta del servicio de lectura: nunca se confía en ella. Todo dato ausente queda vacío y marcado
 * «Revisar»; las fechas/cantidades inválidas se descartan (no se inventan). Devuelve null si no es un remito legible.
 */
export function sanitizeExtraction(raw: unknown): ExtractedRemito | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const lowConf = (c: unknown) => typeof c === "number" && c < 0.6;
  const unclear = new Set((Array.isArray(r.unclearFields) ? r.unclearFields : []).map((x) => String(x)));
  const headerReview: string[] = [];
  const supplier = str(r.supplier, 120);
  const remitoNumber = str(r.remitoNumber, 60);
  const remitoDate = isoOrEmpty(r.remitoDate);
  if (!supplier || unclear.has("supplier")) headerReview.push("supplier");
  if (!remitoNumber || unclear.has("remitoNumber")) headerReview.push("remitoNumber");
  if (!remitoDate || unclear.has("remitoDate") || (str(r.remitoDate, 20) && !remitoDate)) headerReview.push("remitoDate");
  const rawLines = Array.isArray(r.lines) ? r.lines.slice(0, RECEIPT_MAX_LINES) : [];
  const lines: ExtractedLine[] = rawLines.flatMap((x) => {
    if (!x || typeof x !== "object") return [];
    const o = x as Record<string, unknown>;
    const qtyNum = parseNumber(o.quantity);
    const venc = isoOrEmpty(o.expiryDate ?? o.vencimiento);
    const review: string[] = [];
    const supplierCode = str(o.supplierCode, 60);
    const description = str(o.description, 200);
    const lote = str(o.lot ?? o.lote, 60);
    const unit = str(o.unit, 20);
    if (!description) review.push("description");
    if (qtyNum == null || !(qtyNum > 0)) review.push("quantity");
    if (!unit) review.push("unit");
    if (!lote) review.push("lote");
    if (!venc) review.push("vencimiento");
    const lineUnclear = Array.isArray(o.unclearFields) ? o.unclearFields.map(String) : [];
    for (const f of lineUnclear) if (!review.includes(f)) review.push(f);
    if (lowConf(o.confidence) && !review.includes("quantity")) review.push("quantity");
    if (!description && !supplierCode && qtyNum == null) return [];
    const pk = parseNumber(o.packages);
    return [{
      supplierCode, description, quantity: qtyNum != null && qtyNum > 0 ? String(qtyNum) : "", unit, packages: pk != null && pk > 0 ? String(pk) : "",
      lote, vencimiento: venc, notes: str(o.notes, 300), review,
    }];
  });
  if (!supplier && !remitoNumber && lines.length === 0) return null;
  return { supplier, remitoNumber, remitoDate, notes: str(r.notes, 500), headerReview, lines };
}
