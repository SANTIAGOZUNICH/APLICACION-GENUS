/** Coincidencia de cliente y producto contra el catálogo REAL de GENUS OS. Solo se elige solo un calce exacto normalizado; lo demás son sugerencias. */
import { normalizeSearchKey } from "@/lib/formulas/types";

const STOP = new Set(["de", "del", "la", "el", "los", "las", "y", "sa", "srl", "sas", "s", "a", "cia", "e", "hnos"]);
const tokens = (s: string) => normalizeSearchKey(s).replace(/[^a-z0-9 ]/g, " ").split(" ").filter((t) => t.length > 1 && !STOP.has(t));

export type Match = { value: string | null; exact: boolean; suggestions: string[] };

export function matchName(input: string, catalog: readonly string[], limit = 3): Match {
  const key = normalizeSearchKey(input);
  if (!key) return { value: null, exact: false, suggestions: [] };
  const exact = catalog.filter((c) => normalizeSearchKey(c) === key);
  if (new Set(exact.map((e) => normalizeSearchKey(e))).size === 1) return { value: exact[0]!, exact: true, suggestions: [] };
  const want = new Set(tokens(input));
  if (!want.size) return { value: null, exact: false, suggestions: [] };
  const scored = [...new Set(catalog)]
    .map((c) => {
      const have = new Set(tokens(c));
      let inter = 0;
      for (const t of want) if (have.has(t)) inter++;
      const score = have.size ? inter / Math.max(want.size, have.size) : 0;
      return { c, score, contained: inter === Math.min(want.size, have.size) && inter > 0 };
    })
    .filter((x) => x.score >= 0.5 || x.contained)
    .sort((a, b) => b.score - a.score || a.c.localeCompare(b.c));
  return { value: null, exact: false, suggestions: scored.slice(0, limit).map((x) => x.c) };
}
