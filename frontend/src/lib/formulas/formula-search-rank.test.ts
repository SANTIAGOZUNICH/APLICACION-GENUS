import { describe, expect, it } from "vitest";
import {
  FORMULA_RANK_SCORE,
  bestScoreForFields,
  filterClientsRanked,
  rankSearchMatch,
  scoreSearchMatch,
} from "@/lib/formulas/formula-search-rank";
import { normalizeSearchKey } from "@/lib/formulas/types";

describe("normalizeSearchKey + rankSearchMatch", () => {
  it("empareja primera letra sin acentos", () => {
    const q = normalizeSearchKey("T");
    expect(rankSearchMatch(q, normalizeSearchKey("THELMA Y LOUISE"))).toBe("exact_prefix");
    expect(rankSearchMatch(q, normalizeSearchKey("thelma y louise"))).toBe("exact_prefix");
  });

  it("prioriza startsWith sobre word_prefix e includes", () => {
    const q = normalizeSearchKey("the");
    expect(scoreSearchMatch(q, normalizeSearchKey("THELMA"))).toBe(
      FORMULA_RANK_SCORE.exact_prefix
    );
    expect(scoreSearchMatch(q, normalizeSearchKey("Mi THELMA"))).toBe(
      FORMULA_RANK_SCORE.word_prefix
    );
    expect(scoreSearchMatch(q, normalizeSearchKey("x athelma y"))).toBe(
      FORMULA_RANK_SCORE.contains
    );
    expect(FORMULA_RANK_SCORE.exact_prefix).toBeGreaterThan(FORMULA_RANK_SCORE.word_prefix);
    expect(FORMULA_RANK_SCORE.word_prefix).toBeGreaterThan(FORMULA_RANK_SCORE.contains);
  });

  it("ignora acentos en ranking de clientes", () => {
    const clients = [{ client: "José García" }, { client: "Juan Pérez" }];
    const ranked = filterClientsRanked(clients, "jose", 10);
    expect(ranked[0]?.client).toBe("José García");
  });

  it("bestScoreForFields elige el mejor campo", () => {
    expect(
      bestScoreForFields("serum", ["CREMA FACIAL", "SERUM ANTIAGE", "X"])
    ).toBe(FORMULA_RANK_SCORE.exact_prefix);
  });
});
