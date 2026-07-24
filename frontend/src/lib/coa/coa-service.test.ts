import { describe, expect, it, beforeEach } from "vitest";
import { validateCoaUpload } from "./drive-write";
import { canAdminCoas, canViewCoas } from "./types";
import { getCoaService, resetCoaMemoryForTests } from "./coa-service";

describe("COA RBAC y validación", () => {
  it("RBAC: MP admin; Producción/Calidad ven; Elaboración no", () => {
    expect(canAdminCoas("MATERIA_PRIMA")).toBe(true);
    expect(canAdminCoas("PRODUCCION")).toBe(false);
    expect(canViewCoas("PRODUCCION")).toBe(true);
    expect(canViewCoas("CALIDAD")).toBe(true);
    expect(canViewCoas("ELABORACION")).toBe(false);
  });

  it("rechaza MIME/extensión inválidos", () => {
    expect(() =>
      validateCoaUpload({
        fileName: "x.exe",
        mimeType: "application/octet-stream",
        sizeBytes: 10,
      })
    ).toThrow(/Extensión/);
    expect(() =>
      validateCoaUpload({
        fileName: "ok.pdf",
        mimeType: "application/pdf",
        sizeBytes: 10,
      })
    ).not.toThrow();
  });
});

describe("CoaService memoria", () => {
  beforeEach(() => resetCoaMemoryForTests());

  it("crea carpeta y versiona reemplazo", async () => {
    const svc = getCoaService();
    const mp = { email: "mp@test", sector: "MATERIA_PRIMA" as const };
    const folder = await svc.createFolder(mp, "Lotes", null);
    expect(folder.name).toBe("Lotes");

    const file = await svc.upload(mp, {
      folderId: folder.id,
      fileName: "coa.pdf",
      mimeType: "application/pdf",
      bytes: Buffer.from("%PDF-1.4"),
    });
    expect(file.currentVersion).toBe(1);

    const replaced = await svc.upload(mp, {
      folderId: folder.id,
      fileName: "coa.pdf",
      mimeType: "application/pdf",
      bytes: Buffer.from("%PDF-1.5-new"),
      replaceFileId: file.id,
    });
    expect(replaced.currentVersion).toBe(2);
    expect(replaced.id).toBe(file.id);
  });

  it("Producción no puede crear carpetas", async () => {
    const svc = getCoaService();
    await expect(
      svc.createFolder(
        { email: "p@test", sector: "PRODUCCION" },
        "X",
        null
      )
    ).rejects.toThrow(/Solo MP/);
  });
});
