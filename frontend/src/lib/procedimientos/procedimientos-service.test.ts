import { describe, expect, it, beforeEach, vi } from "vitest";
import { validateProcedureUpload } from "./upload-validation";
import { getProcedimientosService, resetProcedimientosMemoryForTests } from "./procedimientos-service";
import { OrdersForbiddenError } from "@/lib/orders/types";

describe("ProcedimientosService memoria", () => {
  beforeEach(() => {
    resetProcedimientosMemoryForTests();
    vi.stubEnv("GENUS_FEATURE_MEMORY", "1");
  });

  it("crea carpeta y sube archivo", async () => {
    const storageMod = await import("@/lib/storage/file-storage");
    vi.spyOn(storageMod, "getFileStorage").mockReturnValue({
      put: async ({ storageKey, bytes }: { storageKey: string; bytes: Buffer }) => ({
        provider: "VERCEL_BLOB_PRIVATE",
        storageKey,
        url: "https://example.invalid",
        sizeBytes: bytes.length,
        contentType: "application/pdf",
        sha256: "abc",
      }),
      get: async () => ({ storageKey: "k", bytes: Buffer.from("x"), contentType: "application/pdf", sizeBytes: 1 }),
      delete: async () => {},
      exists: async () => true,
      metadata: async () => null,
      sha256: () => "abc",
    });

    const svc = getProcedimientosService();
    const actor = { email: "u@test.com", sector: "ELABORACION" as const };
    const folder = await svc.createFolder(actor, "Manuales", null);
    const file = await svc.upload(actor, {
      folderId: folder.id,
      fileName: "guia.pdf",
      mimeType: "application/pdf",
      bytes: Buffer.from("%PDF"),
    });
    expect(file.displayName).toBe("guia.pdf");
    const listed = await svc.list(actor, folder.id);
    expect(listed.files).toHaveLength(1);
  });

  it("403 al mutar recurso ajeno", async () => {
    const svc = getProcedimientosService();
    const owner = { email: "owner@test.com", sector: "ELABORACION" as const };
    const other = { email: "other@test.com", sector: "ELABORACION" as const };
    const folder = await svc.createFolder(owner, "Privada", null);
    await expect(svc.renameFolder(other, folder.id, "Hack")).rejects.toBeInstanceOf(
      OrdersForbiddenError
    );
  });
});

describe("validateProcedureUpload", () => {
  it("rechaza exe", () => {
    expect(() =>
      validateProcedureUpload({
        fileName: "bad.exe",
        mimeType: "application/octet-stream",
        sizeBytes: 10,
      })
    ).toThrow(/Extensión/);
  });
});
