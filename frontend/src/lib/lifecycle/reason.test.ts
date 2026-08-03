import { describe, expect, it } from "vitest";
import {
  normalizeOptionalReason,
  sanitizeOptionalReason,
  SIN_MOTIVO_INFORMADO,
} from "./reason";

describe("normalizeOptionalReason", () => {
  it("vacío / whitespace → Sin motivo informado", () => {
    expect(normalizeOptionalReason("")).toBe(SIN_MOTIVO_INFORMADO);
    expect(normalizeOptionalReason("   ")).toBe(SIN_MOTIVO_INFORMADO);
    expect(normalizeOptionalReason(null)).toBe(SIN_MOTIVO_INFORMADO);
    expect(normalizeOptionalReason(undefined)).toBe(SIN_MOTIVO_INFORMADO);
  });

  it("texto no vacío → sanitizado completo", () => {
    expect(normalizeOptionalReason("  Error de carga  ")).toBe("Error de carga");
    expect(normalizeOptionalReason("x")).toBe("x");
    expect(sanitizeOptionalReason("a\u0000b  c")).toBe("ab c");
    expect(normalizeOptionalReason("a\u0000b  c")).toBe("ab c");
  });
});
