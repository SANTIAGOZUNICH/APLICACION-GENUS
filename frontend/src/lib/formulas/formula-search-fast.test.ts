/**
 * Búsqueda de fórmulas no debe depender del gate schemaPending 0005.
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { searchClients, searchProductsForClient } from "@/lib/formulas/formula-options";
import type { FormulaOption } from "@/lib/formulas/formula-options";
import { SchemaPendingError } from "@/lib/db/feature-schema";

const sample: FormulaOption[] = [
  {
    productId: "p1",
    versionId: "v1",
    client: "UNICA",
    productLabel: "Shampoo sólido",
    code: "SH1",
    aliases: ["shampoo"],
  },
  {
    productId: "p2",
    versionId: "v2",
    client: "UNICA",
    productLabel: "Crema facial",
    code: "CF1",
    aliases: [],
  },
  {
    productId: "p3",
    versionId: "v3",
    client: "OTRO",
    productLabel: "Gel",
    code: "G1",
    aliases: [],
  },
];

describe("formula search independent of 0005 schemaPending", () => {
  it("precarga clientes con q vacío", () => {
    const hits = searchClients(sample, "", 10);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((h) => h.client === "UNICA")).toBe(true);
  });

  it("filtra productos de un cliente", () => {
    const hits = searchProductsForClient(sample, "UNICA", "sham", 10);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.productLabel).toMatch(/Shampoo/i);
  });

  it("SchemaPendingError es solo para features 0005 — mensaje conocido", () => {
    const err = new SchemaPendingError();
    expect(err.message).toMatch(/Base de datos pendiente/);
    // La búsqueda de fórmulas no importa assertFeatureWritesEnabled
    expect(() => searchClients(sample, "uni", 10)).not.toThrow();
  });
});
