/**
 * Paso de SINCRONIZACIÓN REAL para el E2E de Asignación de lotes (scripts/e2e/asignacion-lotes-production-validate.mjs).
 *
 * Corre el MISMO motor que usa el cron de Production (`syncSource`) contra la base de PRUEBA, con la "planilla"
 * servida en memoria: nunca se llama a Google. El E2E lo invoca entre ediciones en el navegador para comprobar que,
 * tras un sync, lo editado en GENUS se mantiene o queda como conflicto visible.
 *
 * Se SALTA salvo que el E2E pase GENUS_E2E_SYNC_STEP={"sourceId","tab","rows":[[encabezados],[fila]…]} y una base
 * local marcada (GENUS_E2E_DATABASE_URL).
 */
import { describe, expect, it, vi } from "vitest";
import { assertMarkedDatabase, e2eEnvironmentProblem } from "../../scripts/e2e/e2e-safety.mjs";

const STEP = process.env.GENUS_E2E_SYNC_STEP;
const PROBLEM = !STEP
  ? "solo lo invoca el E2E (GENUS_E2E_SYNC_STEP)"
  : (e2eEnvironmentProblem() ?? (process.env.GENUS_E2E_DATABASE_URL ? null : "falta GENUS_E2E_DATABASE_URL"));

const step = STEP ? (JSON.parse(STEP) as { sourceId: string; tab: string; rows: string[][] }) : null;

// La "planilla": filas en memoria. Cualquier otra pestaña o planilla → error (nunca se sale a Google).
vi.mock("@/lib/adapters/sheets/sheets-reader", () => ({
  sheetsReader: {
    readTab: async (_spreadsheetId: string, tab: string) => {
      if (!step || tab !== step.tab) throw new Error(`E2E: pestaña inesperada ${tab}`);
      return step.rows;
    },
    listTabs: async () => (step ? [step.tab] : []),
  },
}));
vi.mock("@/lib/asignacion-lotes/official-sources", () => ({
  ensureOfficialSourcesAndRetireRedundant: vi.fn().mockResolvedValue(undefined),
  OFFICIAL_ASIGNACION_LOTES_SPREADSHEETS: [],
}));

describe.skipIf(Boolean(PROBLEM))(`E2E · sync real de Asignación de lotes${PROBLEM ? ` — saltado: ${PROBLEM}` : ""}`, () => {
  it("sincroniza la fuente de prueba con el motor real", async () => {
    process.env.DATABASE_URL = process.env.GENUS_E2E_DATABASE_URL!;
    const { Pool, neonConfig } = await import("@neondatabase/serverless");
    neonConfig.webSocketConstructor = (await import("ws")).default as never;
    const pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
    try {
      await assertMarkedDatabase(async (text: string, params: unknown[] = []) => (await pool.query(text, params)).rows);
    } finally {
      await pool.end();
    }
    const { getAsignacionLoteSourcesService } = await import("@/lib/asignacion-lotes/asignacion-lote-sources-service");
    const { syncSource } = await import("@/lib/asignacion-lotes/asignacion-lotes-sync-service");
    const source = await getAsignacionLoteSourcesService().getForSync(step!.sourceId);
    expect(source, "fuente de prueba").toBeTruthy();
    const summary = await syncSource(source!, "e2e", "manual");
    console.log(`[e2e-sync] ${JSON.stringify({ status: summary.status, read: summary.rowsRead, created: summary.createdCount, updated: summary.updatedCount, unchanged: summary.unchangedCount, archived: summary.archivedCount, error: summary.errorMessage })}`);
    expect(summary.status).toBe("ok");
  }, 60_000);
});
