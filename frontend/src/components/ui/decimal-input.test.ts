import { describe, expect, it } from "vitest";
import { parseDecimalInput } from "./decimal-input";

describe("campo decimal con coma", () => {
  it("acepta coma y punto; vacío es null; a medio escribir no es número todavía", () => {
    expect(parseDecimalInput("1,5")).toBe(1.5);
    expect(parseDecimalInput("1.5")).toBe(1.5);
    expect(parseDecimalInput("-2")).toBe(-2);
    expect(parseDecimalInput("")).toBeNull();
    expect(parseDecimalInput("1,")).toBeUndefined();
    expect(parseDecimalInput("-")).toBeUndefined();
    expect(parseDecimalInput("abc")).toBeUndefined();
  });
});
