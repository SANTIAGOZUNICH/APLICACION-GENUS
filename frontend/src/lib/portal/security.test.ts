import { describe, expect, it } from "vitest";
import {
  PUBLIC_CODE_ALPHABET,
  clientIpHash,
  constantTimeEqual,
  createToken,
  generateOtp,
  generatePublicCode,
  hmac,
  isAllowedOrigin,
  normalizeEmail,
  normalizeOtp,
  normalizePublicCode,
  sha256,
} from "./security";

describe("código público de cliente", () => {
  it("formato GEN-XXXXXX con alfabeto sin caracteres confusos", () => {
    for (let i = 0; i < 200; i++) {
      const c = generatePublicCode();
      expect(c).toMatch(/^GEN-[A-HJ-KM-NP-Z2-9]{6}$/);
      expect(normalizePublicCode(c)).toBe(c);
    }
    expect(PUBLIC_CODE_ALPHABET).not.toMatch(/[01OIL]/);
  });

  it("no se repite en miles de generaciones", () => {
    const seen = new Set(Array.from({ length: 5000 }, () => generatePublicCode()));
    expect(seen.size).toBeGreaterThan(4990);
  });

  it("normaliza lo que escribe el cliente y rechaza lo inválido", () => {
    expect(normalizePublicCode(" gen-7k4m9q ")).toBe("GEN-7K4M9Q");
    expect(normalizePublicCode("GEN 7K4M9Q")).toBe("GEN-7K4M9Q");
    expect(normalizePublicCode("7k4m9q")).toBe("GEN-7K4M9Q");
    expect(normalizePublicCode("GEN-7K4M9")).toBeNull();
    expect(normalizePublicCode("GEN-7K4M90")).toBeNull(); // 0 no existe en el alfabeto
    expect(normalizePublicCode("")).toBeNull();
    expect(normalizePublicCode(null)).toBeNull();
    expect(normalizePublicCode(123456)).toBeNull();
    expect(normalizePublicCode("GEN-' OR 1=1")).toBeNull();
  });
});

describe("correos y códigos temporales", () => {
  it("normaliza y valida correos", () => {
    expect(normalizeEmail("  Ana.Perez@Cliente.COM ")).toBe("ana.perez@cliente.com");
    expect(normalizeEmail("sin-arroba")).toBeNull();
    expect(normalizeEmail("a@b")).toBeNull();
    expect(normalizeEmail("a b@c.com")).toBeNull();
    expect(normalizeEmail("<x@y.com>")).toBeNull();
    expect(normalizeEmail(undefined)).toBeNull();
  });

  it("OTP de 6 dígitos", () => {
    for (let i = 0; i < 200; i++) expect(generateOtp()).toMatch(/^\d{6}$/);
    expect(normalizeOtp("123 456")).toBe("123456");
    expect(normalizeOtp("12345")).toBeNull();
    expect(normalizeOtp("12345a")).toBeNull();
  });

  it("tokens opacos largos y únicos", () => {
    const a = createToken();
    expect(a.length).toBeGreaterThanOrEqual(43);
    expect(createToken()).not.toBe(a);
  });

  it("hash firmado con clave del servidor: mismo valor + etiqueta → mismo hash; otra etiqueta → otro", () => {
    expect(hmac("otp", "123456")).toBe(hmac("otp", "123456"));
    expect(hmac("otp", "123456")).not.toBe(hmac("link", "123456"));
    expect(hmac("otp", "123456")).not.toBe(sha256("123456"));
    expect(constantTimeEqual("abc", "abc")).toBe(true);
    expect(constantTimeEqual("abc", "abd")).toBe(false);
    expect(constantTimeEqual("abc", "abcd")).toBe(false);
  });

  it("la IP nunca se guarda en claro", () => {
    const h = clientIpHash(new Headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" }));
    expect(h).toHaveLength(32);
    expect(h).not.toContain("203");
    expect(clientIpHash(new Headers({ "x-forwarded-for": "203.0.113.9" }))).toBe(h);
  });
});

describe("origen de los POST (CSRF)", () => {
  const url = "https://appgenus.vercel.app/entregas/api/auth/request";
  it("acepta el sitio propio y el dominio público detrás del rewrite", () => {
    expect(isAllowedOrigin(new Headers({ origin: "https://appgenus.vercel.app", host: "appgenus.vercel.app" }), url)).toBe(true);
    expect(
      isAllowedOrigin(new Headers({ origin: "https://www.laboratoriogenus.com.ar", host: "appgenus.vercel.app", "x-forwarded-host": "www.laboratoriogenus.com.ar" }), url)
    ).toBe(true);
  });
  it("rechaza otros orígenes y la falta de Origin", () => {
    expect(isAllowedOrigin(new Headers({ origin: "https://evil.example", host: "appgenus.vercel.app" }), url)).toBe(false);
    expect(isAllowedOrigin(new Headers({ host: "appgenus.vercel.app" }), url)).toBe(false);
    expect(isAllowedOrigin(new Headers({ origin: "not a url", host: "appgenus.vercel.app" }), url)).toBe(false);
    expect(isAllowedOrigin(new Headers({ origin: "https://appgenus.vercel.app.evil.example", host: "appgenus.vercel.app" }), url)).toBe(false);
  });
});
