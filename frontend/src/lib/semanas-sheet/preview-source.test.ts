import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import { isPreviewSourceAllowed, resetPreviewWorkbook, savePreviewWorkbook, validateSemanasWorkbook, getPreviewStatus, PREVIEW_MAX_BYTES } from "./preview-source";
import { isSemanasWritable, loadSemanasView, usesPreviewSource } from "./semanas-sheet-service";
import { resetMemoryFileStorageForTests } from "@/lib/storage/file-storage";

const BUNDLED = path.resolve(__dirname, "../../../assets/semanas-preview/SEMANAS-2026-copia-de-prueba.xlsx");
const good = () => new Uint8Array(readFileSync(BUNDLED));

describe("fuente de Preview (copia XLSX de SEMANAS 2026)", () => {
  beforeEach(() => resetMemoryFileStorageForTests());
  afterEach(async () => {
    vi.unstubAllEnvs();
    await resetPreviewWorkbook();
  });

  it("solo existe fuera de Production (Preview/desarrollo sí; Production y GENUS_ENV=production jamás)", () => {
    expect(isPreviewSourceAllowed({ VERCEL_ENV: "preview", NODE_ENV: "production" })).toBe(true);
    expect(isPreviewSourceAllowed({ NODE_ENV: "development" })).toBe(true);
    expect(isPreviewSourceAllowed({ VERCEL_ENV: "production" })).toBe(false);
    expect(isPreviewSourceAllowed({ VERCEL_ENV: "preview", GENUS_ENV: "production" })).toBe(false);
    expect(isPreviewSourceAllowed({ NODE_ENV: "production" })).toBe(false);
  });

  it("usa la copia solo en Preview y si no hay una copia de Google ni fixture configurados explícitamente", () => {
    expect(usesPreviewSource({ VERCEL_ENV: "preview" })).toBe(true);
    expect(usesPreviewSource({ VERCEL_ENV: "preview", SEMANAS_SHEET_ID: "copia-google" })).toBe(false);
    expect(usesPreviewSource({ VERCEL_ENV: "production" })).toBe(false);
    expect(usesPreviewSource({ NODE_ENV: "development" })).toBe(false);
  });

  it("valida el libro incluido: pestañas, semanas por pestaña y hash", async () => {
    const s = await validateSemanasWorkbook(good());
    expect(s.sheets).toEqual(expect.arrayContaining(["ELABORACION", "ACONDICIONAMIENTO", "ENTREGAS", "QACONDDIA"]));
    expect(s.weeks.ELABORACION).toBe(12);
    expect(s.weeks.ACONDICIONAMIENTO).toBe(15);
    expect(s.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rechaza vacío, demasiado grande, no-xlsx, dañado, sin pestañas y sin semanas", async () => {
    await expect(validateSemanasWorkbook(new Uint8Array())).rejects.toThrow(/vacío/);
    await expect(validateSemanasWorkbook(new Uint8Array(PREVIEW_MAX_BYTES + 1))).rejects.toThrow(/supera/);
    await expect(validateSemanasWorkbook(new TextEncoder().encode("fecha,cliente\n1,2"))).rejects.toThrow(/no es un archivo \.xlsx/i);
    await expect(validateSemanasWorkbook(new Uint8Array([0x50, 0x4b, 1, 2, 3]))).rejects.toThrow(/dañado/);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["x"]]), "OTRA");
    const noSheets = new Uint8Array(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
    await expect(validateSemanasWorkbook(noSheets)).rejects.toThrow(/Faltan pestañas obligatorias: ELABORACION/);
    const wb2 = XLSX.utils.book_new();
    for (const n of ["ELABORACION", "ACONDICIONAMIENTO", "ENTREGAS", "QACONDDIA"]) XLSX.utils.book_append_sheet(wb2, XLSX.utils.aoa_to_sheet([["vacío"]]), n);
    const noWeeks = new Uint8Array(XLSX.write(wb2, { type: "buffer", bookType: "xlsx" }));
    await expect(validateSemanasWorkbook(noWeeks)).rejects.toThrow(/no tiene semanas/);
  });

  it("en Preview las 4 pestañas se leen de la copia: calendario con responsables y semanas, ENTREGAS/C-DIA con filas, y NUNCA es escribible", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("SEMANAS_WRITEBACK", "1");
    vi.stubEnv("SEMANAS_WRITEBACK_SPREADSHEET_IDS", "preview-xlsx-semanas-2026");
    const elab = await loadSemanasView("ELABORACION", "2026-10-08");
    expect(elab.source).toBe("PREVIEW_XLSX");
    expect(elab.writable).toBe(false);
    expect(isSemanasWritable("preview-xlsx-semanas-2026")).toBe(false);
    expect(elab.weeks).toHaveLength(12);
    expect(elab.dayWidths).toEqual([288, 291, 266, 265, 346]);
    const visible = elab.weeks!.filter((w) => !w.hidden);
    expect(visible.length).toBeGreaterThan(0);
    const names = visible.flatMap((w) => w.rows.filter((r) => r.rowNumber > w.headerRow + 2).map((r) => r.cells[0]!.value)).filter((v) => /^[A-ZÁÉÍÓÚ]+$/.test(v) && ["CRISTIAN", "NICOLAS"].includes(v));
    expect(names.length).toBeGreaterThan(0);
    const acond = await loadSemanasView("ACONDICIONAMIENTO", "2026-10-08");
    expect(acond.weeks).toHaveLength(15);
    expect(acond.weeks!.flatMap((w) => w.rows).some((r) => r.cells.some((c) => c.span === 3))).toBe(true);
    const ent = await loadSemanasView("ENTREGAS", "2026-10-08");
    expect(ent.table!.rows.length).toBeGreaterThan(10);
    const cdia = await loadSemanasView("CDIA", "2026-10-08");
    expect(cdia.table!.rows.length).toBeGreaterThan(10);
    expect(elab.weeks!.flatMap((w) => w.rows).some((r) => r.cells.some((c) => c.format?.bg))).toBe(true);
  });

  it("subir un libro válido lo reemplaza, restaurar vuelve a la copia incluida", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    const before = await getPreviewStatus();
    expect(before.origin).toBe("BUNDLED");
    const saved = await savePreviewWorkbook(good());
    expect(saved.persisted).toBe(true); // storage en memoria bajo vitest
    expect((await getPreviewStatus()).origin).toBe("UPLOADED_STORAGE");
    await resetPreviewWorkbook();
    expect((await getPreviewStatus()).origin).toBe("BUNDLED");
  });
});
