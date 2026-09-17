import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetAsignacionLotesMemoryForTests, getAsignacionLotesService } from "./asignacion-lotes-service";
import {
  resetAsignacionLoteSourcesMemoryForTests,
  getAsignacionLoteSourcesService,
} from "./asignacion-lote-sources-service";

const readTabMock = vi.fn();
const listTabsMock = vi.fn();

vi.mock("@/lib/adapters/sheets/sheets-reader", () => ({
  sheetsReader: {
    readTab: (...args: unknown[]) => readTabMock(...args),
    listTabs: (...args: unknown[]) => listTabsMock(...args),
  },
}));

const admin = { email: "produccion@laboratoriogenus.com.ar", sector: "PRODUCCION" as const, displayName: "Producción" };

async function createSource(overrides: Partial<{ sheetTab: string }> = {}) {
  const svc = getAsignacionLoteSourcesService();
  return svc.create(admin, {
    name: "Asignación de Lotes 2026",
    period: "2026",
    spreadsheetUrlOrId: "https://docs.google.com/spreadsheets/d/abc123XYZ_-987/edit",
    sheetTab: overrides.sheetTab ?? "LOTES",
  });
}

describe("syncSource — sincronización Google Sheets → Asignación de Lotes", () => {
  beforeEach(() => {
    resetAsignacionLotesMemoryForTests();
    resetAsignacionLoteSourcesMemoryForTests();
    readTabMock.mockReset();
    listTabsMock.mockReset();
  });

  it("Test 6: lote se importa; Test 7: VTO se importa; Test 8: cantidad se importa", async () => {
    const { syncSource } = await import("./asignacion-lotes-sync-service");
    const source = await createSource();
    readTabMock.mockResolvedValue([
      ["LOTE", "FECHA", "PRODUCTO", "CÓDIGO", "MARCA", "CANTIDAD", "VTO"],
      ["G26043", "10/09/2026", "SERUM VITAMINA C ROSEHIP", "VITAMINA C", "ROSEHIP-ECODERM", "100", "10/2028"],
    ]);

    const summary = await syncSource(source, "test", "manual");
    expect(summary.status).toBe("ok");
    expect(summary.createdCount).toBe(1);
    expect(summary.rowsRead).toBe(1);

    const lotes = await getAsignacionLotesService().listBySource(source.id);
    expect(lotes).toHaveLength(1);
    expect(lotes[0]!.lote).toBe("G26043");
    expect(lotes[0]!.vto).toBe("2028-10-31");
    expect(lotes[0]!.cantidades).toBe(100);
  });

  it("Test 9: campos secundarios (muestras/cj muestras/fecha análisis) se importan", async () => {
    const { syncSource } = await import("./asignacion-lotes-sync-service");
    const source = await createSource();
    readTabMock.mockResolvedValue([
      ["LOTE", "FECHA", "PRODUCTO", "CÓDIGO", "MARCA", "CANTIDAD", "VTO", "MUESTRAS", "CJ MUESTRAS", "FECHA ANALISIS"],
      ["G26043", "10/09/2026", "SERUM", "", "NIZA", "100", "10/2028", "Sí", "2", "01/09/2026"],
    ]);
    await syncSource(source, "test", "manual");
    const [row] = await getAsignacionLotesService().listBySource(source.id);
    expect(row!.muestras).toBe("Sí");
    expect(row!.cjMuestra).toBe("2");
    expect(row!.fechaAnalisis).toBe("2026-09-01");
  });

  it("Test 10: sync repetido no duplica; Test 13: ordenar filas no duplica", async () => {
    const { syncSource } = await import("./asignacion-lotes-sync-service");
    const source = await createSource();
    const rows = [
      ["LOTE", "FECHA", "PRODUCTO", "CÓDIGO", "MARCA", "CANTIDAD", "VTO"],
      ["G26043", "10/09/2026", "SERUM", "VIT-C", "NIZA", "100", "10/2028"],
      ["G26044", "10/09/2026", "CREMA", "", "NIZA", "50", "11/2028"],
    ];
    readTabMock.mockResolvedValue(rows);
    await syncSource(source, "test", "manual");
    // "ordenar" la sheet — mismas filas, orden invertido — nunca debe duplicar.
    readTabMock.mockResolvedValue([rows[0], rows[2], rows[1]]);
    const second = await syncSource(source, "test", "manual");
    expect(second.createdCount).toBe(0);
    expect(second.unchangedCount).toBe(2);
    const all = await getAsignacionLotesService().listBySource(source.id);
    expect(all).toHaveLength(2);
  });

  it("Test 11: modificar VTO en la fuente actualiza el registro (no crea uno nuevo)", async () => {
    const { syncSource } = await import("./asignacion-lotes-sync-service");
    const source = await createSource();
    readTabMock.mockResolvedValue([
      ["LOTE", "FECHA", "PRODUCTO", "CÓDIGO", "MARCA", "CANTIDAD", "VTO"],
      ["G26043", "10/09/2026", "SERUM", "", "NIZA", "100", "10/2028"],
    ]);
    await syncSource(source, "test", "manual");
    readTabMock.mockResolvedValue([
      ["LOTE", "FECHA", "PRODUCTO", "CÓDIGO", "MARCA", "CANTIDAD", "VTO"],
      ["G26043", "10/09/2026", "SERUM", "", "NIZA", "100", "11/2028"],
    ]);
    const second = await syncSource(source, "test", "manual");
    expect(second.updatedCount).toBe(1);
    expect(second.createdCount).toBe(0);
    const all = await getAsignacionLotesService().listBySource(source.id);
    expect(all).toHaveLength(1);
    expect(all[0]!.vto).toBe("2028-11-30");
  });

  it("Test 15: una fila con VTO inválido no rompe el resto de la sincronización", async () => {
    const { syncSource } = await import("./asignacion-lotes-sync-service");
    const source = await createSource();
    readTabMock.mockResolvedValue([
      ["LOTE", "FECHA", "PRODUCTO", "CÓDIGO", "MARCA", "CANTIDAD", "VTO"],
      ["G26043", "10/09/2026", "SERUM", "", "NIZA", "100", "10/2028"],
      ["G26044", "10/09/2026", "CREMA", "", "NIZA", "50", "no-es-una-fecha"],
      ["G26045", "10/09/2026", "GEL", "", "NIZA", "20", "12/2028"],
    ]);
    const summary = await syncSource(source, "test", "manual");
    expect(summary.createdCount).toBe(2);
    expect(summary.invalidCount).toBe(1);
    expect(summary.status).toBe("parcial");
    const all = await getAsignacionLotesService().listBySource(source.id);
    expect(all.map((r) => r.lote).sort()).toEqual(["G26043", "G26045"]);
  });

  it("Test 16: eliminar/quitar una fila de la Sheet archiva el registro, nunca DELETE físico", async () => {
    const { syncSource } = await import("./asignacion-lotes-sync-service");
    const source = await createSource();
    readTabMock.mockResolvedValue([
      ["LOTE", "FECHA", "PRODUCTO", "CÓDIGO", "MARCA", "CANTIDAD", "VTO"],
      ["G26043", "10/09/2026", "SERUM", "", "NIZA", "100", "10/2028"],
      ["G26044", "10/09/2026", "CREMA", "", "NIZA", "50", "11/2028"],
    ]);
    await syncSource(source, "test", "manual");
    // G26044 desaparece de la Sheet.
    readTabMock.mockResolvedValue([
      ["LOTE", "FECHA", "PRODUCTO", "CÓDIGO", "MARCA", "CANTIDAD", "VTO"],
      ["G26043", "10/09/2026", "SERUM", "", "NIZA", "100", "10/2028"],
    ]);
    const second = await syncSource(source, "test", "manual");
    expect(second.archivedCount).toBe(1);
    const active = await getAsignacionLotesService().listBySource(source.id);
    expect(active.map((r) => r.lote)).toEqual(["G26043"]);
  });

  it("Test 17: fuente desactivada no sincroniza (syncAllEnabledSources la ignora)", async () => {
    const { syncAllEnabledSources } = await import("./asignacion-lotes-sync-service");
    const source = await createSource();
    await getAsignacionLoteSourcesService().update(admin, source.id, { enabled: false });
    readTabMock.mockResolvedValue([["LOTE"], ["G26043"]]);
    const results = await syncAllEnabledSources("test", "cron");
    expect(results).toHaveLength(0);
    expect(readTabMock).not.toHaveBeenCalled();
  });

  it("Test 18/19: dos fuentes activas (2026 + 2027) sincronizan cada una sin interferirse", async () => {
    const { syncAllEnabledSources } = await import("./asignacion-lotes-sync-service");
    const source2026 = await createSource({ sheetTab: "LOTES_2026" });
    const source2027 = await getAsignacionLoteSourcesService().create(admin, {
      name: "Asignación de Lotes 2027",
      period: "2027",
      spreadsheetUrlOrId: "https://docs.google.com/spreadsheets/d/zzz999AAA_-111/edit",
      sheetTab: "LOTES_2027",
    });
    readTabMock.mockImplementation(async (spreadsheetId: string) => {
      if (spreadsheetId === source2026.spreadsheetId) {
        return [
          ["LOTE", "FECHA", "PRODUCTO", "CANTIDAD"],
          ["G26043", "10/09/2026", "SERUM", "100"],
        ];
      }
      return [
        ["LOTE", "FECHA", "PRODUCTO", "CANTIDAD"],
        ["G27001", "05/01/2027", "CREMA", "50"],
      ];
    });
    const results = await syncAllEnabledSources("test", "cron");
    expect(results).toHaveLength(2);
    const lotes2026 = await getAsignacionLotesService().listBySource(source2026.id);
    const lotes2027 = await getAsignacionLotesService().listBySource(source2027.id);
    expect(lotes2026.map((r) => r.lote)).toEqual(["G26043"]);
    expect(lotes2027.map((r) => r.lote)).toEqual(["G27001"]);
  });

  it("Test 20: desactivar una fuente conserva sus datos ya sincronizados", async () => {
    const { syncSource } = await import("./asignacion-lotes-sync-service");
    const source = await createSource();
    readTabMock.mockResolvedValue([
      ["LOTE", "FECHA", "PRODUCTO", "CANTIDAD"],
      ["G26043", "10/09/2026", "SERUM", "100"],
    ]);
    await syncSource(source, "test", "manual");
    await getAsignacionLoteSourcesService().update(admin, source.id, { enabled: false });
    const stillThere = await getAsignacionLotesService().listBySource(source.id);
    expect(stillThere).toHaveLength(1);
  });

  it("Test 21: conflicto entre fuentes (mismo lote+código ya cargado manualmente) se reporta, no se fusiona", async () => {
    const { syncSource } = await import("./asignacion-lotes-sync-service");
    const source = await createSource();
    await getAsignacionLotesService().upsert(
      { email: "calidad@x.com", sector: "CALIDAD", displayName: "Calidad" },
      { lote: "G26043", fecha: "2026-09-10", producto: "SERUM", codigo: "", cantidades: 100, updatedBy: "Calidad" }
    );
    readTabMock.mockResolvedValue([
      ["LOTE", "FECHA", "PRODUCTO", "CANTIDAD"],
      ["G26043", "10/09/2026", "SERUM", "100"],
    ]);
    const summary = await syncSource(source, "test", "manual");
    expect(summary.conflictCount).toBe(1);
    expect(summary.status).toBe("parcial");
  });

  it("Test 22: si Google falla (Sheets caído), GENUS OS conserva el último estado válido — nunca lanza", async () => {
    const { syncSource } = await import("./asignacion-lotes-sync-service");
    const source = await createSource();
    readTabMock.mockResolvedValue([
      ["LOTE", "FECHA", "PRODUCTO", "CANTIDAD"],
      ["G26043", "10/09/2026", "SERUM", "100"],
    ]);
    await syncSource(source, "test", "manual");
    readTabMock.mockRejectedValue(new Error("Google API caída"));
    const failed = await syncSource(source, "test", "manual");
    expect(failed.status).toBe("error");
    expect(failed.errorMessage).toContain("Google API caída");
    const stillThere = await getAsignacionLotesService().listBySource(source.id);
    expect(stillThere).toHaveLength(1); // dato previo intacto
    const refreshedSource = await getAsignacionLoteSourcesService().getForSync(source.id);
    expect(refreshedSource?.syncStatus).toBe("error");
    expect(refreshedSource?.lastError).toContain("Google API caída");
  });

  it("Test 23: Sincronizar ahora (manual) funciona vía syncSourceById", async () => {
    const { syncSourceById } = await import("./asignacion-lotes-sync-service");
    const source = await createSource();
    readTabMock.mockResolvedValue([
      ["LOTE", "FECHA", "PRODUCTO", "CANTIDAD"],
      ["G26043", "10/09/2026", "SERUM", "100"],
    ]);
    const summary = await syncSourceById(source.id, "produccion@x.com", "manual");
    expect(summary?.triggerKind).toBe("manual");
    expect(summary?.createdCount).toBe(1);
  });

  it("Test 28 (regresión): caso real ECODERM/ROSEHIP sincronizado desde Sheets alimenta el resolver existente", async () => {
    const { syncSource } = await import("./asignacion-lotes-sync-service");
    const { resolveAsignacionLoteForWorkItem } = await import("./resolve-for-work-item");
    const source = await createSource();
    readTabMock.mockResolvedValue([
      ["LOTE", "FECHA", "PRODUCTO", "CÓDIGO", "MARCA", "CANTIDAD", "VTO"],
      ["S26018", "16/09/2026", "SERUM", "VITAMINA C", "ROSEHIP-ECODERM", "100", "12/2029"],
    ]);
    await syncSource(source, "test", "manual");
    const lotes = await getAsignacionLotesService().listBySource(source.id);
    const resolution = resolveAsignacionLoteForWorkItem(lotes, {
      cliente: "ECODERM",
      producto: "SERUM VITAMINA C ROSEHIP",
    });
    expect(resolution).toMatchObject({ status: "found", candidate: { lote: "S26018", vto: "2029-12-31" } });
  });
});
