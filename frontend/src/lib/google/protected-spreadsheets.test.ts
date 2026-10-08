/** Las planillas ORIGINALES nunca son escribibles, aunque estén (por error) en una allowlist de write-back. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { OFFICIAL_ASIGNACION_LOTES_SPREADSHEETS } from "@/lib/asignacion-lotes/official-sources";
import { isWritebackEnabledFor } from "@/lib/asignacion-lotes/writeback-ops";
import { isSemanasWritable } from "@/lib/semanas-sheet/semanas-sheet-service";
import { isProtectedOriginalSpreadsheet } from "./protected-spreadsheets";

const [OFICIAL_2025, OFICIAL_2026] = OFFICIAL_ASIGNACION_LOTES_SPREADSHEETS.map((s) => s.spreadsheetId);
const COPIA = "copia-de-prueba-asignacion";

afterEach(() => vi.unstubAllEnvs());

describe("planillas originales protegidas", () => {
  it("las dos oficiales de Asignación (2025/2026) están protegidas siempre", () => {
    expect(isProtectedOriginalSpreadsheet(OFICIAL_2025!)).toBe(true);
    expect(isProtectedOriginalSpreadsheet(OFICIAL_2026!)).toBe(true);
    expect(isProtectedOriginalSpreadsheet(COPIA)).toBe(false);
  });

  it("GENUS_PROTECTED_SPREADSHEET_IDS agrega originales (p. ej. SEMANAS 2026)", () => {
    vi.stubEnv("GENUS_PROTECTED_SPREADSHEET_IDS", " semanas-original , otra ");
    expect(isProtectedOriginalSpreadsheet("semanas-original")).toBe(true);
    expect(isProtectedOriginalSpreadsheet("otra")).toBe(true);
  });

  it("Asignación: una original en la allowlist con la flag activa NO es escribible; la copia sí", () => {
    vi.stubEnv("ASIGNACION_LOTES_WRITEBACK", "1");
    vi.stubEnv("ASIGNACION_LOTES_WRITEBACK_SPREADSHEET_IDS", `${OFICIAL_2025},${OFICIAL_2026},${COPIA}`);
    expect(isWritebackEnabledFor(OFICIAL_2025!)).toBe(false);
    expect(isWritebackEnabledFor(OFICIAL_2026!)).toBe(false);
    expect(isWritebackEnabledFor(COPIA)).toBe(true);
    vi.stubEnv("VERCEL_ENV", "production");
    expect(isWritebackEnabledFor(COPIA)).toBe(false);
  });

  it("Semanas: un id protegido en la allowlist con la flag activa NO es escribible", () => {
    vi.stubEnv("SEMANAS_WRITEBACK", "1");
    vi.stubEnv("SEMANAS_WRITEBACK_SPREADSHEET_IDS", "semanas-original,semanas-copia");
    vi.stubEnv("GENUS_PROTECTED_SPREADSHEET_IDS", "semanas-original");
    expect(isSemanasWritable("semanas-original")).toBe(false);
    expect(isSemanasWritable("semanas-copia")).toBe(true);
  });
});
