/**
 * Integración REAL contra COPIAS de Google Sheets (nunca las originales). Se salta sin variables GENUS_IT_*.
 * ⚠️ NO EJECUTADA en el entorno de desarrollo de este PR (sin acceso a Google): ver docss/40 §7.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { google } from "googleapis";

const CONFIRMED = process.env.GENUS_IT_GOOGLE_CONFIRM_COPIES === "yes";
const SEM_ID = process.env.GENUS_IT_GOOGLE_SEMANAS_COPY_ID?.trim();
const ASIG_ID = process.env.GENUS_IT_GOOGLE_ASIGNACION_COPY_ID?.trim();
const ASIG_TAB = process.env.GENUS_IT_GOOGLE_ASIGNACION_TAB?.trim();
const SAFE_TITLE = /copia|copy|test|prueba/i;

async function assertIsCopy(spreadsheetId: string): Promise<void> {
  const { createGoogleAuth } = await import("@/lib/adapters/google/google-auth");
  const sheets = google.sheets({ version: "v4", auth: createGoogleAuth() });
  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: "properties.title" });
  const title = meta.data.properties?.title ?? "";
  if (!SAFE_TITLE.test(title)) throw new Error(`SE NIEGA: "${title}" no parece una copia de prueba (el título debe contener copia/copy/test/prueba).`);
}

const produccion = { email: "it-prod@laboratoriogenus.com.ar", sector: "PRODUCCION" as const, displayName: "IT Producción" };

describe.skipIf(!CONFIRMED || !SEM_ID)("Google real (copia de SEMANAS): escribir UNA celda no altera combinadas, fórmulas ni vecinas", () => {
  beforeEach(() => {
    vi.stubEnv("SEMANAS_SHEET_ID", SEM_ID!);
    vi.stubEnv("SEMANAS_WRITEBACK", "1");
    vi.stubEnv("SEMANAS_WRITEBACK_SPREADSHEET_IDS", SEM_ID!);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("edita y revierte una celda de planificación; el resto de la hoja queda idéntico", async () => {
    await assertIsCopy(SEM_ID!);
    const { GoogleSheetCellGateway } = await import("@/lib/asignacion-lotes/writeback-gateway");
    const { loadSemanasView, writeSemanasCell, setSemanasGatewayForTests } = await import("@/lib/semanas-sheet/semanas-sheet-service");
    const { setOperationalLocksForTests } = await import("@/lib/semanas-sheet/operational-locks");
    const { buildOperationalLocks } = await import("@/lib/semanas-sheet/operational-locks");
    const gw = new GoogleSheetCellGateway();
    setSemanasGatewayForTests(gw);
    setOperationalLocksForTests(buildOperationalLocks({ deliveries: [], remitos: [], closedWorkItems: [] }));
    try {
      const today = "2000-01-01"; // fechas futuras → sin motivo obligatorio
      const view = await loadSemanasView("ELABORACION", today);
      const cell = view.weeks!.flatMap((w) => w.rows).flatMap((r) => r.cells).find((c) => !c.protection && c.value.trim());
      expect(cell, "la copia debe tener al menos una celda de planificación con texto").toBeTruthy();
      const snapshot = async () => ({
        values: JSON.stringify(await gw.readTab(SEM_ID!, "ELABORACION")),
        merges: JSON.stringify(await gw.readMerges(SEM_ID!, "ELABORACION")),
        formulas: JSON.stringify([...(await gw.readFormulaCells(SEM_ID!, "ELABORACION"))].sort()),
      });
      const before = await snapshot();
      const mark = `${cell!.value} [IT]`;
      const w = await writeSemanasCell(produccion, { tabKey: "ELABORACION", a1: cell!.a1, expectedValue: cell!.value, value: mark }, today);
      expect(w.ok, JSON.stringify(w)).toBe(true);
      const during = await snapshot();
      expect(during.merges).toBe(before.merges);
      expect(during.formulas).toBe(before.formulas);
      const a = JSON.parse(before.values) as string[][];
      const b = JSON.parse(during.values) as string[][];
      let diffs = 0;
      b.forEach((row, i) => row.forEach((v, j) => { if (v !== (a[i]?.[j] ?? "")) diffs += 1; }));
      expect(diffs).toBe(1);
      const back = await writeSemanasCell(produccion, { tabKey: "ELABORACION", a1: cell!.a1, expectedValue: mark, value: cell!.value }, today);
      expect(back.ok).toBe(true);
      expect(await snapshot()).toEqual(before);
    } finally {
      setSemanasGatewayForTests(null);
      setOperationalLocksForTests(null);
    }
  }, 120_000);
});

describe.skipIf(!CONFIRMED || !ASIG_ID || !ASIG_TAB)("Google real (copia de Asignación de Lotes): write-back, conflicto y reconciliación", () => {
  beforeEach(() => {
    vi.stubEnv("ASIGNACION_LOTES_WRITEBACK", "1");
    vi.stubEnv("ASIGNACION_LOTES_WRITEBACK_SPREADSHEET_IDS", ASIG_ID!);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("escribe una celda (observaciones), detecta cambio externo como conflicto y revierte", async () => {
    await assertIsCopy(ASIG_ID!);
    const { GoogleSheetCellGateway } = await import("@/lib/asignacion-lotes/writeback-gateway");
    const { autoMapColumns, rowToObject } = await import("@/features/os/operational/lib/clipboard-import");
    const { ASIGNACION_LOTES_FIELD_ALIASES, buildAsignacionLoteFromMappedRow } = await import("@/features/os/operational/lib/asignacion-lotes-import");
    const { locateTabHeader } = await import("@/lib/asignacion-lotes/asignacion-lotes-sync-service");
    const { getAsignacionLotesService } = await import("@/lib/asignacion-lotes/asignacion-lotes-service");
    const { getAsignacionLoteSourcesService } = await import("@/lib/asignacion-lotes/asignacion-lote-sources-service");
    const { patchCellsWithWriteback, setWritebackGatewayForTests, columnLetter } = await import("@/lib/asignacion-lotes/asignacion-lotes-writeback-service");
    const gw = new GoogleSheetCellGateway();
    setWritebackGatewayForTests(gw);
    try {
      const rows = await gw.readTab(ASIG_ID!, ASIG_TAB!);
      const located = locateTabHeader(rows);
      expect(located.headerRowIndex).not.toBeNull();
      const mapping = autoMapColumns(located.header, ASIGNACION_LOTES_FIELD_ALIASES);
      const obsCol = mapping.observaciones;
      expect(obsCol, "la copia necesita una columna OBSERVACIONES").not.toBeNull();
      const dataIdx = located.dataRows.findIndex((r) => rowToObject(r, mapping).lote?.trim());
      const mapped = rowToObject(located.dataRows[dataIdx]!, mapping);
      const input = buildAsignacionLoteFromMappedRow(mapped as never, "it");
      const src = await getAsignacionLoteSourcesService().createSpreadsheetLevelSourceForSync({ name: "IT", period: "IT", spreadsheetId: ASIG_ID!, createdBy: "it" });
      const { record } = await getAsignacionLotesService().upsertFromSource(src.id, { email: "it", displayName: "IT" }, input, ASIG_TAB!);
      const a1 = `${columnLetter(obsCol as number)}${located.headerRowIndex! + dataIdx + 2}`;
      const original = await gw.readCell(ASIG_ID!, ASIG_TAB!, a1);
      const mark = `IT-${Date.now()}`;
      const res = await patchCellsWithWriteback(produccion, [{ id: record.id, field: "observaciones", value: mark, expectedVersion: record.updatedAt }]);
      expect(res.ok, JSON.stringify(res.results)).toBe(true);
      expect(await gw.readCell(ASIG_ID!, ASIG_TAB!, a1)).toBe(mark);
      // Cambio externo → conflicto, nada se pisa.
      await gw.writeCell(ASIG_ID!, ASIG_TAB!, a1, "EDITADO-POR-OTRO");
      const fresh = (await getAsignacionLotesService().get(produccion, record.id))!;
      const conflict = await patchCellsWithWriteback(produccion, [{ id: record.id, field: "observaciones", value: "NO-DEBE-ESCRIBIRSE", expectedVersion: fresh.updatedAt }]);
      expect(conflict.results[0]).toMatchObject({ status: "failed", code: "GOOGLE_CONFLICT" });
      expect(await gw.readCell(ASIG_ID!, ASIG_TAB!, a1)).toBe("EDITADO-POR-OTRO");
      await gw.writeCell(ASIG_ID!, ASIG_TAB!, a1, original); // restaura la copia
    } finally {
      setWritebackGatewayForTests(null);
    }
  }, 180_000);
});
