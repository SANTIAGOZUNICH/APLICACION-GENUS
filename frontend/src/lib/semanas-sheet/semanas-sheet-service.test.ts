import { existsSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { XlsxFixtureGateway } from "./xlsx-grid";
import {
  getSheetCellEditsMemory,
  loadSemanasView,
  setSemanasGatewayForTests,
  writeSemanasCell,
} from "./semanas-sheet-service";

const FIXTURE = path.resolve(__dirname, "../../../../SEMANAS 2026.xlsx");
const produccion = { email: "p@laboratoriogenus.com.ar", sector: "PRODUCCION" as const, displayName: "Producción" };
const TODAY = "2026-02-16"; // lunes de la 1ª semana del libro
const ID = "fixture-semanas-2026";

describe.skipIf(!existsSync(FIXTURE))("Producción → Semanas: edición por celda (copia local, nunca Google)", () => {
  let gw: XlsxFixtureGateway;
  beforeEach(() => {
    vi.stubEnv("SEMANAS_SHEET_ID", ID);
    vi.stubEnv("SEMANAS_WRITEBACK", "1");
    vi.stubEnv("SEMANAS_WRITEBACK_SPREADSHEET_IDS", ID);
    gw = new XlsxFixtureGateway(FIXTURE);
    setSemanasGatewayForTests(gw);
    getSheetCellEditsMemory().length = 0;
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    setSemanasGatewayForTests(null);
  });

  it("lee el calendario fiel: ELABORACION con 12 semanas, writable según allowlist", async () => {
    const v = await loadSemanasView("ELABORACION", TODAY);
    expect(v.weeks).toHaveLength(12);
    expect(v.writable).toBe(true);
    vi.stubEnv("SEMANAS_WRITEBACK", "0");
    expect((await loadSemanasView("ELABORACION", TODAY)).writable).toBe(false);
  });

  it("edita UNA celda del calendario (F6) y no toca ninguna otra", async () => {
    const before = await gw.readTab(ID, "ELABORACION");
    const r = await writeSemanasCell(produccion, { tabKey: "ELABORACION", a1: "F6", expectedValue: "SERUM AH+NIA", value: "SERUM AH+NIA X2" }, TODAY);
    expect(r.ok).toBe(true);
    expect(gw.writes).toEqual([{ tab: "ELABORACION", a1: "F6", value: "SERUM AH+NIA X2" }]);
    const after = await gw.readTab(ID, "ELABORACION");
    let diffs = 0;
    after.forEach((row, i) => row.forEach((c, j) => { if (c !== (before[i]?.[j] ?? "")) diffs += 1; }));
    expect(diffs).toBe(1);
    expect(getSheetCellEditsMemory()[0]).toMatchObject({ a1: "F6", oldValue: "SERUM AH+NIA", newValue: "SERUM AH+NIA X2", status: "confirmed", actorEmail: produccion.email });
  });

  it("conflicto: si la celda cambió en Google, no escribe", async () => {
    await gw.writeCell(ID, "ELABORACION", "F6", "EDITADO EN GOOGLE");
    gw.writes.length = 0;
    const r = await writeSemanasCell(produccion, { tabKey: "ELABORACION", a1: "F6", expectedValue: "SERUM AH+NIA", value: "X" }, TODAY);
    expect(r).toMatchObject({ ok: false, code: "CONFLICT" });
    expect(gw.writes).toHaveLength(0);
  });

  it("protegidas: encabezado de día, celda combinada no ancla, fecha fuera del calendario", async () => {
    for (const a1 of ["F2", "B1", "F500000"]) {
      const r = await writeSemanasCell(produccion, { tabKey: "ELABORACION", a1, expectedValue: "", value: "X" }, TODAY);
      expect(r.ok).toBe(false);
    }
    const covered = await writeSemanasCell(produccion, { tabKey: "ACONDICIONAMIENTO", a1: "F4", expectedValue: "", value: "X" }, TODAY);
    expect(covered).toMatchObject({ ok: false, code: "PROTECTED" }); // F4 queda cubierta por la banda D4:I4
    expect(gw.writes).toHaveLength(0);
  });

  it("semana pasada protegida; la actual y futuras editables", async () => {
    const r = await writeSemanasCell(produccion, { tabKey: "ELABORACION", a1: "F6", expectedValue: "SERUM AH+NIA", value: "X" }, "2026-03-02");
    expect(r).toMatchObject({ ok: false, code: "PROTECTED" });
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
    const again = await writeSemanasCell(produccion, e, TODAY);
    expect(again).toMatchObject({ ok: true, idempotent: true });
    expect(gw.writes).toHaveLength(1);
  });

  it("Google rechaza → error, sin éxito, queda en la bitácora como failed", async () => {
    vi.spyOn(gw, "writeCell").mockRejectedValueOnce(new Error("403 sin permiso"));
    const r = await writeSemanasCell(produccion, { tabKey: "ELABORACION", a1: "F6", expectedValue: "SERUM AH+NIA", value: "X" }, TODAY);
    expect(r).toMatchObject({ ok: false, code: "GOOGLE_ERROR" });
    expect(getSheetCellEditsMemory()[0]!.status).toBe("failed");
  });

  it("ENTREGAS: valida fecha/cantidad; entrega histórica protegida; futura editable", async () => {
    const v = await loadSemanasView("ENTREGAS", "2026-02-24");
    const future = v.table!.rows.find((r) => r.date && r.date >= "2026-02-24" && r.cells.every((c) => !c.protection))!;
    const qtyCell = future.cells[3]!;
    const bad = await writeSemanasCell(produccion, { tabKey: "ENTREGAS", a1: qtyCell.a1, expectedValue: qtyCell.value, value: "abc" }, "2026-02-24");
    expect(bad).toMatchObject({ ok: false, code: "INVALID" });
    const ok = await writeSemanasCell(produccion, { tabKey: "ENTREGAS", a1: qtyCell.a1, expectedValue: qtyCell.value, value: "1250" }, "2026-02-24");
    expect(ok.ok).toBe(true);
    const hist = v.table!.rows.find((r) => r.date === "2026-02-19")!;
    const h = await writeSemanasCell(produccion, { tabKey: "ENTREGAS", a1: hist.cells[3]!.a1, expectedValue: hist.cells[3]!.value, value: "1" }, "2026-02-24");
    expect(h).toMatchObject({ ok: false, code: "PROTECTED" });
  });

  it("C/DIA: editable dentro de la ventana; DB no es editable (no existe como pestaña editable)", async () => {
    const v = await loadSemanasView("CDIA", "2026-02-19");
    const row = v.table!.rows.find((r) => r.role === "data" && r.date === "2026-02-19" && r.cells.every((c) => !c.protection))!;
    const cant = row.cells[2]!;
    const r = await writeSemanasCell(produccion, { tabKey: "CDIA", a1: cant.a1, expectedValue: cant.value, value: "321" }, "2026-02-19");
    expect(r.ok).toBe(true);
    // @ts-expect-error DB no es una pestaña editable
    await expect(writeSemanasCell(produccion, { tabKey: "DB", a1: "X3", expectedValue: "", value: "1" }, TODAY)).rejects.toThrow();
  });
});
