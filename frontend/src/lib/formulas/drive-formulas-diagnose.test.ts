import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/adapters/google/google-auth", () => ({
  hasGoogleCredentials: () => false,
  createGoogleAuth: () => {
    throw new Error("no creds in unit test");
  },
}));

vi.mock("@/lib/adapters/drive/google-drive-gateway", () => ({
  GoogleDriveGateway: class {
    canAccessFolder = async () => false;
    listSubfolders = async () => [];
  },
  OFFICE_SHEET_MIMES: [
    "application/vnd.google-apps.spreadsheet",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
  ],
  FOLDER_MIME: "application/vnd.google-apps.folder",
}));

describe("drive-formulas-diagnose", () => {
  it("sin folder configurado → folderConfigured false", async () => {
    delete process.env.GOOGLE_DRIVE_FORMULAS_FOLDER_ID;
    delete process.env.GOOGLE_DRIVE_PRODUCTOS_FOLDER_ID;
    delete process.env.GOOGLE_DRIVE_ELABORACION_FOLDER_ID;
    const { diagnoseDriveFormulasAccess } = await import(
      "@/lib/formulas/drive-formulas-diagnose"
    );
    const report = await diagnoseDriveFormulasAccess();
    expect(report.folderConfigured).toBe(false);
    expect(report.estructuraCompatible).toBe(false);
    expect(report.notes.length).toBeGreaterThan(0);
  });

  it("preferir GOOGLE_DRIVE_FORMULAS_FOLDER_ID", async () => {
    process.env.GOOGLE_DRIVE_FORMULAS_FOLDER_ID = "formulas-folder";
    process.env.GOOGLE_DRIVE_ELABORACION_FOLDER_ID = "oe-folder";
    const { resolveFormulasFolderId } = await import(
      "@/lib/formulas/drive-formulas-diagnose"
    );
    expect(resolveFormulasFolderId()).toEqual({
      folderId: "formulas-folder",
      envKey: "GOOGLE_DRIVE_FORMULAS_FOLDER_ID",
    });
    delete process.env.GOOGLE_DRIVE_FORMULAS_FOLDER_ID;
    delete process.env.GOOGLE_DRIVE_ELABORACION_FOLDER_ID;
  });
});
