import { describe, expect, it } from "vitest";
import {
  generateTemporaryPassword,
  isLocked,
  lockSecondsFor,
  normalizeUsername,
  passwordProblem,
} from "./user-rules";

describe("usuario", () => {
  it("normaliza a minúsculas y rechaza formatos inválidos", () => {
    expect(normalizeUsername("  Compras.ACME ")).toBe("compras.acme");
    expect(normalizeUsername("ab")).toBeNull();
    expect(normalizeUsername("con espacio")).toBeNull();
    expect(normalizeUsername("a@b.com")).toBeNull();
    expect(normalizeUsername("-empieza")).toBeNull();
    expect(normalizeUsername("x".repeat(41))).toBeNull();
    expect(normalizeUsername(42)).toBeNull();
  });
});

describe("política de contraseña", () => {
  it("exige largo, letra y número", () => {
    expect(passwordProblem("corta1")).toBe("corta");
    expect(passwordProblem("sololetrasaqui")).toBe("sin_numero");
    expect(passwordProblem("12345678901234")).toBe("sin_letra");
    expect(passwordProblem("Clave-Segura-2026")).toBeNull();
  });
  it("rechaza contraseñas con el usuario o triviales", () => {
    expect(passwordProblem("compras.acme2026", "compras.acme")).toBe("igual_al_usuario");
    expect(passwordProblem("password123")).toBe("comun");
    expect(passwordProblem("a".repeat(129) + "1")).toBe("larga");
  });
  it("las temporales generadas cumplen la política y no se repiten", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const p = generateTemporaryPassword();
      expect(passwordProblem(p, "usuario")).toBeNull();
      expect(p).not.toMatch(/[01OIl]/);
      seen.add(p);
    }
    expect(seen.size).toBe(50);
  });
});

describe("bloqueo progresivo", () => {
  it("tramos de bloqueo por fallos consecutivos", () => {
    expect(lockSecondsFor(4)).toBe(0);
    expect(lockSecondsFor(5)).toBe(300);
    expect(lockSecondsFor(8)).toBe(1800);
    expect(lockSecondsFor(12)).toBe(14400);
    expect(lockSecondsFor(99)).toBe(14400);
  });
  it("isLocked compara con el reloj", () => {
    const now = new Date("2026-01-01T12:00:00Z");
    expect(isLocked("2026-01-01T12:00:01Z", now)).toBe(true);
    expect(isLocked("2026-01-01T11:59:59Z", now)).toBe(false);
    expect(isLocked(null, now)).toBe(false);
  });
});
