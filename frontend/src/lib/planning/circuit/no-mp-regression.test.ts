import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * No-regresión OE/MP (#125): el descuento de materia prima ocurre SOLO en la entrega de la OE (applyOeConsumption).
 * Las entregas/traspasos de work_items del circuito nuevo nunca deben tocar el libro de stock de MP, para que el
 * consumo siga siendo exactamente-una-vez y no se duplique al entregar trabajos (parciales incluidos).
 * La verificación funcional end-to-end está en scripts/e2e/oe-consumo-real-validate.mjs y circuito-validate.mjs.
 */
describe("circuito: sin descuentos de MP", () => {
  const dir = __dirname;
  const sources = readdirSync(dir)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((f) => [f, readFileSync(join(dir, f), "utf8")] as const);

  it("hay módulos del circuito para revisar", () => {
    expect(sources.length).toBeGreaterThan(5);
  });
  it.each(sources)("%s no importa ni invoca el libro de stock de MP", (_name, src) => {
    expect(src).not.toMatch(/mp-stock-ledger|applyOeConsumption|mp_stock_movements|mpStockMovements/);
  });
});
