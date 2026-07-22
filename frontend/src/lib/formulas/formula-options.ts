/**
 * Opciones de búsqueda del banco de fórmulas (sin ingredientes/%/procedimiento).
 * Aliases derivados de metadatos ya persistidos (display, code, filename, sheet).
 */
import {
  deriveProductFromFilename,
  isGenericSheetName,
  isPendingClient,
  normalizeSearchKey,
  type FormulaProductRecord,
  type FormulaVersionRecord,
} from "@/lib/formulas/types";

export type FormulaOption = {
  productId: string;
  versionId: string;
  client: string;
  productLabel: string;
  code: string;
  aliases: string[];
};

export type FormulaSearchHit = FormulaOption & {
  score: number;
  rank: "exact_prefix" | "word_prefix" | "contains" | "fuzzy";
};

const NON_HUMAN =
  /^(oe|oegenus|fgenus|hoja\s*\d*|desarrollo|mixto|base|t\d+|copia de oe)$/i;

export function isNonHumanProductLabel(label: string): boolean {
  const n = normalizeSearchKey(label);
  if (!n) return true;
  if (isGenericSheetName(label)) return true;
  if (NON_HUMAN.test(n)) return true;
  if (/^\d+$/.test(n)) return true;
  return false;
}

/** Nombre visible: CELL/display humano → filename → sheet válida → display crudo. */
export function visibleProductLabel(
  product: FormulaProductRecord,
  version: FormulaVersionRecord | undefined
): string {
  const display = product.displayProduct?.trim() || "";
  if (display && !isNonHumanProductLabel(display)) return display;

  const fromFile = version?.sourceFile
    ? deriveProductFromFilename(version.sourceFile, product.displayClient)
    : "";
  if (fromFile && !isNonHumanProductLabel(fromFile)) return fromFile;

  const sheet = version?.sourceSheet?.trim() || "";
  if (sheet && !isGenericSheetName(sheet) && !isNonHumanProductLabel(sheet)) {
    return sheet;
  }

  return display || fromFile || sheet || PRODUCT_FALLBACK;
}

const PRODUCT_FALLBACK = "Producto sin nombre legible";

function uniqAliases(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const t = raw.trim();
    if (!t) continue;
    const key = normalizeSearchKey(t);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

export function buildAliases(
  product: FormulaProductRecord,
  version: FormulaVersionRecord | undefined,
  label: string
): string[] {
  const fromFile = version?.sourceFile
    ? deriveProductFromFilename(version.sourceFile, product.displayClient)
    : "";
  const sheet = version?.sourceSheet?.trim() || "";
  const code = product.productCode?.trim() || "";
  const candidates = [
    label,
    product.displayProduct,
    fromFile,
    !isGenericSheetName(sheet) ? sheet : "",
    code,
    product.normalizedProduct,
  ];
  // Variantes sin guiones ya cubiertas por normalizeSearchKey en el match.
  return uniqAliases(candidates);
}

export function listActiveFormulaOptions(
  products: FormulaProductRecord[],
  versions: FormulaVersionRecord[]
): FormulaOption[] {
  const byId = new Map(versions.map((v) => [v.id, v]));
  const out: FormulaOption[] = [];
  for (const p of products) {
    if (isPendingClient(p.displayClient)) continue;
    if (!p.activeVersionId) continue;
    const v = byId.get(p.activeVersionId);
    if (!v || v.status !== "VIGENTE" || v.reviewRequired) continue;
    const label = visibleProductLabel(p, v);
    out.push({
      productId: p.id,
      versionId: v.id,
      client: p.displayClient,
      productLabel: label,
      code: p.productCode || "",
      aliases: buildAliases(p, v, label),
    });
  }
  return out;
}

export function listActiveClients(options: FormulaOption[]): string[] {
  return [...new Set(options.map((o) => o.client))].sort((a, b) =>
    a.localeCompare(b, "es", { sensitivity: "base" })
  );
}

function rankQuery(queryNorm: string, candidateNorm: string): FormulaSearchHit["rank"] | null {
  if (!queryNorm || !candidateNorm) return null;
  if (candidateNorm.startsWith(queryNorm)) return "exact_prefix";
  const words = candidateNorm.split(" ").filter(Boolean);
  if (words.some((w) => w.startsWith(queryNorm))) return "word_prefix";
  if (candidateNorm.includes(queryNorm)) return "contains";
  // Fuzzy muy conservador: todos los tokens del query están en el candidato
  const qTokens = queryNorm.split(" ").filter((t) => t.length >= 2);
  if (qTokens.length && qTokens.every((t) => candidateNorm.includes(t))) {
    return "fuzzy";
  }
  return null;
}

const RANK_SCORE: Record<FormulaSearchHit["rank"], number> = {
  exact_prefix: 400,
  word_prefix: 300,
  contains: 200,
  fuzzy: 100,
};

function bestRankForOption(
  queryNorm: string,
  option: FormulaOption,
  field: "client" | "product"
): FormulaSearchHit["rank"] | null {
  const fields =
    field === "client"
      ? [option.client]
      : [option.productLabel, option.code, ...option.aliases];
  let best: FormulaSearchHit["rank"] | null = null;
  for (const f of fields) {
    const r = rankQuery(queryNorm, normalizeSearchKey(f));
    if (!r) continue;
    if (!best || RANK_SCORE[r] > RANK_SCORE[best]) best = r;
  }
  return best;
}

export function searchClients(
  options: FormulaOption[],
  query: string,
  limit = 10
): Array<{ client: string; score: number; rank: FormulaSearchHit["rank"] }> {
  const q = normalizeSearchKey(query);
  const clients = listActiveClients(options);
  // Sin texto: no sugerir (UX: "Empezá a escribir para buscar").
  if (!q) return [];
  const hits: Array<{ client: string; score: number; rank: FormulaSearchHit["rank"] }> =
    [];
  for (const client of clients) {
    const dummy: FormulaOption = {
      productId: "",
      versionId: "",
      client,
      productLabel: "",
      code: "",
      aliases: [],
    };
    const rank = bestRankForOption(q, dummy, "client");
    if (!rank) continue;
    hits.push({ client, score: RANK_SCORE[rank], rank });
  }
  hits.sort(
    (a, b) =>
      b.score - a.score || a.client.localeCompare(b.client, "es", { sensitivity: "base" })
  );
  return hits.slice(0, limit);
}

export function searchProductsForClient(
  options: FormulaOption[],
  client: string,
  query: string,
  limit = 10
): FormulaSearchHit[] {
  const clientNorm = normalizeSearchKey(client);
  const scoped = options.filter(
    (o) => normalizeSearchKey(o.client) === clientNorm
  );
  const q = normalizeSearchKey(query);
  // Sin texto: no sugerir lista completa (UX: empezar a escribir).
  if (!q) return [];
  const hits: FormulaSearchHit[] = [];
  for (const o of scoped) {
    const rank = bestRankForOption(q, o, "product");
    if (!rank) continue;
    hits.push({ ...o, score: RANK_SCORE[rank], rank });
  }
  hits.sort(
    (a, b) =>
      b.score - a.score ||
      a.productLabel.localeCompare(b.productLabel, "es", { sensitivity: "base" })
  );
  return hits.slice(0, limit);
}

/** Exactitud normalizada única (para Enter / blur). */
export function findUniqueExactProduct(
  options: FormulaOption[],
  client: string,
  productText: string
): FormulaOption | null {
  const clientNorm = normalizeSearchKey(client);
  const productNorm = normalizeSearchKey(productText);
  if (!clientNorm || !productNorm) return null;
  const matches = options.filter((o) => {
    if (normalizeSearchKey(o.client) !== clientNorm) return false;
    const keys = [o.productLabel, o.code, ...o.aliases].map(normalizeSearchKey);
    return keys.includes(productNorm);
  });
  return matches.length === 1 ? matches[0]! : null;
}
