import { describe, expect, it } from "vitest";
import {
  compactOperationalIdsInText,
  formatOperationalIdCompact,
  formatOperationalIdFull,
  parseOperationalId,
} from "./format-operational-id";

describe("formatOperationalIdCompact", () => {
  it("acorta OE/OA legales", () => {
    expect(formatOperationalIdCompact("OE-2026-000015")).toBe("OE-000015");
    expect(formatOperationalIdCompact("OA-2026-000122")).toBe("OA-000122");
  });

  it("extrae ID desde títulos largos", () => {
    expect(formatOperationalIdCompact("ORDEN DE ELABORACION OE-2026-000015")).toBe(
      "OE-000015"
    );
    expect(
      formatOperationalIdCompact("ORDEN DE ACONDICIONAMIENTO OA-2026-000122")
    ).toBe("OA-000122");
  });

  it("paddea secuencias cortas", () => {
    expect(formatOperationalIdCompact("OE-2026-15")).toBe("OE-000015");
  });

  it("tolera valores vacíos o incompletos", () => {
    expect(formatOperationalIdCompact(null)).toBe("");
    expect(formatOperationalIdCompact(undefined)).toBe("");
    expect(formatOperationalIdCompact("")).toBe("");
    expect(formatOperationalIdCompact("   ")).toBe("");
    expect(formatOperationalIdCompact("SIN-REF")).toBe("SIN-REF");
    expect(formatOperationalIdCompact("OE-")).toBe("OE-");
    expect(formatOperationalIdCompact("producto sin id")).toBe("producto sin id");
  });
});

describe("formatOperationalIdFull / parseOperationalId", () => {
  it("reconstruye forma legal", () => {
    expect(formatOperationalIdFull("OE-2026-15")).toBe("OE-2026-000015");
    const parsed = parseOperationalId("oa-2026-000122");
    expect(parsed).toEqual({
      kind: "OA",
      year: "2026",
      sequence: "000122",
      full: "OA-2026-000122",
      compact: "OA-000122",
    });
  });
});

describe("compactOperationalIdsInText", () => {
  it("acorta IDs embebidos y normaliza salida automática", () => {
    expect(
      compactOperationalIdsInText(
        "Salida automática generada por Orden de Elaboración OE-2026-000015"
      )
    ).toBe("Salida automática · OE-000015");

    expect(
      compactOperationalIdsInText("Salida automática OA OA-2026-000122")
    ).toBe("Salida automática · OA-000122");

    expect(
      compactOperationalIdsInText("Origen automático · OA OA-2026-000099 · id x")
    ).toBe("Origen automático · OA-000099 · id x");
  });

  it("deja textos sin ID intactos", () => {
    expect(compactOperationalIdsInText("Sin movimientos")).toBe("Sin movimientos");
    expect(compactOperationalIdsInText("")).toBe("");
  });
});
