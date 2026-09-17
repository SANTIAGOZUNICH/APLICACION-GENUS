import { beforeEach, describe, expect, it, vi } from "vitest";
import { OrdersForbiddenError, OrdersValidationError } from "@/lib/orders/types";
import {
  getAsignacionLoteSourcesService,
  resetAsignacionLoteSourcesMemoryForTests,
} from "./asignacion-lote-sources-service";

const readTabMock = vi.fn();
const listTabsMock = vi.fn();

vi.mock("@/lib/adapters/sheets/sheets-reader", () => ({
  sheetsReader: {
    readTab: (...args: unknown[]) => readTabMock(...args),
    listTabs: (...args: unknown[]) => listTabsMock(...args),
  },
}));

const producción = { email: "produccion@x.com", sector: "PRODUCCION" as const, displayName: "Producción" };
const calidad = { email: "calidad@x.com", sector: "CALIDAD" as const, displayName: "Calidad" };

describe("AsignacionLoteSourcesService", () => {
  beforeEach(() => {
    resetAsignacionLoteSourcesMemoryForTests();
    readTabMock.mockReset();
    listTabsMock.mockReset();
  });

  it("Test 29: RBAC bloquea configuración no autorizada — Calidad no puede crear fuentes (solo consume datos)", async () => {
    const svc = getAsignacionLoteSourcesService();
    await expect(
      svc.create(calidad, {
        name: "X",
        period: "2026",
        spreadsheetUrlOrId: "https://docs.google.com/spreadsheets/d/abc123XYZ_-987",
        sheetTab: "LOTES",
      })
    ).rejects.toThrow(OrdersForbiddenError);
  });

  it("Producción SÍ puede crear una fuente, y el spreadsheetId se extrae de la URL pegada", async () => {
    const svc = getAsignacionLoteSourcesService();
    const source = await svc.create(producción, {
      name: "Asignación de Lotes 2026",
      period: "2026",
      spreadsheetUrlOrId: "https://docs.google.com/spreadsheets/d/abc123XYZ_-987/edit#gid=0",
      sheetTab: "LOTES",
    });
    expect(source.spreadsheetId).toBe("abc123XYZ_-987");
    expect(source.enabled).toBe(true);
    expect(source.syncStatus).toBe("nunca_sincronizado");
  });

  it("Test 2: URL inválida rechaza la creación con un error claro", async () => {
    const svc = getAsignacionLoteSourcesService();
    await expect(
      svc.create(producción, {
        name: "X",
        period: "2026",
        spreadsheetUrlOrId: "no es una url",
        sheetTab: "LOTES",
      })
    ).rejects.toThrow(OrdersValidationError);
  });

  it("update: enable/disable y edición de campos, RBAC gated", async () => {
    const svc = getAsignacionLoteSourcesService();
    const source = await svc.create(producción, {
      name: "2026",
      period: "2026",
      spreadsheetUrlOrId: "https://docs.google.com/spreadsheets/d/abc123XYZ_-987",
      sheetTab: "LOTES",
    });
    const disabled = await svc.update(producción, source.id, { enabled: false });
    expect(disabled.enabled).toBe(false);
    await expect(svc.update(calidad, source.id, { enabled: true })).rejects.toThrow(OrdersForbiddenError);
  });

  it("Test 1: conectar fuente válida -> PROBAR CONEXIÓN reporta accesible/hoja/encabezados/filas", async () => {
    const svc = getAsignacionLoteSourcesService();
    listTabsMock.mockResolvedValue(["LOTES", "OTRA_HOJA"]);
    readTabMock.mockResolvedValue([
      ["LOTE", "FECHA", "PRODUCTO", "VTO", "COLUMNA RARA"],
      ["G26043", "10/09/2026", "SERUM", "10/2028", "x"],
      ["G26044", "10/09/2026", "CREMA", "11/2028", "y"],
    ]);
    const result = await svc.testConnection(
      producción,
      "https://docs.google.com/spreadsheets/d/abc123XYZ_-987",
      "LOTES"
    );
    expect(result.ok).toBe(true);
    expect(result.spreadsheetAccessible).toBe(true);
    expect(result.sheetFound).toBe(true);
    expect(result.availableTabs).toEqual(["LOTES", "OTRA_HOJA"]);
    expect(result.headersRecognized).toEqual(expect.arrayContaining(["LOTE", "FECHA", "PRODUCTO", "VTO"]));
    expect(result.headersUnrecognized).toEqual(["COLUMNA RARA"]);
    expect(result.rowCount).toBe(2);
  });

  it("Test 3: Sheet inaccesible -> ok:false con error, nunca lanza", async () => {
    const svc = getAsignacionLoteSourcesService();
    listTabsMock.mockRejectedValue(new Error("403 forbidden"));
    const result = await svc.testConnection(producción, "https://docs.google.com/spreadsheets/d/abc123XYZ_-987");
    expect(result.ok).toBe(false);
    expect(result.spreadsheetAccessible).toBe(false);
    expect(result.error).toContain("403");
  });

  it("Test 4: hoja inexistente -> ok:false, lista las hojas disponibles", async () => {
    const svc = getAsignacionLoteSourcesService();
    listTabsMock.mockResolvedValue(["LOTES_2026"]);
    const result = await svc.testConnection(
      producción,
      "https://docs.google.com/spreadsheets/d/abc123XYZ_-987",
      "HOJA_QUE_NO_EXISTE"
    );
    expect(result.ok).toBe(false);
    expect(result.sheetFound).toBe(false);
    expect(result.availableTabs).toEqual(["LOTES_2026"]);
  });

  it("Test 30: secretos nunca llegan al cliente — el resultado no incluye credenciales ni tokens", async () => {
    const svc = getAsignacionLoteSourcesService();
    listTabsMock.mockResolvedValue(["LOTES"]);
    readTabMock.mockResolvedValue([["LOTE"], ["G26043"]]);
    const result = await svc.testConnection(producción, "https://docs.google.com/spreadsheets/d/abc123XYZ_-987", "LOTES");
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/private_key|GOOGLE_SERVICE_ACCOUNT|Bearer /i);
  });
});
