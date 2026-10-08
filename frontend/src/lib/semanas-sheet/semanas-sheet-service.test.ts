import { existsSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { XlsxFixtureGateway } from "./xlsx-grid";
import {
  getSheetCellEditsMemory,
  isSemanasWritable,
  loadSemanasView,
  setSemanasGatewayForTests,
  writeSemanasCell,
} from "./semanas-sheet-service";
import { buildOperationalLocks, setOperationalLocksForTests, UNKNOWN_LOCKS } from "./operational-locks";

const FIXTURE = path.resolve(__dirname, "../../../../SEMANAS 2026.xlsx");
const produccion = { email: "p@laboratoriogenus.com.ar", sector: "PRODUCCION" as const, displayName: "Producción" };
const otro = { email: "q@laboratoriogenus.com.ar", sector: "PRODUCCION" as const, displayName: "Producción 2" };
const TODAY = "2026-02-16";
const ID = "fixture-semanas-2026";
// La SEMANAS 2026 "indexada en Drive" (la original) para estas pruebas.
vi.mock("@/lib/adapters/drive/operations-document-repository", () => ({
  operationsDocumentRepository: { tryGetCriticalSheetRef: async () => ({ fileId: "semanas-original-indexada" }) },
}));
const open = () => buildOperationalLocks({ deliveries: [], remitos: [], closedWorkItems: [] });

describe.skipIf(!existsSync(FIXTURE))("Producción → Semanas: edición por celda (copia local, nunca Google)", () => {
  let gw: XlsxFixtureGateway;
  beforeEach(() => {
    vi.stubEnv("SEMANAS_SHEET_ID", ID);
    vi.stubEnv("SEMANAS_WRITEBACK", "1");
    vi.stubEnv("SEMANAS_WRITEBACK_SPREADSHEET_IDS", ID);
    gw = new XlsxFixtureGateway(FIXTURE);
    setSemanasGatewayForTests(gw);
    setOperationalLocksForTests(open());
    getSheetCellEditsMemory().length = 0;
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    setSemanasGatewayForTests(null);
    setOperationalLocksForTests(null);
  });

  it("lee el calendario fiel: ELABORACION con 12 semanas, writable según allowlist", async () => {
    const v = await loadSemanasView("ELABORACION", TODAY);
    expect(v.weeks).toHaveLength(12);
    expect(v.writable).toBe(true);
    vi.stubEnv("SEMANAS_WRITEBACK", "0");
    expect((await loadSemanasView("ELABORACION", TODAY)).writable).toBe(false);
  });

  it("NUNCA se escribe en Production (VERCEL_ENV=production) aunque flags y allowlist estén activos", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    expect(isSemanasWritable(ID)).toBe(false);
    const r = await writeSemanasCell(produccion, { tabKey: "ELABORACION", a1: "F6", expectedValue: "SERUM AH+NIA", value: "X" }, TODAY);
    expect(r).toMatchObject({ ok: false, code: "NOT_WRITABLE" });
    expect(gw.writes).toHaveLength(0);
  });

  it("edita UNA celda del calendario (F6): ninguna otra celda, ninguna combinada, ninguna fórmula cambia", async () => {
    const before = await gw.readTab(ID, "ELABORACION");
    const mergesBefore = JSON.stringify(await gw.readMerges(ID, "ELABORACION"));
    const formulasBefore = JSON.stringify([...(await gw.readFormulaCells(ID, "ELABORACION"))]);
    const r = await writeSemanasCell(produccion, { tabKey: "ELABORACION", a1: "F6", expectedValue: "SERUM AH+NIA", value: "SERUM AH+NIA X2" }, TODAY);
    expect(r.ok).toBe(true);
    expect(gw.writes).toEqual([{ tab: "ELABORACION", a1: "F6", value: "SERUM AH+NIA X2" }]);
    const after = await gw.readTab(ID, "ELABORACION");
    let diffs = 0;
    after.forEach((row, i) => row.forEach((c, j) => { if (c !== (before[i]?.[j] ?? "")) diffs += 1; }));
    expect(diffs).toBe(1);
    // Layout intacto: combinadas y fórmulas idénticas, y el calendario se re-parsea igual (mismas semanas/filas/anclas).
    expect(JSON.stringify(await gw.readMerges(ID, "ELABORACION"))).toBe(mergesBefore);
    expect(JSON.stringify([...(await gw.readFormulaCells(ID, "ELABORACION"))])).toBe(formulasBefore);
    const v = await loadSemanasView("ELABORACION", TODAY);
    expect(v.weeks).toHaveLength(12);
    expect(getSheetCellEditsMemory()[0]).toMatchObject({ a1: "F6", oldValue: "SERUM AH+NIA", newValue: "SERUM AH+NIA X2", status: "confirmed", actorEmail: produccion.email });
  });

  it("copiar/pegar un rango completo de varias celdas toca exactamente esas celdas y ninguna vecina", async () => {
    const before = await gw.readTab(ID, "ELABORACION");
    const cells = [["H9", "PROD A"], ["H10", "PROD B"], ["J9", "PROD C"], ["J10", "PROD D"]];
    for (const [a1, v] of cells) {
      const pos = a1!.match(/^([A-Z]+)(\d+)$/)!;
      const col = pos[1]!.charCodeAt(0) - 65;
      const cur = before[Number(pos[2]) - 1]?.[col] ?? "";
      expect((await writeSemanasCell(produccion, { tabKey: "ELABORACION", a1: a1!, expectedValue: cur, value: v! }, TODAY)).ok).toBe(true);
    }
    expect(gw.writes.map((w) => w.a1).sort()).toEqual(["H10", "H9", "J10", "J9"]);
    const after = await gw.readTab(ID, "ELABORACION");
    let diffs = 0;
    after.forEach((row, i) => row.forEach((c, j) => { if (c !== (before[i]?.[j] ?? "")) diffs += 1; }));
    expect(diffs).toBe(4);
  });

  it("conflicto: si la celda cambió en Google, no escribe", async () => {
    await gw.writeCell(ID, "ELABORACION", "F6", "EDITADO EN GOOGLE");
    gw.writes.length = 0;
    const r = await writeSemanasCell(produccion, { tabKey: "ELABORACION", a1: "F6", expectedValue: "SERUM AH+NIA", value: "X" }, TODAY);
    expect(r).toMatchObject({ ok: false, code: "CONFLICT" });
    expect(gw.writes).toHaveLength(0);
  });

  it("DOS USUARIOS editan la MISMA celda a la vez: solo uno escribe, el otro recibe BUSY/CONFLICT, valor final consistente", async () => {
    // Fuerza intercalado: cada lectura/escritura cede el turno.
    const tick = () => new Promise<void>((r) => setTimeout(r, 5));
    const rc = gw.readCell.bind(gw);
    const wc = gw.writeCell.bind(gw);
    vi.spyOn(gw, "readCell").mockImplementation(async (...a) => { await tick(); return rc(...a); });
    vi.spyOn(gw, "writeCell").mockImplementation(async (...a) => { await tick(); return wc(...a); });
    const e = (value: string) => ({ tabKey: "ELABORACION" as const, a1: "F6", expectedValue: "SERUM AH+NIA", value });
    const [r1, r2] = await Promise.all([writeSemanasCell(produccion, e("VERSION A"), TODAY), writeSemanasCell(otro, e("VERSION B"), TODAY)]);
    const oks = [r1, r2].filter((r) => r.ok);
    const bad = [r1, r2].filter((r) => !r.ok);
    expect(oks).toHaveLength(1);
    expect(bad).toHaveLength(1);
    expect((bad[0] as { code: string }).code).toMatch(/BUSY|CONFLICT/);
    expect(gw.writes).toHaveLength(1);
    const winner = r1.ok ? "VERSION A" : "VERSION B";
    expect(await gw.readCell(ID, "ELABORACION", "F6")).toBe(winner);
    // Segundo intento tardío (ya con el valor viejo) tampoco pisa: conflicto.
    const late = await writeSemanasCell(otro, e("VERSION C"), TODAY);
    expect(late).toMatchObject({ ok: false, code: "CONFLICT" });
  });

  it("protegidas: encabezado de día, celda combinada no ancla, fuera del calendario", async () => {
    for (const a1 of ["F2", "B1", "F500000"]) {
      expect((await writeSemanasCell(produccion, { tabKey: "ELABORACION", a1, expectedValue: "", value: "X" }, TODAY)).ok).toBe(false);
    }
    const covered = await writeSemanasCell(produccion, { tabKey: "ACONDICIONAMIENTO", a1: "F4", expectedValue: "", value: "X" }, TODAY);
    expect(covered).toMatchObject({ ok: false, code: "PROTECTED" });
    expect(gw.writes).toHaveLength(0);
  });

  it("semanas anteriores SE PUEDEN editar (sin bloqueo por antigüedad) pero exigen motivo y quedan auditadas", async () => {
    const today = "2026-03-02"; // la semana del 16/02 ya es pasada
    const noReason = await writeSemanasCell(produccion, { tabKey: "ELABORACION", a1: "F6", expectedValue: "SERUM AH+NIA", value: "X" }, today);
    expect(noReason).toMatchObject({ ok: false, code: "REASON_REQUIRED" });
    const short = await writeSemanasCell(produccion, { tabKey: "ELABORACION", a1: "F6", expectedValue: "SERUM AH+NIA", value: "X", reason: "typo" }, today);
    expect(short).toMatchObject({ ok: false, code: "REASON_REQUIRED" });
    const ok = await writeSemanasCell(produccion, { tabKey: "ELABORACION", a1: "F6", expectedValue: "SERUM AH+NIA", value: "SERUM AH+NIA 60KG", reason: "Corrección de cantidad real elaborada" }, today);
    expect(ok.ok).toBe(true);
    expect(getSheetCellEditsMemory()[0]).toMatchObject({ reason: "Corrección de cantidad real elaborada", status: "confirmed" });
  });

  it("producción con cierre de envasado en GENUS: la celda de producto del calendario queda protegida", async () => {
    setOperationalLocksForTests(buildOperationalLocks({ deliveries: [], remitos: [], closedWorkItems: [{ product: "NIZA", client: null, dates: ["2026-02-19"] }] }));
    const r = await writeSemanasCell(produccion, { tabKey: "ELABORACION", a1: "H5", expectedValue: "NIZA", value: "OTRO" }, TODAY);
    expect(r).toMatchObject({ ok: false, code: "PROTECTED" });
    expect(gw.writes).toHaveLength(0);
  });

  it("no acepta fórmulas ni texto excesivo; solo Producción edita", async () => {
    expect(await writeSemanasCell(produccion, { tabKey: "ELABORACION", a1: "F6", expectedValue: "SERUM AH+NIA", value: "=1+1" }, TODAY)).toMatchObject({ ok: false, code: "INVALID" });
    await expect(
      writeSemanasCell({ ...produccion, sector: "CALIDAD" }, { tabKey: "ELABORACION", a1: "F6", expectedValue: "SERUM AH+NIA", value: "X" }, TODAY)
    ).rejects.toThrow();
    expect(gw.writes).toHaveLength(0);
  });

  it("sin habilitación/allowlist no se escribe (planilla productiva protegida por defecto)", async () => {
    vi.stubEnv("SEMANAS_WRITEBACK_SPREADSHEET_IDS", "OTRA");
    const r = await writeSemanasCell(produccion, { tabKey: "ELABORACION", a1: "F6", expectedValue: "SERUM AH+NIA", value: "X" }, TODAY);
    expect(r).toMatchObject({ ok: false, code: "NOT_WRITABLE" });
    expect(gw.writes).toHaveLength(0);
  });

  it("idempotente: repetir el mismo cambio no escribe dos veces", async () => {
    const e = { tabKey: "ELABORACION" as const, a1: "F6", expectedValue: "SERUM AH+NIA", value: "NUEVO" };
    expect((await writeSemanasCell(produccion, e, TODAY)).ok).toBe(true);
    expect(await writeSemanasCell(produccion, e, TODAY)).toMatchObject({ ok: true, idempotent: true });
    expect(gw.writes).toHaveLength(1);
  });

  it("Google rechaza → error, sin éxito, queda en la bitácora como failed y la celda se libera", async () => {
    vi.spyOn(gw, "writeCell").mockRejectedValueOnce(new Error("403 sin permiso"));
    const e = { tabKey: "ELABORACION" as const, a1: "F6", expectedValue: "SERUM AH+NIA", value: "X" };
    expect(await writeSemanasCell(produccion, e, TODAY)).toMatchObject({ ok: false, code: "GOOGLE_ERROR" });
    expect(getSheetCellEditsMemory()[0]!.status).toBe("failed");
    expect((await writeSemanasCell(produccion, e, TODAY)).ok).toBe(true); // reintento posible
  });

  it("ENTREGAS: se puede editar una entrega histórica NO confirmada; una confirmada/remitada en GENUS queda bloqueada", async () => {
    setOperationalLocksForTests(buildOperationalLocks({ deliveries: [{ client: "TSU", product: "SERUMS X3", date: "2026-02-19" }], remitos: [{ client: "OCEAN SKIN", date: "2026-02-20" }], closedWorkItems: [] }));
    const today = "2026-04-01";
    const v = await loadSemanasView("ENTREGAS", today);
    const tsu = v.table!.rows.find((r) => r.date === "2026-02-19" && r.cells[1]!.value === "TSU")!;
    expect(tsu.cells.every((c) => c.protection)).toBe(true);
    const ocean = v.table!.rows.find((r) => r.date === "2026-02-20" && r.cells[1]!.value === "OCEAN SKIN")!;
    expect(ocean.cells[2]!.protection).toMatch(/Remito/);
    const free = v.table!.rows.find((r) => r.date === "2026-02-23" && r.cells.every((c) => !c.protection))!;
    const qty = free.cells[3]!;
    expect(await writeSemanasCell(produccion, { tabKey: "ENTREGAS", a1: qty.a1, expectedValue: qty.value, value: "abc", reason: "corrección" }, today)).toMatchObject({ ok: false, code: "INVALID" });
    expect(await writeSemanasCell(produccion, { tabKey: "ENTREGAS", a1: qty.a1, expectedValue: qty.value, value: "1250" }, today)).toMatchObject({ ok: false, code: "REASON_REQUIRED" });
    expect((await writeSemanasCell(produccion, { tabKey: "ENTREGAS", a1: qty.a1, expectedValue: qty.value, value: "1250", reason: "Cantidad real despachada" }, today)).ok).toBe(true);
    expect(await writeSemanasCell(produccion, { tabKey: "ENTREGAS", a1: tsu.cells[3]!.a1, expectedValue: tsu.cells[3]!.value, value: "1", reason: "intento sobre entrega confirmada" }, today)).toMatchObject({ ok: false, code: "PROTECTED" });
  });

  it("ENTREGAS y C/DIA: si el estado operativo no es verificable se bloquean (fail-closed)", async () => {
    setOperationalLocksForTests(UNKNOWN_LOCKS);
    for (const tab of ["ENTREGAS", "CDIA"] as const) {
      const v = await loadSemanasView(tab, "2026-04-01");
      expect(v.locksKnown).toBe(false);
      expect(v.table!.rows.filter((r) => r.role === "data").every((r) => r.cells.every((c) => c.protection))).toBe(true);
    }
  });

  it("C/DIA: editar CANTIDAD/RESPONSABLE históricos exige motivo y queda marcado como que afecta indicadores (DB)", async () => {
    const today = "2026-03-10";
    const v = await loadSemanasView("CDIA", today);
    const row = v.table!.rows.find((r) => r.role === "data" && r.date === "2026-02-19" && r.cells.every((c) => !c.protection))!;
    const cant = row.cells[2]!;
    const sinMotivo = await writeSemanasCell(produccion, { tabKey: "CDIA", a1: cant.a1, expectedValue: cant.value, value: "321" }, today);
    expect(sinMotivo).toMatchObject({ ok: false, code: "REASON_REQUIRED" });
    expect(sinMotivo.ok === false && sinMotivo.message).toMatch(/indicadores/);
    const ok = await writeSemanasCell(produccion, { tabKey: "CDIA", a1: cant.a1, expectedValue: cant.value, value: "321", reason: "Recuento real de unidades" }, today);
    expect(ok.ok).toBe(true);
    expect(getSheetCellEditsMemory().at(-1)).toMatchObject({ affectsIndicators: true, reason: "Recuento real de unidades", oldValue: cant.value });
    // Un día cerrado en GENUS (envasado cerrado) NO se edita aunque se dé motivo.
    setOperationalLocksForTests(buildOperationalLocks({ deliveries: [], remitos: [], closedWorkItems: [{ product: row.cells[1]!.value, client: null, dates: ["2026-02-19"] }] }));
    const closed = await writeSemanasCell(produccion, { tabKey: "CDIA", a1: cant.a1, expectedValue: "321", value: "5", reason: "intento sobre día cerrado" }, today);
    expect(closed).toMatchObject({ ok: false, code: "PROTECTED" });
    // @ts-expect-error DB no es una pestaña editable
    await expect(writeSemanasCell(produccion, { tabKey: "DB", a1: "X3", expectedValue: "", value: "1" }, TODAY)).rejects.toThrow();
  });

  it("nunca escribe en la SEMANAS 2026 original indexada, aunque esté configurada y en la allowlist", async () => {
    vi.stubEnv("SEMANAS_SHEET_ID", "semanas-original-indexada");
    vi.stubEnv("SEMANAS_WRITEBACK_SPREADSHEET_IDS", "semanas-original-indexada");
    const r = await writeSemanasCell(produccion, { tabKey: "ELABORACION", a1: "F6", expectedValue: "SERUM AH+NIA", value: "X" }, TODAY);
    expect(r).toMatchObject({ ok: false, code: "NOT_WRITABLE" });
    expect(gw.writes).toHaveLength(0);
  });
});
