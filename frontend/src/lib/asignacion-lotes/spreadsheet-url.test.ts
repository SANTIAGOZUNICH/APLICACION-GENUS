import { describe, expect, it } from "vitest";
import { extractSpreadsheetId } from "./spreadsheet-url";

describe("extractSpreadsheetId", () => {
  it("extrae el id de una URL /d/<id>/edit típica", () => {
    expect(
      extractSpreadsheetId(
        "https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz1234567890/edit#gid=0"
      )
    ).toBe("1AbCdEfGhIjKlMnOpQrStUvWxYz1234567890");
  });

  it("extrae el id de una URL sin /edit ni query", () => {
    expect(extractSpreadsheetId("https://docs.google.com/spreadsheets/d/abc123XYZ_-987")).toBe(
      "abc123XYZ_-987"
    );
  });

  it("acepta un id puro pegado directamente", () => {
    expect(extractSpreadsheetId("1AbCdEfGhIjKlMnOpQrStUvWxYz1234567890")).toBe(
      "1AbCdEfGhIjKlMnOpQrStUvWxYz1234567890"
    );
  });

  it("URL inválida (no es de Sheets) -> null", () => {
    expect(extractSpreadsheetId("https://example.com/foo")).toBeNull();
  });

  it("vacío -> null", () => {
    expect(extractSpreadsheetId("")).toBeNull();
    expect(extractSpreadsheetId("   ")).toBeNull();
  });

  it("texto corto/ambiguo (no parece un id real) -> null", () => {
    expect(extractSpreadsheetId("hola")).toBeNull();
  });
});
