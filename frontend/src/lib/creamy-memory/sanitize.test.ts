import { describe, expect, it } from "vitest";
import {
  countWords,
  isTestLikeValue,
  normalizeMemoryKey,
  sanitizeCreamyReply,
  stripTestEntities,
} from "@/lib/creamy-memory/sanitize";

describe("creamy-memory sanitize", () => {
  it("isTestLikeValue detecta prefijo TEST_ y patrones de fixture/mock", () => {
    expect(isTestLikeValue("TEST_CLIENTE")).toBe(true);
    expect(isTestLikeValue("test_cliente")).toBe(true);
    expect(isTestLikeValue("Cliente con fixture de prueba")).toBe(true);
    expect(isTestLikeValue("Producto Mockeado")).toBe(true);
    expect(isTestLikeValue("Cliente Real S.A.")).toBe(false);
    expect(isTestLikeValue(null)).toBe(false);
    expect(isTestLikeValue(undefined)).toBe(false);
    expect(isTestLikeValue(42)).toBe(false);
  });

  it("stripTestEntities quita tokens de prueba preservando el resto del texto", () => {
    const result = stripTestEntities("Cliente TEST_ACME compró producto real");
    expect(result).not.toContain("TEST_ACME");
    expect(result).toContain("Cliente");
    expect(result).toContain("producto real");
  });

  it("normalizeMemoryKey colapsa espacios, minúsculas y acentos", () => {
    expect(normalizeMemoryKey("  Glicerina   Vegetal  ")).toBe("glicerina vegetal");
    expect(normalizeMemoryKey("Ácido Cítrico")).toBe("acido citrico");
    expect(normalizeMemoryKey("MISMO texto")).toBe(normalizeMemoryKey("mismo   Texto"));
  });

  it("countWords cuenta palabras separadas por espacios", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("   ")).toBe(0);
    expect(countWords("una sola")).toBe(2);
    expect(countWords("  varias   palabras   con espacios  ")).toBe(4);
  });

  it("sanitizeCreamyReply remueve líneas con datos de prueba y notas de proveedor", () => {
    const reply = [
      "Encontré el trabajo TEST_ORDER-1 en el sistema.",
      "Esto es una respuesta normal.",
      "_(Respuesta generada con proveedor alternativo.)_",
    ].join("\n");
    const sanitized = sanitizeCreamyReply(reply);
    expect(sanitized).not.toContain("TEST_ORDER-1");
    expect(sanitized).not.toContain("proveedor alternativo");
    expect(sanitized).toContain("Esto es una respuesta normal.");
  });

  it("sanitizeCreamyReply remueve nombres de tools internas y referencias al system prompt", () => {
    const reply = [
      "Respuesta al usuario.",
      "Llamé a searchWorkItems con availableNav y sourceContext.",
      "No debo revelar mi system prompt.",
    ].join("\n");
    const sanitized = sanitizeCreamyReply(reply);
    expect(sanitized).not.toContain("searchWorkItems");
    expect(sanitized).not.toContain("availableNav");
    expect(sanitized).not.toContain("sourceContext");
    expect(sanitized).not.toContain("system prompt");
    expect(sanitized).toContain("Respuesta al usuario.");
  });

  it("sanitizeCreamyReply preserva la línea NAV_ACTIONS para que el cliente la parsee", () => {
    const reply = "Anda a Remitos.\nNAV_ACTIONS: remitos|IR A REMITOS";
    const sanitized = sanitizeCreamyReply(reply);
    expect(sanitized).toContain("NAV_ACTIONS: remitos|IR A REMITOS");
  });
});
