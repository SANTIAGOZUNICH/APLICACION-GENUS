import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SECTOR_ACCOUNT_DIRECTORY, normalizeEmail } from "./directory";
import { PASSWORD_ENV_BY_EMAIL, PREVIEW_MEMORY_DEMO_PASSWORDS } from "./get-auth-service";

/**
 * Regresión: el login de Codificado en Preview falló porque la cuenta
 * existía en el directorio (directory.ts) pero nunca quedó sembrada con
 * contraseña en genus_auth_users — GENUS_AUTH_PASSWORD_CODIFICADO faltaba
 * cuando se corrió scripts/seed-genus-auth.mjs. Eso es un dato faltante en
 * Neon, no algo que un test pueda detectar. Lo que SÍ se puede blindar acá:
 * las cuatro listas que deben mantenerse sincronizadas manualmente
 * (directory.ts, los dos mapas de get-auth-service.ts, y el DIRECTORY
 * duplicado dentro de seed-genus-auth.mjs) — si en el futuro se agrega un
 * sector nuevo a una y se olvida en otra, este test lo marca en CI antes
 * de que llegue a Preview.
 */
describe("Paridad de cuentas de sector — auth", () => {
  it("SECTOR_ACCOUNT_DIRECTORY incluye CODIFICADO", () => {
    const codificado = SECTOR_ACCOUNT_DIRECTORY.find((e) => e.sector === "CODIFICADO");
    expect(codificado).toBeDefined();
    expect(codificado?.email).toBe("codificado@laboratoriogenus.com.ar");
    expect(codificado?.redirectTo).toBe("/mi-trabajo");
  });

  it("todo email de SECTOR_ACCOUNT_DIRECTORY tiene su GENUS_AUTH_PASSWORD_* mapeado", () => {
    for (const entry of SECTOR_ACCOUNT_DIRECTORY) {
      const email = normalizeEmail(entry.email);
      expect(PASSWORD_ENV_BY_EMAIL[email], `falta PASSWORD_ENV_BY_EMAIL para ${email}`).toBeDefined();
    }
  });

  it("todo email de SECTOR_ACCOUNT_DIRECTORY tiene contraseña demo de memoria (Preview sin 0016)", () => {
    for (const entry of SECTOR_ACCOUNT_DIRECTORY) {
      const email = normalizeEmail(entry.email);
      expect(
        PREVIEW_MEMORY_DEMO_PASSWORDS[email],
        `falta PREVIEW_MEMORY_DEMO_PASSWORDS para ${email}`
      ).toBeDefined();
    }
  });

  it("ningún mapa de contraseñas tiene una entrada huérfana sin cuenta en el directorio", () => {
    const directoryEmails = new Set(SECTOR_ACCOUNT_DIRECTORY.map((e) => normalizeEmail(e.email)));
    for (const email of Object.keys(PASSWORD_ENV_BY_EMAIL)) {
      expect(directoryEmails.has(email), `PASSWORD_ENV_BY_EMAIL tiene un email huérfano: ${email}`).toBe(
        true
      );
    }
    for (const email of Object.keys(PREVIEW_MEMORY_DEMO_PASSWORDS)) {
      expect(
        directoryEmails.has(email),
        `PREVIEW_MEMORY_DEMO_PASSWORDS tiene un email huérfano: ${email}`
      ).toBe(true);
    }
  });

  it("scripts/seed-genus-auth.mjs sigue teniendo una entrada por cada cuenta del directorio", () => {
    // El script corre con `node` plano (sin loader TS/paths) y duplica el
    // directorio a propósito (ver comentario en el propio script) — se
    // parsea el archivo como texto en vez de importarlo.
    const scriptPath = join(__dirname, "../../../scripts/seed-genus-auth.mjs");
    const source = readFileSync(scriptPath, "utf8");
    for (const entry of SECTOR_ACCOUNT_DIRECTORY) {
      expect(
        source.includes(entry.email),
        `seed-genus-auth.mjs no menciona ${entry.email} — el seed la va a omitir en silencio`
      ).toBe(true);
      const passwordEnvMatch = new RegExp(
        `email:\\s*"${entry.email}"[\\s\\S]*?passwordEnv:\\s*"([A-Z_]+)"`
      ).exec(source);
      expect(
        passwordEnvMatch,
        `seed-genus-auth.mjs no tiene passwordEnv para ${entry.email}`
      ).not.toBeNull();
    }
  });
});
