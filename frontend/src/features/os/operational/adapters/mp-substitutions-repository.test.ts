import { describe, expect, it, vi, afterEach } from "vitest";
import {
  listActiveSubstitutions,
  searchSubstitutions,
  getSubstitutionById,
} from "./mp-substitutions-repository";

// Tests run in Node (no localStorage) — module returns DEMO_SUBSTITUTIONS
afterEach(() => vi.restoreAllMocks());

describe("listActiveSubstitutions", () => {
  it("returns only vigente substitutions from demo data", () => {
    const results = listActiveSubstitutions();
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((s) => s.status === "vigente")).toBe(true);
  });

  it("returns objects with required fields", () => {
    const [first] = listActiveSubstitutions();
    expect(first).toBeDefined();
    expect(typeof first.id).toBe("string");
    expect(typeof first.originalCodigo).toBe("string");
    expect(typeof first.substituteCodigo).toBe("string");
  });
});

describe("searchSubstitutions", () => {
  it("returns all active when no filters given", () => {
    const all = listActiveSubstitutions();
    const searched = searchSubstitutions({});
    expect(searched).toHaveLength(all.length);
  });

  it("filters by originalCodigo", () => {
    const results = searchSubstitutions({ originalCodigo: "MP-035" });
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((s) => s.originalCodigo === "MP-035")).toBe(true);
  });

  it("filters by product name (case insensitive)", () => {
    const results = searchSubstitutions({ product: "serum niacinamida" });
    expect(results.length).toBeGreaterThan(0);
    results.forEach((s) => {
      const matches =
        s.products.length === 0 ||
        s.products.some((p) => p.toLowerCase().includes("serum niacinamida"));
      expect(matches).toBe(true);
    });
  });

  it("filters by freetext query matching original nombre", () => {
    const results = searchSubstitutions({ query: "glicerina" });
    expect(results.length).toBeGreaterThan(0);
  });

  it("returns empty when no match found", () => {
    const results = searchSubstitutions({ originalCodigo: "MP-9999-NONEXISTENT" });
    expect(results).toHaveLength(0);
  });

  it("does not invent substitutions — never returns made-up data", () => {
    const results = searchSubstitutions({ query: "ingrediente inventado xyz" });
    expect(results).toHaveLength(0);
  });
});

describe("getSubstitutionById", () => {
  it("finds a known demo substitution by id", () => {
    const result = getSubstitutionById("sub-001");
    expect(result).not.toBeNull();
    expect(result?.id).toBe("sub-001");
  });

  it("returns null for unknown id", () => {
    const result = getSubstitutionById("sub-nonexistent-9999");
    expect(result).toBeNull();
  });
});
