/** Guardas del E2E local: nunca Vercel/producción, solo base local marcada y app local. Sin servicios externos. */
import { describe, expect, it } from "vitest";
import { assertE2eEnvironment, assertMarkedDatabase, e2eEnvironmentProblem } from "../../scripts/e2e/e2e-safety.mjs";

type Env = Record<string, string | undefined>;
const OK: Env = {
  GENUS_E2E_CONFIRM_DISPOSABLE_DB: "yes",
  GENUS_E2E_DATABASE_URL: "postgres://genus:x@localhost/genus_e2e",
  GENUS_E2E_BASE_URL: "http://localhost:3100",
};

describe("e2eEnvironmentProblem", () => {
  it("acepta base y app locales con confirmación explícita", () => {
    expect(e2eEnvironmentProblem(OK)).toBeNull();
    expect(e2eEnvironmentProblem({ ...OK, GENUS_E2E_DATABASE_URL: "postgres://u:p@127.0.0.1:5432/db" })).toBeNull();
  });

  it.each([
    ["dentro de Vercel", { VERCEL: "1" }],
    ["Preview de Vercel", { VERCEL_ENV: "preview" }],
    ["Production de Vercel", { VERCEL_ENV: "production" }],
    ["GENUS_ENV=production", { GENUS_ENV: "production" }],
    ["NODE_ENV=production", { NODE_ENV: "production" }],
    ["sin confirmación", { GENUS_E2E_CONFIRM_DISPOSABLE_DB: "" }],
    ["sin URL de base", { GENUS_E2E_DATABASE_URL: "" }],
    ["base remota (Neon) sin permiso explícito", { GENUS_E2E_DATABASE_URL: "postgres://u:p@ep-x.us-east-2.aws.neon.tech/neondb" }],
    ["app desplegada en Vercel", { GENUS_E2E_BASE_URL: "https://aplicacion-genus.vercel.app" }],
    ["app por https remota", { GENUS_E2E_BASE_URL: "https://localhost.example.com" }],
  ] as [string, Env][])("rechaza: %s", (_label, override) => {
    const env: Env = { ...OK, ...override };
    expect(e2eEnvironmentProblem(env)).not.toBeNull();
    expect(() => assertE2eEnvironment(env)).toThrow(/e2e-safety/);
  });

  it("base remota solo con GENUS_E2E_ALLOW_REMOTE_DB=yes (rama Neon descartable)", () => {
    const env: Env = { ...OK, GENUS_E2E_DATABASE_URL: "postgres://u:p@ep-x.neon.tech/db", GENUS_E2E_ALLOW_REMOTE_DB: "yes" };
    expect(e2eEnvironmentProblem(env)).toBeNull();
  });
});

describe("assertMarkedDatabase", () => {
  const db = (reg: string | null, purpose?: string) => async (sql: string) =>
    sql.includes("to_regclass") ? [{ reg }] : [{ purpose }];

  it("acepta la base con la marca del setup", async () => {
    await expect(assertMarkedDatabase(db("genus_e2e_marker", "genus-e2e-disposable"))).resolves.toBeUndefined();
  });
  it("rechaza una base sin marca (Production/Preview nunca la tienen)", async () => {
    await expect(assertMarkedDatabase(db(null))).rejects.toThrow(/no tiene la marca/);
  });
  it("rechaza una marca con contenido inesperado", async () => {
    await expect(assertMarkedDatabase(db("genus_e2e_marker", "otra-cosa"))).rejects.toThrow(/inválida/);
  });
});
