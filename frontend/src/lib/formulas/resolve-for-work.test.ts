import { beforeEach, describe, expect, it, vi } from "vitest";

const bankLookup = vi.fn();
const hasCreds = vi.fn(() => true);
const drive = {
  syncDriveFormulasIndex: vi.fn(),
  listDriveClientsCached: vi.fn(),
  searchDriveProducts: vi.fn(),
  resolveFormulaFromDriveFile: vi.fn(),
};

vi.mock("server-only", () => ({}));
vi.mock("./get-formula-bank", () => ({ readyFormulaBank: async () => ({ resolveLookup: bankLookup }) }));
vi.mock("@/lib/adapters/google/google-auth", () => ({ hasGoogleCredentials: () => hasCreds() }));
vi.mock("./drive-formulas-index", () => drive);

const { resolveFormulaForWork } = await import("./resolve-for-work");
const NOT_IN_BANK = { kind: "not_found", reason: "name_mismatch", message: "No se encontró por diferencia de nombre." };

beforeEach(() => {
  vi.clearAllMocks();
  hasCreds.mockReturnValue(true);
  bankLookup.mockReturnValue(NOT_IN_BANK);
  drive.syncDriveFormulasIndex.mockResolvedValue({ ok: true });
  drive.listDriveClientsCached.mockResolvedValue(["ACME"]);
  drive.searchDriveProducts.mockResolvedValue([]);
});

describe("resolveFormulaForWork — causa comprobada cuando no hay fórmula", () => {
  it("conflicto en el banco", async () => {
    bankLookup.mockReturnValue({ kind: "conflict", message: "Dos versiones vigentes." });
    expect(await resolveFormulaForWork({ client: "ACME", product: "CREMA" })).toMatchObject({ ok: false, cause: "BANCO_CONFLICTO" });
  });

  it("no está en el banco y Drive no está configurado: lo dice, no supone que no existe", async () => {
    hasCreds.mockReturnValue(false);
    const r = await resolveFormulaForWork({ client: "ACME", product: "CREMA" });
    expect(r).toMatchObject({ ok: false, cause: "DRIVE_SIN_CONFIGURAR" });
    expect(!r.ok && r.message).toMatch(/no está en el banco de fórmulas y Google Drive no está configurado/);
  });

  it("no está en el banco y la cuenta no puede abrir la carpeta", async () => {
    drive.syncDriveFormulasIndex.mockResolvedValue({ ok: false, error: "Sin acceso a la carpeta de fórmulas en Drive." });
    const r = await resolveFormulaForWork({ client: "ACME", product: "CREMA" });
    expect(r).toMatchObject({ ok: false, cause: "DRIVE_SIN_ACCESO" });
    expect(!r.ok && r.message).toMatch(/no se sabe si está ahí/);
  });

  it("no está en el banco y no hay carpeta del cliente en Drive", async () => {
    drive.listDriveClientsCached.mockResolvedValue(["BETA"]);
    expect(await resolveFormulaForWork({ client: "ACME", product: "CREMA" })).toMatchObject({ ok: false, cause: "NO_EN_BANCO_SIN_CARPETA_CLIENTE" });
  });

  it("no está en el banco y la carpeta del cliente no tiene ese producto (nombre exacto)", async () => {
    drive.searchDriveProducts.mockResolvedValue([{ productLabel: "CREMA CORPORAL", fileId: "f", fileName: "CREMA CORPORAL.xlsx" }]);
    const r = await resolveFormulaForWork({ client: "acme", product: "CREMA" });
    expect(r).toMatchObject({ ok: false, cause: "NO_EN_BANCO_SIN_ARCHIVO" });
  });

  it("dos archivos coinciden en Drive", async () => {
    drive.searchDriveProducts.mockResolvedValue([
      { productLabel: "CREMA", fileId: "1", fileName: "CREMA.xlsx" },
      { productLabel: "crema", fileId: "2", fileName: "crema (1).xlsx" },
    ]);
    expect(await resolveFormulaForWork({ client: "ACME", product: "CREMA" })).toMatchObject({ ok: false, cause: "DRIVE_AMBIGUA" });
  });

  it("archivo encontrado pero ilegible", async () => {
    drive.searchDriveProducts.mockResolvedValue([{ productLabel: "CREMA", fileId: "1", fileName: "CREMA.xlsx" }]);
    drive.resolveFormulaFromDriveFile.mockResolvedValue({ found: false, message: "No se pudo parsear." });
    expect(await resolveFormulaForWork({ client: "ACME", product: "CREMA" })).toMatchObject({ ok: false, cause: "DRIVE_ILEGIBLE" });
  });

  it("error inesperado leyendo Drive", async () => {
    drive.syncDriveFormulasIndex.mockRejectedValue(new Error("boom"));
    expect(await resolveFormulaForWork({ client: "ACME", product: "CREMA" })).toMatchObject({ ok: false, cause: "DRIVE_ERROR" });
  });
});
