import { describe, expect, it } from "vitest";
import {
  interpretMetricsPaste,
  metricNaturalKey,
  parseClipboardTable,
  parseMetricDate,
  parseMetricUnits,
  validateImportRow,
} from "./metricas-paste";

const ENV = { isAdmin: false, defaultSector: "ENVASADO_MASIVO" as const };
const PROD = { isAdmin: true, defaultSector: null };

describe("parseClipboardTable", () => {
  it("separa tabuladores y saltos de línea (CRLF de Excel y LF de Sheets) y descarta la línea final vacía", () => {
    expect(parseClipboardTable("a\tb\r\nc\td\r\n")).toEqual([["a", "b"], ["c", "d"]]);
    expect(parseClipboardTable("a\tb\nc\td\n\n")).toEqual([["a", "b"], ["c", "d"]]);
  });
  it("respeta celdas entre comillas con tabulador, salto de línea y comillas dobles", () => {
    expect(parseClipboardTable('"x\ty"\t"l1\nl2"\t"di ""cho"""')).toEqual([["x\ty", "l1\nl2", 'di "cho"']]);
  });
  it("conserva celdas vacías intermedias (respeta el orden de las columnas)", () => {
    expect(parseClipboardTable("a\t\tc")).toEqual([["a", "", "c"]]);
  });
});

describe("parseMetricUnits (es-AR)", () => {
  it.each([["1200", 1200], ["1.200", 1200], ["12.500", 12500], ["1 200", 1200], ["1200,0", 1200], ["1.200,00", 1200], ["0", 0]])("%s → %d", (raw, n) => {
    expect(parseMetricUnits(raw)).toEqual({ ok: true, value: n });
  });
  it.each(["", "abc", "12,5", "1.200,5", "-3", "1.5"])("rechaza «%s»", (raw) => {
    expect(parseMetricUnits(raw).ok).toBe(false);
  });
  it("explica el decimal en lugar de redondear en silencio", () => {
    const r = parseMetricUnits("12,5");
    expect(r.ok === false && /entero/.test(r.message)).toBe(true);
  });
});

describe("parseMetricDate", () => {
  it.each([["15/10/2026", "2026-10-15"], ["5/3/26", "2026-03-05"], ["15-10-2026", "2026-10-15"], ["15.10.2026", "2026-10-15"], ["2026-10-15", "2026-10-15"], ["2026-10-15T00:00:00", "2026-10-15"]])("%s", (raw, iso) => {
    expect(parseMetricDate(raw)).toEqual({ ok: true, iso });
  });
  it.each(["", "31/02/2026", "13/13/2026", "hoy", "15/10/1999"])("rechaza «%s»", (raw) => {
    expect(parseMetricDate(raw).ok).toBe(false);
  });
  it("interpreta siempre día/mes (formato argentino): 03/04/2026 es 3 de abril", () => {
    expect(parseMetricDate("03/04/2026")).toEqual({ ok: true, iso: "2026-04-03" });
  });
});

describe("interpretMetricsPaste", () => {
  it("sin encabezado: orden Fecha · Producto · Unidades · Responsable (Envasado)", () => {
    const r = interpretMetricsPaste("15/10/2026\tSHAMPOO\t1.200\tAna\n16/10/2026\tCREMA\t800,0\tLuis", ENV);
    expect(r.headerDetected).toBe(false);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toMatchObject({ metricDate: "2026-10-15", product: "SHAMPOO", units: 1200, responsibleDisplay: "Ana", sector: "ENVASADO_MASIVO", valid: true });
    expect(r.rows[1]).toMatchObject({ units: 800, valid: true });
  });
  it("con encabezado: respeta el ORDEN pegado e ignora columnas desconocidas", () => {
    const r = interpretMetricsPaste("Responsable\tUnidades\tObs.\tFecha\tProducto\nAna\t500\tx\t01/11/2026\tGEL", ENV);
    expect(r.headerDetected).toBe(true);
    expect(r.rows[0]).toMatchObject({ metricDate: "2026-11-01", product: "GEL", units: 500, responsibleDisplay: "Ana", valid: true });
  });
  it("Producción: columna Sector (Masivo/Premium) o sector por defecto", () => {
    const withSector = interpretMetricsPaste("15/10/2026\tPremium\tSERUM\t300\tAna", PROD);
    expect(withSector.rows[0]).toMatchObject({ sector: "ENVASADO_PREMIUM", valid: true });
    const without = interpretMetricsPaste("15/10/2026\tSERUM\t300\tAna", PROD);
    expect(without.rows[0]!.errors.sector).toMatch(/sector/i);
    const fallback = interpretMetricsPaste("15/10/2026\tSERUM\t300\tAna", { isAdmin: true, defaultSector: "ENVASADO_MASIVO" });
    expect(fallback.rows[0]).toMatchObject({ sector: "ENVASADO_MASIVO", valid: true });
  });
  it("marca el error en la celda correspondiente sin descartar la fila", () => {
    const r = interpretMetricsPaste("32/13/2026\tX\t12,5\t", ENV);
    expect(r.rows[0]!.valid).toBe(false);
    expect(Object.keys(r.rows[0]!.errors).sort()).toEqual(["metricDate", "responsibleDisplay", "units"]);
    expect(r.rows[0]!.raw.units).toBe("12,5");
  });
  it("producto vacío es válido (el producto es opcional)", () => {
    const r = interpretMetricsPaste("15/10/2026\t\t100\tAna", ENV);
    expect(r.rows[0]).toMatchObject({ product: null, valid: true });
  });
});

describe("clave natural y revalidación del servidor", () => {
  it("ignora mayúsculas, tildes y espacios del producto y del responsable", () => {
    const a = metricNaturalKey({ sector: "ENVASADO_MASIVO", metricDate: "2026-10-15", product: "Sérum  Facial", responsibleDisplay: " Ana  Pérez" });
    const b = metricNaturalKey({ sector: "ENVASADO_MASIVO", metricDate: "2026-10-15", product: "SERUM  FACIAL", responsibleDisplay: "ana pérez" });
    expect(a.replace(/\s+/g, " ")).toBe(b.replace(/\s+/g, " "));
  });
  it("validateImportRow rechaza lo que el navegador debió filtrar", () => {
    expect(validateImportRow({ metricDate: "2026-10-15", units: 10.5, responsibleDisplay: "A", sector: "ENVASADO_MASIVO" }).ok).toBe(false);
    expect(validateImportRow({ metricDate: "2026-10-15", units: 10, responsibleDisplay: "", sector: "ENVASADO_MASIVO" }).ok).toBe(false);
    expect(validateImportRow({ metricDate: "2026-10-15", units: 10, responsibleDisplay: "A", sector: "CALIDAD" }).ok).toBe(false);
    expect(validateImportRow({ metricDate: "2026-10-15", units: 10, responsibleDisplay: "A", sector: "ENVASADO_PREMIUM" }).ok).toBe(true);
  });
});
