/**
 * Sincronización bidireccional REAL sobre COPIAS de Google Sheets + rama Neon DESCARTABLE (docss/42 §4).
 * Cubre: Google → GENUS, GENUS → Google, conflictos, auditoría, protección de fórmulas y ausencia de duplicados,
 * para Asignación de Lotes 2026 y SEMANAS 2026. Se salta sola si falta cualquier variable.
 *
 *   GENUS_IT_GOOGLE_CONFIRM_COPIES=yes
 *   GENUS_IT_GOOGLE_ASIGNACION_COPY_ID=<copia>  GENUS_IT_GOOGLE_ASIGNACION_TAB=<pestaña de la copia>
 *   GENUS_IT_GOOGLE_SEMANAS_COPY_ID=<copia>
 *   GENUS_IT_DATABASE_URL=<rama Neon descartable>  GENUS_IT_CONFIRM_DISPOSABLE_DB=yes
 *   GENUS_IT_PRODUCTION_DB_FINGERPRINT=<huella de la base de Production>
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY + GOOGLE_DRIVE_GENUS_FOLDER_ID
 *
 * Barreras: nunca en Vercel; se niega si un id es una planilla ORIGINAL protegida o si el título no dice
 * copia/copy/test/prueba; se niega si la base tiene la huella de Production. Cada celda tocada se restaura al final.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { google } from "googleapis";

vi.unmock("@/lib/adapters/sheets/sheets-reader");

const ASIG_ID = process.env.GENUS_IT_GOOGLE_ASIGNACION_COPY_ID?.trim();
const ASIG_TAB = process.env.GENUS_IT_GOOGLE_ASIGNACION_TAB?.trim();
const SEM_ID = process.env.GENUS_IT_GOOGLE_SEMANAS_COPY_ID?.trim();
const URL_IT = process.env.GENUS_IT_DATABASE_URL?.trim();
const PROD_FP = process.env.GENUS_IT_PRODUCTION_DB_FINGERPRINT?.trim();
const ENABLED =
  process.env.GENUS_IT_GOOGLE_CONFIRM_COPIES === "yes" &&
  process.env.GENUS_IT_CONFIRM_DISPOSABLE_DB === "yes" &&
  Boolean(ASIG_ID && ASIG_TAB && SEM_ID && URL_IT && PROD_FP) &&
  Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim()) &&
  !process.env.VERCEL &&
  !process.env.VERCEL_ENV;

const SAFE_TITLE = /copia|copy|test|prueba/i;
const produccion = { email: "it-prod@laboratoriogenus.com.ar", sector: "PRODUCCION" as const, displayName: "IT Producción" };
const RUN = `IT-${Date.now().toString(36)}`;

async function assertIsCopy(spreadsheetId: string): Promise<void> {
  const { isProtectedOriginalSpreadsheet } = await import("@/lib/google/protected-spreadsheets");
  if (isProtectedOriginalSpreadsheet(spreadsheetId)) throw new Error("SE NIEGA: es una planilla ORIGINAL protegida.");
  const { createGoogleAuth } = await import("@/lib/adapters/google/google-auth");
  const meta = await google.sheets({ version: "v4", auth: createGoogleAuth() }).spreadsheets.get({ spreadsheetId, fields: "properties.title" });
  const title = meta.data.properties?.title ?? "";
  if (!SAFE_TITLE.test(title)) throw new Error(`SE NIEGA: "${title}" no parece una copia de prueba.`);
}

describe.skipIf(!ENABLED)("Sincronización bidireccional real (copias + rama descartable)", () => {
  let pool: import("@neondatabase/serverless").Pool;
  let gw: import("@/lib/asignacion-lotes/writeback-gateway").GoogleSheetCellGateway;
  const restore: { id: string; tab: string; a1: string; value: string }[] = [];
  const q = async (text: string, params: unknown[] = []) => (await pool.query(text, params)).rows as Record<string, unknown>[];

  beforeAll(async () => {
    await assertIsCopy(ASIG_ID!);
    await assertIsCopy(SEM_ID!);
    const { databaseFingerprint } = await import("@/lib/config/db-fingerprint");
    if (databaseFingerprint(URL_IT) === PROD_FP) throw new Error("SE NIEGA: GENUS_IT_DATABASE_URL es la base de Production.");
    vi.stubEnv("DATABASE_URL", URL_IT!);
    vi.stubEnv("ASIGNACION_LOTES_WRITEBACK", "1");
    vi.stubEnv("ASIGNACION_LOTES_WRITEBACK_SPREADSHEET_IDS", ASIG_ID!);
    vi.stubEnv("SEMANAS_SHEET_ID", SEM_ID!);
    vi.stubEnv("SEMANAS_WRITEBACK", "1");
    vi.stubEnv("SEMANAS_WRITEBACK_SPREADSHEET_IDS", SEM_ID!);
    const script = path.resolve(__dirname, "../../scripts/migrate-if-database.mjs");
    const r = spawnSync("node", [script], { env: { ...process.env, DATABASE_URL: URL_IT, DATABASE_URL_UNPOOLED: URL_IT }, encoding: "utf8" });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    const { Pool, neonConfig } = await import("@neondatabase/serverless");
    neonConfig.webSocketConstructor = (await import("ws")).default;
    pool = new Pool({ connectionString: URL_IT });
    const { GoogleSheetCellGateway } = await import("@/lib/asignacion-lotes/writeback-gateway");
    gw = new GoogleSheetCellGateway();
  }, 180_000);

  afterAll(async () => {
    // Deja las copias como estaban (en orden inverso).
    for (const c of restore.reverse()) await gw?.writeCell(c.id, c.tab, c.a1, c.value).catch(() => undefined);
    vi.unstubAllEnvs();
    await pool?.end();
  }, 120_000);

  describe("Asignación de Lotes (copia)", () => {
    let sourceId = "";
    let recordId = "";
    let lote = "";
    let a1 = "";

    async function record() {
      const { getAsignacionLotesService } = await import("@/lib/asignacion-lotes/asignacion-lotes-service");
      return (await getAsignacionLotesService().get(produccion, recordId))!;
    }
    async function sync() {
      const { syncSourceById } = await import("@/lib/asignacion-lotes/asignacion-lotes-sync-service");
      return (await syncSourceById(sourceId, "it", "manual"))!;
    }

    it("Google → GENUS: la sincronización importa la pestaña de la copia", async () => {
      const { getAsignacionLoteSourcesService } = await import("@/lib/asignacion-lotes/asignacion-lote-sources-service");
      const src = await getAsignacionLoteSourcesService().createSpreadsheetLevelSourceForSync({ name: RUN, period: RUN, spreadsheetId: ASIG_ID!, createdBy: "it" });
      sourceId = src.id;
      const run = await sync();
      expect(["ok", "parcial"], JSON.stringify(run)).toContain(run.status);
      expect(run.rowsRead).toBeGreaterThan(0);
      // Una fila real de la pestaña elegida, con su celda de OBSERVACIONES.
      const { autoMapColumns, rowToObject } = await import("@/features/os/operational/lib/clipboard-import");
      const { ASIGNACION_LOTES_FIELD_ALIASES } = await import("@/features/os/operational/lib/asignacion-lotes-import");
      const { locateTabHeader } = await import("@/lib/asignacion-lotes/asignacion-lotes-sync-service");
      const { columnLetter } = await import("@/lib/asignacion-lotes/asignacion-lotes-writeback-service");
      const located = locateTabHeader(await gw.readTab(ASIG_ID!, ASIG_TAB!));
      const mapping = autoMapColumns(located.header, ASIGNACION_LOTES_FIELD_ALIASES);
      expect(mapping.observaciones, "la copia necesita una columna OBSERVACIONES").not.toBeNull();
      const idx = located.dataRows.findIndex((r) => rowToObject(r, mapping).lote?.trim());
      lote = rowToObject(located.dataRows[idx]!, mapping).lote!.trim();
      a1 = `${columnLetter(mapping.observaciones as number)}${located.headerRowIndex! + idx + 2}`;
      restore.push({ id: ASIG_ID!, tab: ASIG_TAB!, a1, value: (await gw.readFormula(ASIG_ID!, ASIG_TAB!, a1)) ?? (await gw.readCell(ASIG_ID!, ASIG_TAB!, a1)) });
      const rows = await q("select id from asignacion_lotes where source_id = $1 and lote = $2 and archived = false", [sourceId, lote]);
      expect(rows.length).toBe(1);
      recordId = String(rows[0]!.id);
    }, 300_000);

    it("Google → GENUS: un cambio hecho en la copia llega a GENUS en la siguiente sincronización", async () => {
      await gw.writeCell(ASIG_ID!, ASIG_TAB!, a1, `${RUN}-desde-google`);
      await sync();
      expect((await record()).observaciones).toBe(`${RUN}-desde-google`);
    }, 300_000);

    it("GENUS → Google: editar la celda en GENUS la escribe en la copia y en la base", async () => {
      const { patchCellsWithWriteback } = await import("@/lib/asignacion-lotes/asignacion-lotes-writeback-service");
      const rec = await record();
      const res = await patchCellsWithWriteback(produccion, [{ id: recordId, field: "observaciones", value: `${RUN}-desde-genus`, expectedVersion: rec.updatedAt }]);
      expect(res.ok, JSON.stringify(res.results)).toBe(true);
      expect(await gw.readCell(ASIG_ID!, ASIG_TAB!, a1)).toBe(`${RUN}-desde-genus`);
      expect((await record()).observaciones).toBe(`${RUN}-desde-genus`);
    }, 120_000);

    it("auditoría: la edición queda registrada con valor anterior, nuevo y usuario", async () => {
      const audit = await q("select old_value, new_value, actor_email from asignacion_lotes_cell_audit where record_id = $1 and field = 'observaciones' order by created_at desc limit 1", [recordId]);
      expect(audit[0]).toMatchObject({ old_value: `${RUN}-desde-google`, new_value: `${RUN}-desde-genus`, actor_email: produccion.email });
    });

    it("conflicto: si la celda cambió en Google, GENUS no la pisa", async () => {
      const { patchCellsWithWriteback } = await import("@/lib/asignacion-lotes/asignacion-lotes-writeback-service");
      await gw.writeCell(ASIG_ID!, ASIG_TAB!, a1, `${RUN}-otro-usuario`);
      const rec = await record();
      const res = await patchCellsWithWriteback(produccion, [{ id: recordId, field: "observaciones", value: `${RUN}-no-debe`, expectedVersion: rec.updatedAt }]);
      expect(res.results[0]).toMatchObject({ status: "failed", code: "GOOGLE_CONFLICT" });
      expect(await gw.readCell(ASIG_ID!, ASIG_TAB!, a1)).toBe(`${RUN}-otro-usuario`);
    }, 120_000);

    it("fórmulas: una celda con fórmula en la copia nunca se sobrescribe", async () => {
      const { patchCellsWithWriteback } = await import("@/lib/asignacion-lotes/asignacion-lotes-writeback-service");
      await gw.writeCell(ASIG_ID!, ASIG_TAB!, a1, '="IT-FORMULA"');
      await sync();
      const rec = await record();
      const res = await patchCellsWithWriteback(produccion, [{ id: recordId, field: "observaciones", value: `${RUN}-sobre-formula`, expectedVersion: rec.updatedAt }]);
      expect(res.results[0]).toMatchObject({ status: "failed" });
      expect(await gw.readFormula(ASIG_ID!, ASIG_TAB!, a1)).toBe('="IT-FORMULA"');
    }, 300_000);

    it("sin duplicados: sincronizar otra vez no crea registros nuevos", async () => {
      const count = async () => Number((await q("select count(*)::int as n from asignacion_lotes where source_id = $1", [sourceId]))[0]!.n);
      const before = await count();
      const run = await sync();
      expect(run.createdCount).toBe(0);
      expect(await count()).toBe(before);
      const dupes = await q("select lote, codigo, producto, count(*)::int as n from asignacion_lotes where source_id = $1 and archived = false group by 1,2,3 having count(*) > 1", [sourceId]);
      expect(dupes).toEqual([]);
    }, 300_000);
  });

  describe("SEMANAS 2026 (copia)", () => {
    const TODAY = "2000-01-01"; // fechas "futuras" → no exige motivo
    let a1 = "";
    let original = "";

    it("Google → GENUS: la vista lee la copia en vivo, incluido un cambio hecho en Google", async () => {
      const { loadSemanasView, setSemanasGatewayForTests } = await import("@/lib/semanas-sheet/semanas-sheet-service");
      const { buildOperationalLocks, setOperationalLocksForTests } = await import("@/lib/semanas-sheet/operational-locks");
      setSemanasGatewayForTests(gw);
      setOperationalLocksForTests(buildOperationalLocks({ deliveries: [], remitos: [], closedWorkItems: [] }));
      const view = await loadSemanasView("ELABORACION", TODAY);
      expect(view.writable).toBe(true);
      const cell = view.weeks!.flatMap((w) => w.rows).flatMap((r) => r.cells).find((c) => !c.protection && c.value.trim());
      expect(cell, "la copia necesita una celda de planificación con texto").toBeTruthy();
      a1 = cell!.a1;
      original = cell!.value;
      restore.push({ id: SEM_ID!, tab: "ELABORACION", a1, value: (await gw.readFormula(SEM_ID!, "ELABORACION", a1)) ?? original });
      await gw.writeCell(SEM_ID!, "ELABORACION", a1, `${original} ${RUN}-G`);
      const after = await loadSemanasView("ELABORACION", TODAY);
      expect(after.weeks!.flatMap((w) => w.rows).flatMap((r) => r.cells).find((c) => c.a1 === a1)?.value).toBe(`${original} ${RUN}-G`);
    }, 180_000);

    it("GENUS → Google: escribe solo esa celda; combinadas y fórmulas intactas; queda auditado", async () => {
      const { writeSemanasCell } = await import("@/lib/semanas-sheet/semanas-sheet-service");
      const snap = async () => ({
        merges: JSON.stringify(await gw.readMerges(SEM_ID!, "ELABORACION")),
        formulas: JSON.stringify([...(await gw.readFormulaCells(SEM_ID!, "ELABORACION"))].sort()),
      });
      const before = await snap();
      const r = await writeSemanasCell(produccion, { tabKey: "ELABORACION", a1, expectedValue: `${original} ${RUN}-G`, value: `${original} ${RUN}-W` }, TODAY);
      expect(r.ok, JSON.stringify(r)).toBe(true);
      expect(await gw.readCell(SEM_ID!, "ELABORACION", a1)).toBe(`${original} ${RUN}-W`);
      expect(await snap()).toEqual(before);
      const audit = await q("select old_value, new_value, actor_email, status from sheet_cell_edits where spreadsheet_id = $1 and a1 = $2 order by created_at desc limit 1", [SEM_ID, a1]);
      expect(audit[0]).toMatchObject({ old_value: `${original} ${RUN}-G`, new_value: `${original} ${RUN}-W`, actor_email: produccion.email });
    }, 180_000);

    it("conflicto: si la celda cambió en Google desde que se leyó, no escribe", async () => {
      const { writeSemanasCell } = await import("@/lib/semanas-sheet/semanas-sheet-service");
      await gw.writeCell(SEM_ID!, "ELABORACION", a1, `${original} ${RUN}-X`);
      const r = await writeSemanasCell(produccion, { tabKey: "ELABORACION", a1, expectedValue: `${original} ${RUN}-W`, value: "NO-DEBE" }, TODAY);
      expect(r.ok).toBe(false);
      expect(await gw.readCell(SEM_ID!, "ELABORACION", a1)).toBe(`${original} ${RUN}-X`);
    }, 120_000);

    it("idempotente: repetir el mismo cambio no escribe dos veces", async () => {
      const { writeSemanasCell } = await import("@/lib/semanas-sheet/semanas-sheet-service");
      const e = { tabKey: "ELABORACION" as const, a1, expectedValue: `${original} ${RUN}-X`, value: `${original} ${RUN}-Y` };
      expect((await writeSemanasCell(produccion, e, TODAY)).ok).toBe(true);
      expect(await writeSemanasCell(produccion, e, TODAY)).toMatchObject({ ok: true, idempotent: true });
    }, 120_000);
  });
});
