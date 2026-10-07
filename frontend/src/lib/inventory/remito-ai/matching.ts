/**
 * Asociación línea de remito → material GENUS del catálogo REAL de ME.
 * Determinístico y auditable: alias confirmados > código > similitud de descripción.
 * Nunca inventa materiales; ante ambigüedad solo ofrece candidatos.
 */
import { normalizeMeCodigo } from "../me-codigo";
import type { MeMaterial } from "../types";
import { normalizeKey, stripAccents } from "./normalize";
import type {
  MeRemitoAlias,
  RemitoCandidate,
  RemitoConfianza,
  RemitoExtractionItem,
  RemitoMatchSource,
} from "./types";

/** Abreviaturas frecuentes de remitos de proveedores de envases. */
const ABBREVIATIONS: Record<string, string> = {
  FCO: "FRASCO",
  FRCO: "FRASCO",
  FRAS: "FRASCO",
  VID: "VIDRIO",
  VIDR: "VIDRIO",
  TPA: "TAPA",
  TAP: "TAPA",
  EST: "ESTUCHE",
  ESTU: "ESTUCHE",
  GOT: "GOTERO",
  BCA: "BLANCA",
  BCO: "BLANCO",
  BLCA: "BLANCA",
  BLCO: "BLANCO",
  NEG: "NEGRO",
  NGRO: "NEGRO",
  NAT: "NATURAL",
  CIL: "CILINDRICO",
  CILIND: "CILINDRICO",
  TRANSP: "TRANSPARENTE",
  AMB: "AMBAR",
  PLAST: "PLASTICO",
  ETIQ: "ETIQUETA",
  DISP: "DISPENSER",
  BOMB: "BOMBA",
};

const STOPWORDS = new Set([
  "DE",
  "DEL",
  "LA",
  "EL",
  "X",
  "PARA",
  "CON",
  "UN",
  "UNID",
  "ML",
  "CC",
  "GR",
  "MM",
  "N",
  "NRO",
]);

export type CatalogMaterial = Pick<MeMaterial, "id" | "codigo" | "descripcion" | "archived">;

export type MatchResult = {
  materialId: string | null;
  confianza: RemitoConfianza;
  source: RemitoMatchSource;
  candidates: RemitoCandidate[];
  warnings: string[];
};

function rawTokens(s: string): string[] {
  return stripAccents(String(s ?? ""))
    .toUpperCase()
    .replace(/V°/g, "VIDRIO")
    .replace(/[^A-Z0-9/]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/** "X30" / "30ML" → separa letras y números pegados. */
function splitGlued(t: string): string[] {
  const m = t.match(/^([A-Z]*?)(\d+(?:\/\d+)?)([A-Z]*)$/);
  if (!m) return [t];
  return [m[1], m[2], m[3]].filter(Boolean) as string[];
}

export type TokenSet = { words: string[]; numbers: string[] };

export function tokenize(s: string): TokenSet {
  const words: string[] = [];
  const numbers: string[] = [];
  for (const t0 of rawTokens(s)) {
    for (const t of splitGlued(t0)) {
      if (/^\d/.test(t)) {
        for (const n of t.split("/")) if (n) numbers.push(n.replace(/^0+(?=\d)/, ""));
        continue;
      }
      const expanded = ABBREVIATIONS[t] ?? t;
      if (STOPWORDS.has(expanded) || expanded.length < 2) continue;
      words.push(expanded);
    }
  }
  return { words, numbers };
}

function wordSim(a: string, b: string): number {
  if (a === b) return 1;
  // Prefijo/truncado ("CILINDR" vs "CILINDRICO"): solo si el corto tiene >=4 letras.
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  if (s.length >= 4 && l.startsWith(s)) return 0.85;
  return 0;
}

/** Similitud de palabras (Dice con alineación voraz) 0..1. */
function wordScore(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const used = new Set<number>();
  let sum = 0;
  for (const w of a) {
    let best = 0;
    let bestIdx = -1;
    b.forEach((v, i) => {
      if (used.has(i)) return;
      const s = wordSim(w, v);
      if (s > best) {
        best = s;
        bestIdx = i;
      }
    });
    if (bestIdx >= 0) {
      used.add(bestIdx);
      sum += best;
    }
  }
  return (2 * sum) / (a.length + b.length);
}

type NumbersRelation = "EQUAL" | "SUBSET" | "CONFLICT" | "NONE";
type Scored = { mat: CatalogMaterial; score: number; numbersRelation: NumbersRelation };

function numbersRelation(item: string[], cand: string[]): NumbersRelation {
  if (item.length === 0 && cand.length === 0) return "NONE";
  const a = new Set(item);
  const b = new Set(cand);
  if (a.size === b.size && [...a].every((x) => b.has(x))) return "EQUAL";
  // El catálogo tiene medidas extra (ej. "24" vs "24/410"): ambiguo, nunca automático.
  if (item.length > 0 && [...a].every((x) => b.has(x))) return "SUBSET";
  return "CONFLICT";
}

export function aliasKey(proveedor: string, descripcion: string): string {
  return `${normalizeKey(proveedor)}|${normalizeKey(descripcion)}`;
}

export function matchRemitoItem(params: {
  item: RemitoExtractionItem;
  proveedor: string;
  catalog: CatalogMaterial[];
  aliases: MeRemitoAlias[];
}): MatchResult {
  const { item, proveedor } = params;
  const catalog = params.catalog.filter((m) => !m.archived && normalizeMeCodigo(m.codigo));
  const byId = new Map(catalog.map((m) => [m.id, m]));
  const warnings: string[] = [];
  const toCandidate = (m: CatalogMaterial, score: number): RemitoCandidate => ({
    materialId: m.id,
    codigo: m.codigo,
    descripcion: m.descripcion,
    score: Math.round(score * 100) / 100,
  });

  // 1) Alias confirmado por un humano (proveedor + descripción normalizada).
  const key = aliasKey(proveedor, item.descripcionOriginal);
  const alias = params.aliases.find((a) => `${a.proveedorNorm}|${a.descripcionNorm}` === key);
  if (alias) {
    const mat = byId.get(alias.materialId);
    if (mat) {
      return {
        materialId: mat.id,
        confianza: "ALTA",
        source: "ALIAS",
        candidates: [toCandidate(mat, 1)],
        warnings,
      };
    }
    warnings.push("El alias confirmado apunta a un material que ya no está activo.");
  }

  // 2) Código que coincide EXACTO con un único código GENUS.
  const code = normalizeMeCodigo(item.codigoProveedor);
  if (code) {
    const hit = catalog.filter((m) => normalizeMeCodigo(m.codigo) === code);
    if (hit.length === 1) {
      return {
        materialId: hit[0]!.id,
        confianza: "ALTA",
        source: "CODIGO",
        candidates: [toCandidate(hit[0]!, 1)],
        warnings,
      };
    }
  }

  // 3) Similitud de descripción.
  const it = tokenize(item.descripcionOriginal);
  if (it.words.length === 0) {
    return { materialId: null, confianza: "SIN_COINCIDENCIA", source: "NINGUNO", candidates: [], warnings };
  }
  const scored: Scored[] = catalog
    .map((m) => {
      const mt = tokenize(m.descripcion);
      const rel = numbersRelation(it.numbers, mt.numbers);
      let score = wordScore(it.words, mt.words);
      if (rel === "CONFLICT" && (it.numbers.length > 0 || mt.numbers.length > 0)) score *= 0.4;
      return { mat: m, score, numbersRelation: rel };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  const top = scored[0];
  const second = scored[1];
  if (!top || top.score < 0.35) {
    return { materialId: null, confianza: "SIN_COINCIDENCIA", source: "NINGUNO", candidates: [], warnings };
  }
  const candidates = scored.slice(0, 5).map((s) => toCandidate(s.mat, s.score));

  const gap = top.score - (second?.score ?? 0);
  const ambiguous = gap < 0.15;
  const numbersOk = top.numbersRelation === "EQUAL" || top.numbersRelation === "NONE";

  if (top.numbersRelation === "SUBSET") {
    warnings.push("El remito no indica la medida completa: puede ser más de un material del catálogo.");
  }
  if (top.numbersRelation === "CONFLICT" && it.numbers.length > 0) {
    warnings.push("Las medidas del remito no coinciden con el material sugerido.");
  }
  if (ambiguous && second) warnings.push("Hay más de un material posible.");

  let confianza: RemitoConfianza;
  if (!ambiguous && numbersOk && top.score >= 0.85) confianza = "ALTA";
  else if (!ambiguous && numbersOk && top.score >= 0.6) confianza = "MEDIA";
  else confianza = "BAJA";

  return {
    materialId: confianza === "BAJA" ? null : top.mat.id,
    confianza,
    source: "DESCRIPCION",
    candidates,
    warnings,
  };
}
