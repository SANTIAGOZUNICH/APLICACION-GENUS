import { describe, expect, it } from "vitest";
import { isIntegerUnit, parseArDecimal, parseArInteger } from "./ar-number-parsing";

describe("parseArInteger (unidades/cajas)", () => {
  it("1.500 unidades -> 1500", () => {
    expect(parseArInteger("1.500")).toEqual({ ok: true, value: 1500 });
  });
  it("1500 unidades -> 1500", () => {
    expect(parseArInteger("1500")).toEqual({ ok: true, value: 1500 });
  });
  it("vacío -> null", () => {
    expect(parseArInteger("")).toEqual({ ok: true, value: null });
  });
  it("0 explícito -> 0 (no null)", () => {
    expect(parseArInteger("0")).toEqual({ ok: true, value: 0 });
  });
  it("negativo formalmente parseable (validación de signo es responsabilidad del llamador)", () => {
    expect(parseArInteger("-5")).toEqual({ ok: true, value: -5 });
  });
  it("basura -> error", () => {
    const r = parseArInteger("abc");
    expect(r.ok).toBe(false);
  });
});

describe("parseArDecimal (kg/decimales)", () => {
  it("12,5 kg -> 12.5", () => {
    expect(parseArDecimal("12,5")).toEqual({ ok: true, value: 12.5 });
  });
  it("12.5 kg -> 12.5", () => {
    expect(parseArDecimal("12.5")).toEqual({ ok: true, value: 12.5 });
  });
  it("1.234,56 (miles + decimal) -> 1234.56", () => {
    expect(parseArDecimal("1.234,56")).toEqual({ ok: true, value: 1234.56 });
  });
  it("14,5 no se trunca a 14", () => {
    const r = parseArDecimal("14,5");
    expect(r.value).toBe(14.5);
    expect(r.value).not.toBe(14);
  });
  it("0 explícito -> 0 (no null)", () => {
    expect(parseArDecimal("0")).toEqual({ ok: true, value: 0 });
  });
  it("vacío -> null", () => {
    expect(parseArDecimal(null)).toEqual({ ok: true, value: null });
  });
});

describe("isIntegerUnit", () => {
  it("un. es entero", () => {
    expect(isIntegerUnit("un.")).toBe(true);
  });
  it("KG no es entero", () => {
    expect(isIntegerUnit("KG")).toBe(false);
  });
  it("kg minúscula no es entero", () => {
    expect(isIntegerUnit("kg")).toBe(false);
  });
});
