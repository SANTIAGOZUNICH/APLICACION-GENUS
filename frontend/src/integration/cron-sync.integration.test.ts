/**
 * Integración REAL del cron de sincronización de Asignación de Lotes (`GET /api/cron/asignacion-lotes-sync`):
 * LEE las planillas oficiales en Google (solo lectura) y ESCRIBE únicamente en una rama Neon DESCARTABLE.
 *
 * Se salta sola salvo que TODO esto esté presente (ver docss/42 §3–§4):
 *   GENUS_IT_CRON_CONFIRM=yes
 *   GENUS_IT_DATABASE_URL=<rama Neon descartable>   GENUS_IT_CONFIRM_DISPOSABLE_DB=yes
 *   GENUS_IT_PRODUCTION_DB_FINGERPRINT=<databaseFingerprint de /api/v1/env-check en Production>
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY (lectura de las planillas)
 *
 * Barreras: nunca dentro de Vercel; la base NO puede tener la huella de Production; el write-back a Google queda
 * apagado y cualquier intento de escribir una celda hace fallar la prueba.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// vitest.setup.ts reemplaza el lector de Sheets por un mock: esta prueba necesita el real (solo lectura).
vi.unmock("@/lib/adapters/sheets/sheets-reader");

const URL_IT = process.env.GENUS_IT_DATABASE_URL?.trim();
const PROD_FP = process.env.GENUS_IT_PRODUCTION_DB_FINGERPRINT?.trim();
const ENABLED =
  process.env.GENUS_IT_CRON_CONFIRM === "yes" &&
  process.env.GENUS_IT_CONFIRM_DISPOSABLE_DB === "yes" &&
  Boolean(URL_IT) &&
  Boolean(PROD_FP) &&
  Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim()) &&
  !process.env.VERCEL &&
  !process.env.VERCEL_ENV;

describe.skipIf(!ENABLED)("Cron real: Google (solo lectura) → rama Neon descartable", () => {
  let pool: import("@neondatabase/serverless").Pool;
  let writeSpy: { mock: { calls: unknown[] } } | null = null;
  const q = async (text: string) => (await pool.query(text)).rows as Record<string, unknown>[];
  const cron = async (auth: string | null) => {
    const { GET } = await import("@/app/api/cron/asignacion-lotes-sync/route");
    return GET(new Request("http://localhost/api/cron/asignacion-lotes-sync", { headers: auth ? { authorization: auth } : {} }));
  };

  beforeAll(async () => {
    const { databaseFingerprint } = await import("@/lib/config/db-fingerprint");
    if (databaseFingerprint(URL_IT) === PROD_FP) {
      throw new Error("SE NIEGA: GENUS_IT_DATABASE_URL tiene la huella de la base de Production.");
    }
    vi.stubEnv("DATABASE_URL", URL_IT!);
    vi.stubEnv("CRON_SECRET", "it-cron-secret");
    vi.stubEnv("ASIGNACION_LOTES_WRITEBACK", "");
    vi.stubEnv("ASIGNACION_LOTES_WRITEBACK_SPREADSHEET_IDS", "");
    vi.stubEnv("SEMANAS_WRITEBACK", "");
    const { GoogleSheetCellGateway } = await import("@/lib/asignacion-lotes/writeback-gateway");
    writeSpy = vi.spyOn(GoogleSheetCellGateway.prototype, "writeCell").mockImplementation(async () => {
      throw new Error("PRUEBA: intento de escritura en Google bloqueado");
    });
    // Migraciones con el script real (idempotente).
    const script = path.resolve(__dirname, "../../scripts/migrate-if-database.mjs");
    const r = spawnSync("node", [script], { env: { ...process.env, DATABASE_URL: URL_IT, DATABASE_URL_UNPOOLED: URL_IT }, encoding: "utf8" });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    const { Pool, neonConfig } = await import("@neondatabase/serverless");
    neonConfig.webSocketConstructor = (await import("ws")).default;
    pool = new Pool({ connectionString: URL_IT });
  }, 180_000);

  afterAll(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await pool?.end();
  });

  it("sin el secreto correcto responde 401 y no sincroniza", async () => {
    expect((await cron(null)).status).toBe(401);
    expect((await cron("Bearer otro")).status).toBe(401);
  });

  it("con el secreto sincroniza las 2 fuentes oficiales sin errores", async () => {
    const res = await cron("Bearer it-cron-secret");
    const body = (await res.json()) as { ok: boolean; sourcesSynced: number; results: { status: string; rowsRead: number }[] };
    expect(res.status, JSON.stringify(body).slice(0, 500)).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.sourcesSynced).toBe(2);
    for (const run of body.results) {
      expect(["ok", "parcial"], JSON.stringify(run)).toContain(run.status);
      expect(run.rowsRead).toBeGreaterThan(0);
    }
  }, 300_000);

  it("una segunda corrida es idempotente (no duplica lotes)", async () => {
    const count = async () => Number((await q("select count(*)::int as n from asignacion_lotes"))[0]!.n);
    const before = await count();
    const res = await cron("Bearer it-cron-secret");
    expect(res.status).toBe(200);
    expect(await count()).toBe(before);
  }, 300_000);

  it("nunca intentó escribir en Google", () => {
    expect(writeSpy?.mock.calls.length ?? 0).toBe(0);
  });
});
