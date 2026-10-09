/**
 * 0043 — Ediciones de GENUS sobre lotes sincronizados desde Google Sheets: el sync NO las pisa, detecta conflictos,
 * no duplica ni archiva registros cuya identidad corrigió GENUS, y las decisiones (mantener / usar planilla / volver)
 * quedan auditadas. En memoria (sin base); la integración con Postgres está en src/integration/.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  getAsignacionCellAuditMemory,
  getAsignacionLotesService,
  resetAsignacionLotesMemoryForTests,
} from "./asignacion-lotes-service";

const produccion = { email: "p@laboratoriogenus.com.ar", sector: "PRODUCCION" as const, displayName: "Producción" };
const calidad = { email: "c@laboratoriogenus.com.ar", sector: "CALIDAD" as const, displayName: "Calidad" };
const SYNC = { email: "sync@genus", displayName: "Sync" };
const row = (over: Record<string, unknown> = {}) => ({ lote: "G26042", fecha: "2026-08-03", producto: "CREMA FACIAL", codigo: "CF-1", marca: "KORIDERM", cantidades: 500, vto: "2028-08-01", updatedBy: "Sync", ...over });
const svc = () => getAsignacionLotesService();
const find = async (id: string) => (await svc().list(produccion, { includeArchived: true })).find((r) => r.id === id)!;

describe("lotes sincronizados editables en GENUS (0043)", () => {
  beforeEach(() => {
    resetAsignacionLotesMemoryForTests();
    getAsignacionCellAuditMemory().length = 0;
  });

  it("el próximo sync NO pisa el campo editado en GENUS y sí actualiza los demás", async () => {
    const { record } = await svc().upsertFromSource("src-1", SYNC, row(), "AGOSTO");
    await svc().patchCells(produccion, [{ id: record.id, field: "cantidades", value: "620", expectedVersion: record.updatedAt, reason: "Recuento" }]);
    // la planilla no cambió cantidades, pero sí la marca
    await svc().upsertFromSource("src-1", SYNC, row({ marca: "KORIDERM SA" }), "AGOSTO");
    const after = await find(record.id);
    expect(after.cantidades).toBe(620);
    expect(after.marca).toBe("KORIDERM SA");
    expect(after.localEdits?.cantidades).toMatchObject({ status: "ACTIVE", sheetValue: "500", localValue: "620" });
    expect(getAsignacionCellAuditMemory().find((a) => a.field === "cantidades")).toMatchObject({ oldValue: "500", newValue: "620" });
  });

  it("si la planilla cambia el MISMO campo después: CONFLICTO (no elige en silencio), y se resuelve con auditoría", async () => {
    const { record } = await svc().upsertFromSource("src-1", SYNC, row(), "AGOSTO");
    await svc().patchCells(produccion, [{ id: record.id, field: "vto", value: "2028-09-01", expectedVersion: record.updatedAt }]);
    await svc().upsertFromSource("src-1", SYNC, row({ vto: "2028-10-01" }), "AGOSTO");
    let r = await find(record.id);
    expect(r.vto).toBe("2028-09-01");
    expect(r.localEdits?.vto).toMatchObject({ status: "CONFLICT", sheetValue: "2028-08-01", localValue: "2028-09-01", conflictSheetValue: "2028-10-01" });
    // mantener GENUS: el valor nuevo de la planilla pasa a ser la base (un sync igual ya no es conflicto)
    await svc().resolveLocalEdit(produccion, { editId: r.localEdits!.vto!.id, action: "KEEP_GENUS", expectedVersion: r.updatedAt });
    await svc().upsertFromSource("src-1", SYNC, row({ vto: "2028-10-01" }), "AGOSTO");
    r = await find(record.id);
    expect(r.vto).toBe("2028-09-01");
    expect(r.localEdits?.vto).toMatchObject({ status: "ACTIVE", sheetValue: "2028-10-01" });
    // otro cambio de la planilla → conflicto de nuevo → usar la planilla
    await svc().upsertFromSource("src-1", SYNC, row({ vto: "2028-12-01" }), "AGOSTO");
    r = await find(record.id);
    await svc().resolveLocalEdit(produccion, { editId: r.localEdits!.vto!.id, action: "USE_SHEET", expectedVersion: r.updatedAt });
    r = await find(record.id);
    expect(r.vto).toBe("2028-12-01");
    expect(r.localEdits?.vto).toBeUndefined();
    // y el campo vuelve a seguir a la planilla
    await svc().upsertFromSource("src-1", SYNC, row({ vto: "2029-01-01" }), "AGOSTO");
    expect((await find(record.id)).vto).toBe("2029-01-01");
    expect(getAsignacionCellAuditMemory().some((a) => a.field === "vto" && a.batchId.startsWith("resolve-"))).toBe(true);
  });

  it("corregir lote/código/producto en GENUS no duplica ni archiva en el próximo sync (identidad de origen)", async () => {
    const { record } = await svc().upsertFromSource("src-1", SYNC, row(), "AGOSTO");
    await svc().patchCells(produccion, [{ id: record.id, field: "lote", value: "G26042-B", expectedVersion: record.updatedAt }]);
    const res = await svc().upsertFromSource("src-1", SYNC, row(), "AGOSTO");
    expect(res.record.id).toBe(record.id);
    expect(res.created).toBe(false);
    const all = await svc().list(produccion);
    expect(all).toHaveLength(1);
    expect(all[0]!.lote).toBe("G26042-B");
  });

  it("volver al valor de la planilla cierra la edición; «volver a la planilla» también", async () => {
    const { record } = await svc().upsertFromSource("src-1", SYNC, row(), "AGOSTO");
    const v1 = (await svc().patchCells(produccion, [{ id: record.id, field: "cantidades", value: "600", expectedVersion: record.updatedAt }])).items[0]!;
    await svc().patchCells(produccion, [{ id: record.id, field: "cantidades", value: "500", expectedVersion: v1.updatedAt }]);
    expect((await find(record.id)).localEdits).toBeUndefined();
    const r2 = await find(record.id);
    await svc().patchCells(calidad, [{ id: record.id, field: "marca", value: "OTRA", expectedVersion: r2.updatedAt }]);
    const r3 = await find(record.id);
    await svc().resolveLocalEdit(calidad, { editId: r3.localEdits!.marca!.id, action: "REVERT_TO_SHEET", expectedVersion: r3.updatedAt });
    const r4 = await find(record.id);
    expect(r4.marca).toBe("KORIDERM");
    expect(r4.localEdits).toBeUndefined();
  });

  it("fila que desaparece de la planilla: si tiene ediciones de GENUS NO se archiva sola; se decide conservar o archivar", async () => {
    const { record } = await svc().upsertFromSource("src-1", SYNC, row(), "AGOSTO");
    await svc().patchCells(produccion, [{ id: record.id, field: "observaciones", value: "Revisado", expectedVersion: record.updatedAt }]);
    expect(await svc().archiveRemovedFromSource(record.id, "Planilla 2026")).toBe("kept_local_edits");
    let r = await find(record.id);
    expect(r.archived).toBeFalsy();
    expect(r.localEdits?.__row__).toMatchObject({ status: "CONFLICT" });
    await svc().resolveLocalEdit(produccion, { editId: r.localEdits!.__row__!.id, action: "KEEP_GENUS", expectedVersion: r.updatedAt });
    r = await find(record.id);
    expect(r.sourceId).toBeNull();
    expect(r.localEdits).toBeUndefined();
    // y una fila SIN ediciones se archiva como siempre
    const { record: other } = await svc().upsertFromSource("src-1", SYNC, row({ lote: "G2", codigo: "X" }), "AGOSTO");
    expect(await svc().archiveRemovedFromSource(other.id, "Planilla 2026")).toBe("archived");
  });

  it("permisos y versión: sector sin permiso no edita; versión vieja no pisa; reemplazo total bloqueado con ediciones abiertas", async () => {
    const { record } = await svc().upsertFromSource("src-1", SYNC, row(), "AGOSTO");
    await expect(svc().patchCells({ ...produccion, sector: "CODIFICADO" } as never, [{ id: record.id, field: "cantidades", value: "1", expectedVersion: record.updatedAt }])).rejects.toThrow();
    await svc().patchCells(produccion, [{ id: record.id, field: "cantidades", value: "700", expectedVersion: record.updatedAt }]);
    await expect(svc().patchCells(calidad, [{ id: record.id, field: "cantidades", value: "800", expectedVersion: record.updatedAt }])).rejects.toThrow();
    expect((await find(record.id)).cantidades).toBe(700);
    await expect(svc().replaceAll(produccion, [])).rejects.toThrow(/ediciones de GENUS/);
  });

  it("archivar en GENUS un registro de Google: el sync no lo revive; restaurar lo vuelve a sincronizar", async () => {
    const { record } = await svc().upsertFromSource("src-1", SYNC, row(), "AGOSTO");
    await svc().delete(produccion, record.id, "Lote cargado por error en la planilla");
    await svc().upsertFromSource("src-1", SYNC, row(), "AGOSTO");
    expect((await find(record.id)).archived).toBe(true);
    await svc().restore(produccion, record.id);
    await svc().upsertFromSource("src-1", SYNC, row({ marca: "NUEVA" }), "AGOSTO");
    const r = await find(record.id);
    expect(r.archived).toBe(false);
    expect(r.marca).toBe("NUEVA");
  });
});
