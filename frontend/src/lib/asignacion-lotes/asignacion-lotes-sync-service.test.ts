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

// Las fuentes oficiales (2025/2026, ver official-sources.ts) tienen su
// propia suite dedicada (official-sources.test.ts). Acá se neutralizan para
// que los tests preexistentes de este archivo — que ejercitan
// syncAllEnabledSources con SUS PROPIAS fuentes de prueba — no se vean
// afectados por la creación automática de las 2 fuentes oficiales.
vi.mock("./official-sources", () => ({
  ensureOfficialSourcesAndRetireRedundant: vi.fn().mockResolvedValue(undefined),
  OFFICIAL_ASIGNACION_LOTES_SPREADSHEETS: [],
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

  it("Test 19b: dos fuentes históricas (2025 + 2026) conectadas simultáneamente — ninguna interfiere con la otra", async () => {
    const source2025 = await getAsignacionLoteSourcesService().create(admin, {
      name: "Asignación de Lotes 2025",
      period: "2025",
      spreadsheetUrlOrId: "https://docs.google.com/spreadsheets/d/hist2025AAAA_-111",
      sheetTab: "LOTES_2025",
    });
    const source2026 = await getAsignacionLoteSourcesService().create(admin, {
      name: "Asignación de Lotes 2026",
      period: "2026",
      spreadsheetUrlOrId: "https://docs.google.com/spreadsheets/d/hist2026BBBB_-222",
      sheetTab: "LOTES_2026",
    });
    readTabMock.mockImplementation(async (spreadsheetId: string) => {
      if (spreadsheetId === source2025.spreadsheetId) {
        return [
          ["LOTE", "FECHA", "PRODUCTO", "CANTIDAD"],
          ["G25043", "10/03/2025", "SERUM HISTORICO", "80"],
        ];
      }
      return [
        ["LOTE", "FECHA", "PRODUCTO", "CANTIDAD"],
        ["G26043", "10/09/2026", "SERUM", "100"],
      ];
    });
    const { syncAllEnabledSources } = await import("./asignacion-lotes-sync-service");
    const results = await syncAllEnabledSources("test", "manual");
    expect(results).toHaveLength(2);
    const lotes2025 = await getAsignacionLotesService().listBySource(source2025.id);
    const lotes2026 = await getAsignacionLotesService().listBySource(source2026.id);
    expect(lotes2025.map((r) => r.lote)).toEqual(["G25043"]);
    expect(lotes2026.map((r) => r.lote)).toEqual(["G26043"]);

    // Búsqueda global (search por lote histórico de 2025) debe encontrarlo
    // sin scoping por fuente/año — list() no filtra por source.
    const all = await getAsignacionLotesService().list(admin);
    expect(all.some((r) => r.lote === "G25043")).toBe(true);
    expect(all.some((r) => r.lote === "G26043")).toBe(true);

    // Agregar una TERCERA fuente (2027) más adelante funciona sin cambio de
    // código — misma API, mismo flujo, ningún hardcode de "máximo 2 fuentes".
    const source2027 = await getAsignacionLoteSourcesService().create(admin, {
      name: "Asignación de Lotes 2027",
      period: "2027",
      spreadsheetUrlOrId: "https://docs.google.com/spreadsheets/d/future2027CCCC_-333",
      sheetTab: "LOTES_2027",
    });
    readTabMock.mockImplementation(async (spreadsheetId: string) => {
      if (spreadsheetId === source2025.spreadsheetId) return [["LOTE"], ["G25043"]];
      if (spreadsheetId === source2026.spreadsheetId) return [["LOTE"], ["G26043"]];
      return [["LOTE", "FECHA", "PRODUCTO", "CANTIDAD"], ["G27001", "05/01/2027", "CREMA", "10"]];
    });
    const resultsWithThird = await syncAllEnabledSources("test", "manual");
    expect(resultsWithThird).toHaveLength(3);
    const lotes2027 = await getAsignacionLotesService().listBySource(source2027.id);
    expect(lotes2027.map((r) => r.lote)).toEqual(["G27001"]);
  });

  it("fuente con hoja EXPLÍCITA sincroniza esa única hoja, sin descubrir nada (comportamiento sin cambios)", async () => {
    const { syncSource } = await import("./asignacion-lotes-sync-service");
    const source = await createSource({ sheetTab: "Asignación" });
    readTabMock.mockResolvedValue([
      ["LOTE", "FECHA", "PRODUCTO", "CANTIDAD"],
      ["G26001", "10/09/2026", "SERUM", "100"],
    ]);
    await syncSource(source, "test", "manual");
    expect(listTabsMock).not.toHaveBeenCalled();
    const lotes = await getAsignacionLotesService().listBySource(source.id);
    expect(lotes.map((l) => l.lote)).toEqual(["G26001"]);
  });

  /**
   * Cambio definitivo (reemplaza "una fuente = una hoja obligatoria",
   * PR #99): sheetTab null ya NO es un error — significa "descubrir todas
   * las hojas válidas del spreadsheet". Una hoja sin la estructura mínima
   * (lote/fecha/producto/codigo/marca/cantidad/vto) se ignora
   * justificadamente, nunca rompe las demás.
   */
  it("fuente SIN hoja configurada -> descubre todas las hojas y sincroniza las que tienen estructura válida", async () => {
    const { syncSource } = await import("./asignacion-lotes-sync-service");
    const source = await getAsignacionLoteSourcesService().create(admin, {
      name: "Asignación de Lotes 2025",
      period: "2025",
      spreadsheetUrlOrId: "https://docs.google.com/spreadsheets/d/multiTabAAAA",
      sheetTab: "x",
    });
    const spreadsheetLevel = { ...source, sheetTab: null };
    listTabsMock.mockResolvedValue(["ENERO", "FEBRERO", "NOTAS INTERNAS"]);
    readTabMock.mockImplementation(async (_spreadsheetId: string, tab: string) => {
      if (tab === "ENERO") {
        return [
          ["N° LOTE", "FECHA", "PRODUCTO", "CODIGO", "MARCA", "CANTIDAD", "VTO"],
          ["E25001", "05/01/2025", "SERUM", "VIT-C", "ECODERM", "80", "05/2027"],
        ];
      }
      if (tab === "FEBRERO") {
        return [
          ["N° LOTE", "FECHA", "PRODUCTO", "CODIGO", "MARCA", "CANTIDAD", "VTO"],
          ["F25001", "03/02/2025", "CREMA", "", "ECODERM", "40", "03/2027"],
        ];
      }
      // "NOTAS INTERNAS": no tiene la estructura mínima -> se ignora.
      return [["TITULO", "COMENTARIO"], ["x", "y"]];
    });
    const summary = await syncSource(spreadsheetLevel, "test", "manual");
    expect(summary.status).toBe("parcial"); // 1 hoja ignorada
    expect(summary.sheetsTotal).toBe(3);
    expect(summary.ignoredTabs).toHaveLength(1);
    expect(summary.ignoredTabs![0]!.tab).toBe("NOTAS INTERNAS");
    expect(summary.tabBreakdown).toHaveLength(2);
    expect(summary.tabBreakdown!.map((t) => t.tab).sort()).toEqual(["ENERO", "FEBRERO"]);
    const lotes = await getAsignacionLotesService().listBySource(source.id);
    expect(lotes.map((l) => l.lote).sort()).toEqual(["E25001", "F25001"]);
    expect(lotes.every((l) => l.sourceSheetTab === "ENERO" || l.sourceSheetTab === "FEBRERO")).toBe(true);
  });

  it("una hoja que falla al leer (error transitorio) no tumba la sincronización de las demás ni pierde lo ya sincronizado antes", async () => {
    const { syncSource } = await import("./asignacion-lotes-sync-service");
    const source = await getAsignacionLoteSourcesService().create(admin, {
      name: "Asignación de Lotes 2026",
      period: "2026",
      spreadsheetUrlOrId: "https://docs.google.com/spreadsheets/d/partialFailAAAA",
      sheetTab: "x",
    });
    const spreadsheetLevel = { ...source, sheetTab: null };
    listTabsMock.mockResolvedValue(["ENERO", "FEBRERO", "MARZO", "ABRIL"]);
    const okRows = (lote: string) => [
      ["N° LOTE", "FECHA", "PRODUCTO", "CODIGO", "MARCA", "CANTIDAD", "VTO"],
      [lote, "05/01/2026", "SERUM", "", "ECODERM", "10", "05/2028"],
    ];
    readTabMock.mockImplementation(async (_spreadsheetId: string, tab: string) => {
      if (tab === "ENERO") return okRows("E26001");
      if (tab === "FEBRERO") return okRows("F26001");
      if (tab === "MARZO") throw new Error("Google API caída para esta hoja");
      return okRows("A26001");
    });
    const summary = await syncSource(spreadsheetLevel, "test", "manual");
    expect(summary.status).toBe("parcial");
    expect(summary.ignoredTabs!.some((t) => t.tab === "MARZO")).toBe(true);
    const lotes = await getAsignacionLotesService().listBySource(source.id);
    expect(lotes.map((l) => l.lote).sort()).toEqual(["A26001", "E26001", "F26001"]);
  });

  it("Hotfix reconciliación #1 — 100 filas de una sola hoja -> procesa las 100 (ninguna se pierde)", async () => {
    const { syncSource } = await import("./asignacion-lotes-sync-service");
    const source = await createSource();
    const rows = Array.from({ length: 100 }, (_v, i) => [`G${i}`, "10/01/2025", "SERUM", "10"]);
    readTabMock.mockResolvedValue([["LOTE", "FECHA", "PRODUCTO", "CANTIDAD"], ...rows]);
    const summary = await syncSource(source, "test", "manual");
    expect(summary.rowsRead).toBe(100);
    expect(summary.createdCount).toBe(100);
    expect(summary.reconciled).toBe(true);
    expect(summary.status).toBe("ok");
    const lotes = await getAsignacionLotesService().listBySource(source.id);
    expect(lotes).toHaveLength(100);
  });

  it("Hotfix reconciliación #2 — filas vacías cuentan como blank y nunca se pierden de la reconciliación", async () => {
    const { syncSource } = await import("./asignacion-lotes-sync-service");
    const source = await createSource();
    readTabMock.mockResolvedValue([
      ["LOTE", "FECHA", "PRODUCTO", "CANTIDAD"],
      ["", "", "", ""],
      ["G25001", "10/01/2025", "SERUM", "10"],
      ["", "", "", ""],
    ]);
    const summary = await syncSource(source, "test", "manual");
    expect(summary.createdCount).toBe(1);
    expect(summary.blankCount).toBe(2);
    expect(summary.rowsRead).toBe(3);
    expect(summary.reconciled).toBe(true);
    expect(summary.status).toBe("ok");
  });

  it("Hotfix reconciliación #3 — fila repetida IDÉNTICA dentro de la misma hoja no duplica, cuenta en la reconciliación", async () => {
    const { syncSource } = await import("./asignacion-lotes-sync-service");
    const source = await createSource();
    readTabMock.mockResolvedValue([
      ["LOTE", "FECHA", "PRODUCTO", "CANTIDAD", "VTO"],
      ["G25043", "31/01/2025", "SERUM", "50", "10/2027"],
      ["G25043", "31/01/2025", "SERUM", "50", "10/2027"],
    ]);
    const summary = await syncSource(source, "test", "manual");
    expect(summary.createdCount).toBe(1);
    expect(summary.duplicateCount).toBe(1);
    expect(summary.conflictCount).toBe(0);
    expect(summary.reconciled).toBe(true);
    const lotes = await getAsignacionLotesService().listBySource(source.id);
    expect(lotes).toHaveLength(1);
  });

  it("Hotfix reconciliación #4 — fila repetida con datos DISTINTOS dentro de la misma hoja se informa, nunca se elige en silencio", async () => {
    const { syncSource } = await import("./asignacion-lotes-sync-service");
    const source = await createSource();
    readTabMock.mockResolvedValue([
      ["LOTE", "FECHA", "PRODUCTO", "CANTIDAD", "VTO"],
      ["G25043", "31/01/2025", "SERUM", "50", "10/2027"],
      ["G25043", "31/01/2025", "SERUM", "50", "11/2027"],
    ]);
    const summary = await syncSource(source, "test", "manual");
    expect(summary.conflictCount).toBe(1);
    expect(summary.status).toBe("parcial");
    expect(summary.reconciled).toBe(true);
    const lotes = await getAsignacionLotesService().listBySource(source.id);
    expect(lotes).toHaveLength(1);
    expect(lotes[0]!.vto).toBe("2027-10-31"); // primera fila persiste, nunca se sobreescribe en silencio
  });

  it("Hotfix reconciliación #5 (BUG crítico) — un registro archivado que reaparece en la Sheet se REVIVE, nunca queda invisible para siempre", async () => {
    const { syncSource } = await import("./asignacion-lotes-sync-service");
    const source = await createSource();
    readTabMock.mockResolvedValue([
      ["LOTE", "FECHA", "PRODUCTO", "CANTIDAD", "VTO"],
      ["G26043", "10/09/2026", "SERUM", "100", "10/2028"],
    ]);
    await syncSource(source, "test", "manual");
    let lotes = await getAsignacionLotesService().listBySource(source.id);
    expect(lotes).toHaveLength(1);

    // La fila desaparece de la Sheet (por ejemplo, se borró por error) ->
    // el sync la archiva correctamente (comportamiento ya esperado).
    readTabMock.mockResolvedValue([["LOTE", "FECHA", "PRODUCTO", "CANTIDAD", "VTO"]]);
    const removed = await syncSource(source, "test", "manual");
    expect(removed.archivedCount).toBe(1);
    lotes = await getAsignacionLotesService().listBySource(source.id);
    expect(lotes).toHaveLength(0); // invisible en el listado activo, como se espera de un archivado real

    // La fila VUELVE a aparecer en la Sheet con los MISMOS datos exactos
    // (ej. alguien deshizo el borrado accidental) -> ANTES de este fix,
    // quedaba archivada PARA SIEMPRE porque el contenido coincidía con el
    // registro archivado y `upsertFromSource` la daba por "sin cambios"
    // sin revivirla. Debe volver a aparecer en el listado activo.
    readTabMock.mockResolvedValue([
      ["LOTE", "FECHA", "PRODUCTO", "CANTIDAD", "VTO"],
      ["G26043", "10/09/2026", "SERUM", "100", "10/2028"],
    ]);
    const revived = await syncSource(source, "test", "manual");
    expect(revived.createdCount + revived.updatedCount).toBe(1);
    lotes = await getAsignacionLotesService().listBySource(source.id);
    expect(lotes).toHaveLength(1);
    expect(lotes[0]!.lote).toBe("G26043");
    expect(lotes[0]!.vto).toBe("2028-10-31"); // VTO se conserva correctamente al revivir
  });

  it("Hotfix reconciliación #6 — misma marca/producto con lotes DIFERENTES conserva ambos (no deduplica agresivamente)", async () => {
    const { syncSource } = await import("./asignacion-lotes-sync-service");
    const source = await createSource();
    readTabMock.mockResolvedValue([
      ["LOTE", "FECHA", "PRODUCTO", "MARCA", "CANTIDAD", "VTO"],
      ["G26001", "10/09/2026", "SERUM VITAMINA C", "ECODERM", "100", "10/2028"],
      ["G26002", "10/09/2026", "SERUM VITAMINA C", "ECODERM", "50", "11/2028"],
    ]);
    const summary = await syncSource(source, "test", "manual");
    expect(summary.createdCount).toBe(2);
    const lotes = await getAsignacionLotesService().listBySource(source.id);
    expect(lotes.map((l) => l.lote).sort()).toEqual(["G26001", "G26002"]);
  });

  it("Hotfix reconciliación #7 — la ecuación de reconciliación detecta una inconsistencia real (unit del helper puro)", async () => {
    const { reconciliationTotal } = await import("./asignacion-lotes-sync-service");
    const balanced = {
      blankCount: 2,
      auxiliaryCount: 1,
      invalidCount: 1,
      duplicateCount: 1,
      conflictCount: 1,
      createdCount: 3,
      updatedCount: 2,
      unchangedCount: 0,
    };
    expect(reconciliationTotal(balanced)).toBe(11);
    const unbalanced = { ...balanced, createdCount: 1 }; // simula 2 filas "perdidas"
    expect(reconciliationTotal(unbalanced)).toBe(9);
  });

  it("Hotfix reproducción real — hoja SEPTIEMBRE 2026: sincroniza limpio, ninguna fila real queda inválida", async () => {
    const { syncSource } = await import("./asignacion-lotes-sync-service");
    const source = await createSource({ sheetTab: "SEPTIEMBRE" });

    const header = [
      "N° LOTE", "FECHA", "PRODUCTO", "CODIGO", "MARCA", "CANTIDAD", "VTO",
      "MM", "FECHA ANALISIS", "N° ANALISIS", "OE", "OA", "RL", "OBSERVACION",
    ];
    const rows = [
      header,
      ["", "", "AGU DEL SECTOR DE ELABORACION", "", "", "", "", "", "2-9", "", "", "", "", ""],
      ["S26001", "1/9/2026", "AFTER SHAVE", "VERDE", "ORIGINAL BLACK", "6800", "1/9/28", "", "N/A", "", "", "", "", ""],
      ["S26002", "1/9/2026", "AFTER SHAVE", "VIOLETA", "ORIGINAL BLACK", "6800", "1/9/28", "", "N/A", "", "", "", "", ""],
      ["S26003", "1/9/2026", "AFTER SHAVE", "AZUL", "ORIGINAL BLACK", "6800", "1/9/28", "", "N/A", "", "", "", "", ""],
      ["S26004", "1/9/2026", "SERUM", "SILICIO+OLIGOELEMENTOS", "LUCENT", "500", "1/9/28", "", "N/A", "", "", "", "", ""],
      ["S26012", "1/9/2026", "ADVANCE", "VITAMINA C", "PROFESSIONAL BEAUTY", "500", "1/9/28", "", "N/A", "", "", "", "", ""],
      ["S26017", "1/9/2026", "CREMA FACIAL CON ACIDO HIALURONICO", "", "ROSEHIP-ECODERM", "240", "1/9/28", "", "N/A", "", "", "", "", ""],
      ["S26018", "1/9/2026", "SERUM", "VITAMINA C", "ROSEHIP-ECODERM", "300", "1/9/28", "", "N/A", "", "", "", "", ""],
    ];
    readTabMock.mockResolvedValue(rows);

    const summary = await syncSource(source, "test", "manual");

    // El resultado deja de ser "91 leídas / 90 inválidas": las 7 filas
    // reales se crean, solo la fila auxiliar queda aparte (nunca inválida).
    expect(summary.rowsRead).toBe(8);
    expect(summary.createdCount).toBe(7);
    expect(summary.auxiliaryCount).toBe(1);
    expect(summary.invalidCount).toBe(0);
    expect(summary.reconciled).toBe(true);
    expect(summary.status).toBe("ok");

    const lotes = await getAsignacionLotesService().listBySource(source.id);
    const byLote = Object.fromEntries(lotes.map((l) => [l.lote, l]));

    expect(Object.keys(byLote).sort()).toEqual(
      ["S26001", "S26002", "S26003", "S26004", "S26012", "S26017", "S26018"].sort()
    );

    expect(byLote.S26001).toMatchObject({
      fecha: "2026-09-01",
      producto: "AFTER SHAVE",
      codigo: "VERDE",
      marca: "ORIGINAL BLACK",
      cantidades: 6800,
      vto: "2028-09-01",
    });
    expect(byLote.S26002).toMatchObject({ codigo: "VIOLETA", vto: "2028-09-01" });
    expect(byLote.S26003).toMatchObject({ codigo: "AZUL", vto: "2028-09-01" });
    expect(byLote.S26004).toMatchObject({
      producto: "SERUM",
      codigo: "SILICIO+OLIGOELEMENTOS",
      marca: "LUCENT",
      vto: "2028-09-01",
    });
    expect(byLote.S26012).toMatchObject({ producto: "ADVANCE", codigo: "VITAMINA C", vto: "2028-09-01" });
    expect(byLote.S26017).toMatchObject({
      producto: "CREMA FACIAL CON ACIDO HIALURONICO",
      codigo: "", // CÓDIGO vacío en la Sheet real — nunca bloquea
      marca: "ROSEHIP-ECODERM",
      vto: "2028-09-01",
    });
    expect(byLote.S26018).toMatchObject({
      producto: "SERUM",
      codigo: "VITAMINA C",
      marca: "ROSEHIP-ECODERM",
      cantidades: 300,
      vto: "2028-09-01",
    });

    // Búsqueda global (usa el mismo resolver que Asignar trabajo) encuentra
    // por lote y por marca/producto, sin importar en qué fila llegó.
    const all = await getAsignacionLotesService().list(admin);
    expect(all.some((r) => r.lote === "S26001")).toBe(true);
    expect(all.filter((r) => r.marca === "ROSEHIP-ECODERM").map((r) => r.lote).sort()).toEqual(["S26017", "S26018"]);
    expect(all.filter((r) => r.producto === "AFTER SHAVE").map((r) => r.lote).sort()).toEqual([
      "S26001", "S26002", "S26003",
    ]);
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
