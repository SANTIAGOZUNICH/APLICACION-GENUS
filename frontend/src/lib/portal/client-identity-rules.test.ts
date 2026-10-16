import { describe, expect, it } from "vitest";
import { normalizeClientName, pickDisplayName, similarityKey } from "./client-identity-rules";

describe("normalización de nombres de cliente", () => {
  it("limpia espacios y calcula la misma clave para escrituras equivalentes", () => {
    const a = normalizeClientName("  ACME   S.A. ")!;
    const b = normalizeClientName("acme s.a.")!;
    expect(a.label).toBe("ACME S.A.");
    expect(a.key).toBe(b.key);
    expect(normalizeClientName("Lúcent")!.key).toBe(normalizeClientName("LUCENT")!.key); // acentos y mayúsculas no crean otro cliente
  });
  it("descarta vacíos, marcadores y basura (nunca se genera código para eso)", () => {
    for (const bad of ["", "   ", "-", "—", "S/D", "n/a", "Sin cliente", "A definir", "123", "...", "x", null, undefined, 42, "a".repeat(121)]) {
      expect(normalizeClientName(bad)).toBeNull();
    }
  });
  it("nombres distintos son clientes distintos (no se unen por parecido)", () => {
    expect(normalizeClientName("ACME")!.key).not.toBe(normalizeClientName("ACME S.A.")!.key);
  });
  it("la clave aproximada solo sirve para avisar posibles duplicados", () => {
    expect(similarityKey(normalizeClientName("ACME S.A.")!.key)).toBe(similarityKey(normalizeClientName("ACME")!.key));
    expect(similarityKey(normalizeClientName("ACME SRL")!.key)).toBe(similarityKey(normalizeClientName("Acme S.A.")!.key));
    expect(similarityKey(normalizeClientName("BL Cosmetics")!.key)).not.toBe(similarityKey(normalizeClientName("ACME")!.key));
  });
  it("nombre a mostrar: la escritura más frecuente", () => {
    expect(pickDisplayName(new Map([["acme", 1], ["ACME S.A.", 5]]))).toBe("ACME S.A.");
    expect(pickDisplayName(new Map([["Beta SA", 2], ["Beta", 2]]))).toBe("Beta");
  });
});
