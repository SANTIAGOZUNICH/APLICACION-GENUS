import { describe, expect, it } from "vitest";
import { PORTAL_ACCESS_URL, buildPortalAccessMessage, buildWhatsappShareUrl, generateAccessPassword, pickAvailableUsername, slugifyUsername } from "./access-credentials";
import { normalizeUsername, passwordProblem } from "./user-rules";

describe("usuario a partir del nombre del cliente", () => {
  it("minúsculas, sin acentos, espacios ni símbolos", () => {
    expect(slugifyUsername("The Minimal Co.")).toBe("theminimalco");
    expect(slugifyUsername("Cosmética Ñandú & Hijos S.A.")).toBe("cosmeticananduhijossa");
    expect(slugifyUsername("  Éxito—Pérez/Gómez  ")).toBe("exitoperezgomez");
  });
  it("siempre respeta las reglas de formato (largo mínimo y máximo, charset)", () => {
    for (const n of ["", "  ", "%%%", "A", "ab", "名前", "x".repeat(200), "Ünï Çödé 123"]) {
      expect(normalizeUsername(slugifyUsername(n))).not.toBeNull();
    }
    expect(slugifyUsername("x".repeat(200)).length).toBeLessThanOrEqual(34);
    expect(slugifyUsername(undefined)).toBe("cliente");
  });
  it("unicidad con sufijo numérico incremental", () => {
    expect(pickAvailableUsername("acme", new Set())).toBe("acme");
    expect(pickAvailableUsername("acme", new Set(["acme"]))).toBe("acme2");
    expect(pickAvailableUsername("acme", new Set(["acme", "acme2", "acme3"]))).toBe("acme4");
    expect(pickAvailableUsername("acme", new Set(["acme", "acme2"]), 2)).toBe("acme3");
    expect(normalizeUsername(pickAvailableUsername("x".repeat(34), new Set(["x".repeat(34)])))).not.toBeNull();
  });
});

describe("generador de contraseña", () => {
  it("≥12 caracteres, solo caracteres legibles, sin ambiguos y cumple la política", () => {
    for (let i = 0; i < 500; i++) {
      const p = generateAccessPassword(12, "theminimalco");
      expect(p.length).toBeGreaterThanOrEqual(12);
      expect(p).toMatch(/^[A-Za-z0-9]+$/);
      expect(p).not.toMatch(/[01OIlo]/);
      expect(passwordProblem(p, "theminimalco")).toBeNull();
    }
    expect(generateAccessPassword(4).length).toBe(12);
    expect(generateAccessPassword(20).length).toBe(20);
  });
  it("no repite en muchas corridas y usa todo el alfabeto (entropía)", () => {
    const seen = new Set<string>();
    const chars = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const p = generateAccessPassword();
      seen.add(p);
      for (const c of p) chars.add(c);
    }
    expect(seen.size).toBe(2000);
    expect(chars.size).toBeGreaterThanOrEqual(50); // alfabeto de 54
  });
});

describe("mensaje de WhatsApp", () => {
  const expected =
    "¡Hola! Ya tenés acceso al Portal de Clientes de Laboratorio Genus.\n\nDesde acá vas a poder seguir el estado de tus pedidos en tiempo real y recibir notificaciones sobre su avance.\n\nUsuario: theminimalco\nContraseña: Ab3dEf7hJk9m\n\nIngresá en:\nhttps://appgenus.vercel.app/entregas\n\n¡También podés instalar la aplicación en tu celular!";
  it("es EXACTO", () => {
    expect(PORTAL_ACCESS_URL).toBe("https://appgenus.vercel.app/entregas");
    expect(buildPortalAccessMessage("theminimalco", "Ab3dEf7hJk9m")).toBe(expected);
  });
  it("el enlace wa.me no lleva número y el texto va url-encoded", () => {
    const url = buildWhatsappShareUrl("theminimalco", "Ab3dEf7hJk9m");
    expect(url.startsWith("https://wa.me/?text=")).toBe(true);
    expect(decodeURIComponent(url.slice("https://wa.me/?text=".length))).toBe(expected);
    expect(url).toContain("%0A%0A");
    expect(url).not.toMatch(/[ \n]/);
  });
});
