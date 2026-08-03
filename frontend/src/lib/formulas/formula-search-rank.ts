import { normalizeSearchKey } from "@/lib/formulas/types";

export type FormulaSearchRank = "exact_prefix" | "word_prefix" | "contains";

export const FORMULA_RANK_SCORE: Record<FormulaSearchRank, number> = {
  exact_prefix: 400,
  word_prefix: 300,
  contains: 200,
};

/** Clasifica coincidencia: startsWith > inicio de palabra > includes. */
export function rankSearchMatch(
  queryNorm: string,
  candidateNorm: string
): FormulaSearchRank | null {
  if (!queryNorm || !candidateNorm) return null;
  if (candidateNorm.startsWith(queryNorm)) return "exact_prefix";
  const words = candidateNorm.split(" ").filter(Boolean);
  if (words.some((w) => w.startsWith(queryNorm))) return "word_prefix";
  if (candidateNorm.includes(queryNorm)) return "contains";
  return null;
}

export function scoreSearchMatch(queryNorm: string, candidateNorm: string): number {
  const rank = rankSearchMatch(queryNorm, candidateNorm);
  return rank ? FORMULA_RANK_SCORE[rank] : 0;
}

/** Mejor puntaje entre varios campos normalizados del candidato. */
export function bestScoreForFields(query: string, fields: string[]): number {
  const q = normalizeSearchKey(query);
  if (!q) return 0;
  let best = 0;
  for (const field of fields) {
    const score = scoreSearchMatch(q, normalizeSearchKey(field));
    if (score > best) best = score;
  }
  return best;
}

export function filterAndRankByScore<T>(
  items: T[],
  query: string,
  getFields: (item: T) => string[],
  limit: number
): T[] {
  const q = normalizeSearchKey(query);
  if (!q) return items.slice(0, limit);
  const scored = items
    .map((item) => ({
      item,
      score: bestScoreForFields(q, getFields(item)),
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || getFields(a.item)[0]!.localeCompare(getFields(b.item)[0]!, "es"));
  return scored.slice(0, limit).map((x) => x.item);
}

export function filterClientsRanked(
  clients: Array<{ client: string }>,
  query: string,
  limit: number
): Array<{ client: string; score: number }> {
  const q = normalizeSearchKey(query);
  const list = q
    ? clients
        .map((c) => ({
          client: c.client,
          score: scoreSearchMatch(q, normalizeSearchKey(c.client)),
        }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score || a.client.localeCompare(b.client, "es"))
    : clients.map((c) => ({ client: c.client, score: 0 }));
  return list.slice(0, limit);
}
