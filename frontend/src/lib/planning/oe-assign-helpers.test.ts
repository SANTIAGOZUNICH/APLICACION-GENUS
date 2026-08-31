import { describe, expect, it } from "vitest";
import {
  isValidOeOrderNumber,
  normalizeOeOrderNumber,
  parseOeOrderNumber,
} from "@/lib/planning/oe-assign-helpers";

describe("OE assign helpers — normalización (mismo formato que OA, prefijo OE)", () => {
  it("normaliza espacios y mayúsculas", () => {
    expect(normalizeOeOrderNumber(" oe-2026-000145 ")).toBe("OE-2026-000145");
    expect(normalizeOeOrderNumber("OE 2026 000145")).toBe("OE2026000145");
    expect(isValidOeOrderNumber(normalizeOeOrderNumber(" oe-2026-000145 "))).toBe(true);
  });

  it("conserva el número exacto ingresado (forma canónica)", () => {
    const n = normalizeOeOrderNumber("OE-2026-000145");
    expect(n).toBe("OE-2026-000145");
    expect(parseOeOrderNumber(n)).toEqual({ year: 2026, seq: 145 });
  });

  it("rechaza formato inválido, incluyendo un OA disfrazado de OE", () => {
    expect(isValidOeOrderNumber("OA-2026-000001")).toBe(false);
    expect(isValidOeOrderNumber("OE-26-1")).toBe(false);
    expect(isValidOeOrderNumber("")).toBe(false);
  });

  it("acepta el número sin ceros a la izquierda, tal como lo autogenera pedido-order-ref.ts", () => {
    expect(normalizeOeOrderNumber("OE-2026-4521")).toBe("OE-2026-4521");
    expect(isValidOeOrderNumber("OE-2026-4521")).toBe(true);
    expect(parseOeOrderNumber("OE-2026-4521")).toEqual({ year: 2026, seq: 4521 });
  });
});
