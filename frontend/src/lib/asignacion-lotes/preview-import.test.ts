import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetAsignacionLotesMemoryForTests, getAsignacionLotesService } from "./asignacion-lotes-service";

const readTabMock = vi.fn();
const listTabsMock = vi.fn();

vi.mock("@/lib/adapters/sheets/sheets-reader", () => ({
  sheetsReader: {
    readTab: (...args: unknown[]) => readTabMock(...args),
    listTabs: (...args: unknown[]) => listTabsMock(...args),
  },
}));

const calidad = { email: "calidad@x.com", sector: "CALIDAD" as const, displayName: "Calidad" };

describe("previewImport — importación inicial segura (sección 'IMPORTACIÓN INICIAL DE 2025')", () => {
  beforeEach(() => {
    resetAsignacionLotesMemoryForTests();
    readTabMock.mockReset();
  });

  const url = "https://docs.google.com/spreadsheets/d/hist2025AAAA_-111";

  it("planilla toda nueva (GENUS OS vacío) -> todo cuenta como 'nuevas'", async () => {
    readTabMock.mockResolvedValue([
      ["LOTE", "FECHA", "PRODUCTO", "CANTIDAD"],
      ["G25001", "10/01/2025", "SERUM", "50"],
      ["G25002", "11/01/2025", "CREMA", "30"],
    ]);
    const { previewImport } = await import("./asignacion-lotes-sync-service");
    const result = await previewImport(url, "LOTES_2025");
    expect(result.ok).toBe(true);
    expect(result.rowsFound).toBe(2);
    expect(result.nuevas).toBe(2);
    expect(result.existentes).toBe(0);
    expect(result.conflictos).toBe(0);
  });

  it("fila ya cargada manualmente con LOS MISMOS datos -> 'ya existente', nunca cuenta como nueva ni conflicto", async () => {
    await getAsignacionLotesService().upsert(calidad, {
      lote: "G25001",
      fecha: "2025-01-10",
      producto: "SERUM",
      codigo: "",
      marca: "NIZA",
      cantidades: 50,
      vto: "2027-06-30",
      updatedBy: "Calidad",
    });
    readTabMock.mockResolvedValue([
      ["LOTE", "FECHA", "PRODUCTO", "MARCA", "CANTIDAD", "VTO"],
      ["G25001", "10/01/2025", "SERUM", "NIZA", "50", "06/2027"],
    ]);
    const { previewImport } = await import("./asignacion-lotes-sync-service");
    const result = await previewImport(url, "LOTES_2025");
    expect(result.existentes).toBe(1);
    expect(result.nuevas).toBe(0);
    expect(result.conflictos).toBe(0);
  });

  it("fila ya cargada manualmente con datos DISTINTOS (ej. VTO diferente) -> 'conflicto', nunca se fusiona sola", async () => {
    await getAsignacionLotesService().upsert(calidad, {
      lote: "G25001",
      fecha: "2025-01-10",
      producto: "SERUM",
      codigo: "",
      cantidades: 50,
      vto: "2027-06-30",
      updatedBy: "Calidad",
    });
    readTabMock.mockResolvedValue([
      ["LOTE", "FECHA", "PRODUCTO", "CANTIDAD", "VTO"],
      ["G25001", "10/01/2025", "SERUM", "50", "12/2027"],
    ]);
    const { previewImport } = await import("./asignacion-lotes-sync-service");
    const result = await previewImport(url, "LOTES_2025");
    expect(result.conflictos).toBe(1);
    expect(result.existentes).toBe(0);
    expect(result.conflictSamples).toHaveLength(1);
    expect(result.conflictSamples[0]!.lote).toBe("G25001");
  });

  it("fila inválida (VTO ilegible) cuenta aparte, no rompe el resto del preview", async () => {
    readTabMock.mockResolvedValue([
      ["LOTE", "FECHA", "PRODUCTO", "CANTIDAD", "VTO"],
      ["G25001", "10/01/2025", "SERUM", "50", "no-es-fecha"],
      ["G25002", "10/01/2025", "CREMA", "20", "06/2027"],
    ]);
    const { previewImport } = await import("./asignacion-lotes-sync-service");
    const result = await previewImport(url, "LOTES_2025");
    expect(result.invalidas).toBe(1);
    expect(result.nuevas).toBe(1);
  });

  it("no persiste absolutamente nada — GENUS OS queda igual después del preview", async () => {
    readTabMock.mockResolvedValue([
      ["LOTE", "FECHA", "PRODUCTO", "CANTIDAD"],
      ["G25001", "10/01/2025", "SERUM", "50"],
    ]);
    const { previewImport } = await import("./asignacion-lotes-sync-service");
    await previewImport(url, "LOTES_2025");
    const items = await getAsignacionLotesService().list(calidad);
    expect(items).toHaveLength(0);
  });

  it("error de Google (planilla inaccesible) -> ok:false, nunca lanza", async () => {
    readTabMock.mockRejectedValue(new Error("403 forbidden"));
    const { previewImport } = await import("./asignacion-lotes-sync-service");
    const result = await previewImport(url, "LOTES_2025");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("403");
  });

  it("URL inválida -> ok:false con error claro", async () => {
    const { previewImport } = await import("./asignacion-lotes-sync-service");
    const result = await previewImport("no es una url", "LOTES_2025");
    expect(result.ok).toBe(false);
  });
});

describe("previewImport — modo multi-hoja (hotfix, sheetTab vacío)", () => {
  beforeEach(() => {
    resetAsignacionLotesMemoryForTests();
    readTabMock.mockReset();
    listTabsMock.mockReset();
  });

  const url = "https://docs.google.com/spreadsheets/d/multiPreviewAAAA_-111";

  it("sin sheetTab -> descubre todas las hojas y muestra desglose por hoja", async () => {
    listTabsMock.mockResolvedValue(["ENERO", "FEBRERO", "OBSERVACIONES"]);
    readTabMock.mockImplementation(async (_id: string, tab: string) => {
      if (tab === "OBSERVACIONES") return [["NOTA"], ["algo"]];
      if (tab === "ENERO") {
        return [
          ["LOTE", "FECHA", "PRODUCTO", "CANTIDAD"],
          ["G25001", "10/01/2025", "SERUM", "50"],
        ];
      }
      return [
        ["LOTE", "FECHA", "PRODUCTO", "CANTIDAD"],
        ["G25002", "10/02/2025", "CREMA", "30"],
      ];
    });
    const { previewImport } = await import("./asignacion-lotes-sync-service");
    const result = await previewImport(url, null);
    expect(result.ok).toBe(true);
    expect(result.sheets).toHaveLength(3);
    expect(result.sheets!.filter((s) => s.compatible).map((s) => s.tab).sort()).toEqual(["ENERO", "FEBRERO"]);
    const ignored = result.sheets!.find((s) => s.tab === "OBSERVACIONES");
    expect(ignored?.compatible).toBe(false);
    expect(ignored?.ignoredReason).toContain("columnas mínimas");
    expect(result.rowsFound).toBe(2);
    expect(result.nuevas).toBe(2);
  });

  it("duplicado idéntico entre hojas en preview no se cuenta dos veces", async () => {
    listTabsMock.mockResolvedValue(["ENERO", "FEBRERO"]);
    readTabMock.mockResolvedValue([
      ["LOTE", "FECHA", "PRODUCTO", "CANTIDAD", "VTO"],
      ["G25043", "31/01/2025", "SERUM", "50", "10/2027"],
    ]);
    const { previewImport } = await import("./asignacion-lotes-sync-service");
    const result = await previewImport(url, null);
    expect(result.rowsFound).toBe(2);
    expect(result.nuevas).toBe(1);
    expect(result.conflictos).toBe(0);
  });

  it("conflicto entre hojas en preview se informa con las dos hojas involucradas", async () => {
    listTabsMock.mockResolvedValue(["ENERO", "FEBRERO"]);
    readTabMock.mockImplementation(async (_id: string, tab: string) => {
      const vto = tab === "ENERO" ? "10/2027" : "11/2027";
      return [
        ["LOTE", "FECHA", "PRODUCTO", "CANTIDAD", "VTO"],
        ["G25043", "31/01/2025", "SERUM", "50", vto],
      ];
    });
    const { previewImport } = await import("./asignacion-lotes-sync-service");
    const result = await previewImport(url, null);
    expect(result.conflictos).toBe(1);
    expect(result.conflictSamples).toHaveLength(1);
    expect(result.conflictSamples[0]!.tabs).toEqual(["ENERO", "FEBRERO"]);
  });

  it("con sheetTab específico -> preview single-tab preexistente sin cambios (sin 'sheets')", async () => {
    readTabMock.mockResolvedValue([
      ["LOTE", "FECHA", "PRODUCTO", "CANTIDAD"],
      ["G25001", "10/01/2025", "SERUM", "50"],
    ]);
    const { previewImport } = await import("./asignacion-lotes-sync-service");
    const result = await previewImport(url, "LOTES_2025");
    expect(result.sheets).toBeUndefined();
    expect(listTabsMock).not.toHaveBeenCalled();
    expect(result.nuevas).toBe(1);
  });
});
