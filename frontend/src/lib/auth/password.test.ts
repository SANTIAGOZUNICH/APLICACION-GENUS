import { afterEach, describe, expect, it, vi } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/auth/password";

describe("password helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("hashPassword produce un hash bcrypt (no el texto plano)", async () => {
    const input = "test-input";
    const hash = await hashPassword(input);
    expect(hash).not.toBe(input);
    expect(hash).toMatch(/^\$2[aby]\$12\$/);
  });

  it("verifyPassword acepta la contraseña correcta", async () => {
    const hash = await hashPassword("mi-clave-secreta");
    await expect(verifyPassword("mi-clave-secreta", hash)).resolves.toBe(true);
  });

  it("verifyPassword rechaza una contraseña incorrecta", async () => {
    const hash = await hashPassword("mi-clave-secreta");
    await expect(verifyPassword("otra-clave", hash)).resolves.toBe(false);
  });

  it("verifyPassword nunca lanza con hash inválido/corrupto", async () => {
    await expect(verifyPassword("cualquiera", "no-es-un-hash-bcrypt")).resolves.toBe(false);
  });

  it("verifyPassword devuelve false con inputs vacíos", async () => {
    await expect(verifyPassword("", "")).resolves.toBe(false);
    await expect(verifyPassword("algo", "")).resolves.toBe(false);
  });

  it("nunca loguea la contraseña en texto plano (console.log/warn/error)", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const secret = "super-secreta-no-debe-aparecer-en-logs";
    const hash = await hashPassword(secret);
    await verifyPassword(secret, hash);
    await verifyPassword("otra-cosa", hash);
    await verifyPassword(secret, "hash-corrupto");

    for (const spy of [logSpy, warnSpy, errorSpy]) {
      for (const call of spy.mock.calls) {
        for (const arg of call) {
          expect(String(arg)).not.toContain(secret);
        }
      }
    }
  });
});
