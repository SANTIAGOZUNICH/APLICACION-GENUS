import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSetCookieHeader, clearCookieHeader, COOKIE_NAME, parseSessionCookie } from "@/lib/auth/cookies";

describe("cookies", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("COOKIE_NAME es genus_session", () => {
    expect(COOKIE_NAME).toBe("genus_session");
  });

  it("buildSetCookieHeader incluye HttpOnly, SameSite=Lax, Path=/ y Max-Age", () => {
    const header = buildSetCookieHeader("tok123");
    expect(header).toContain("genus_session=tok123");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain("Path=/");
    expect(header).toMatch(/Max-Age=\d+/);
  });

  it("buildSetCookieHeader agrega Secure en NODE_ENV=production", () => {
    vi.stubEnv("NODE_ENV", "production");
    const header = buildSetCookieHeader("tok123");
    expect(header).toContain("Secure");
  });

  it("buildSetCookieHeader agrega Secure cuando VERCEL_ENV=preview", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("VERCEL_ENV", "preview");
    const header = buildSetCookieHeader("tok123");
    expect(header).toContain("Secure");
  });

  it("clearCookieHeader expira la cookie (Max-Age=0)", () => {
    const header = clearCookieHeader();
    expect(header).toContain("genus_session=");
    expect(header).toContain("Max-Age=0");
  });

  it("parseSessionCookie extrae el token del header Cookie", () => {
    expect(parseSessionCookie("genus_session=abc123; other=1")).toBe("abc123");
    expect(parseSessionCookie("other=1; genus_session=abc123")).toBe("abc123");
  });

  it("parseSessionCookie devuelve null si no hay cookie", () => {
    expect(parseSessionCookie(null)).toBeNull();
    expect(parseSessionCookie("other=1")).toBeNull();
    expect(parseSessionCookie("")).toBeNull();
  });
});
