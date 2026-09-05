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

/**
 * Regresión (Procedimientos, archivos >4.5MB): subir el archivo entero por
 * multipart/form-data al servidor choca con el límite de payload de las
 * funciones serverless de Vercel (~4.5MB, `FUNCTION_PAYLOAD_TOO_LARGE`,
 * confirmado en Production) — el archivo nunca llega ni a validarse. La
 * subida directa cliente→Blob evita esto: el cliente sube los bytes con un
 * token de un solo uso y el servidor solo persiste metadatos.
 */
describe("ProcedimientosService — subida directa a Blob (archivos grandes)", () => {
  beforeEach(() => {
    resetProcedimientosMemoryForTests();
    vi.stubEnv("GENUS_FEATURE_MEMORY", "1");
  });

  it("prepareBlobUpload emite token y resuelve fileId/storageKey para un archivo nuevo", async () => {
    const storageMod = await import("@/lib/storage/file-storage");
    vi.spyOn(storageMod, "createClientUploadToken").mockResolvedValue("fake-client-token");

    const svc = getProcedimientosService();
    const actor = { email: "u@test.com", sector: "ELABORACION" as const };
    const folder = await svc.createFolder(actor, "Grandes", null);

    const prepared = await svc.prepareBlobUpload(actor, {
      folderId: folder.id,
      fileName: "grande.pdf",
      mimeType: "application/pdf",
      sizeBytes: 6 * 1024 * 1024,
    });

    expect(prepared.token).toBe("fake-client-token");
    expect(prepared.version).toBe(1);
    expect(prepared.storageKey).toContain(folder.id);
    expect(prepared.storageKey).toContain(prepared.fileId);
  });

  it("prepareBlobUpload rechaza tipos/tamaños inválidos antes de emitir token (mismas reglas que upload())", async () => {
    const svc = getProcedimientosService();
    const actor = { email: "u@test.com", sector: "ELABORACION" as const };
    const folder = await svc.createFolder(actor, "Grandes", null);

    await expect(
      svc.prepareBlobUpload(actor, {
        folderId: folder.id,
        fileName: "malware.exe",
        mimeType: "application/octet-stream",
        sizeBytes: 6 * 1024 * 1024,
      })
    ).rejects.toThrow(/Extensión/);
  });

  it("completeBlobUpload persiste metadatos sin volver a escribir el blob (ya subido por el cliente)", async () => {
    const storageMod = await import("@/lib/storage/file-storage");
    const putSpy = vi.fn();
    vi.spyOn(storageMod, "getFileStorage").mockReturnValue({
      put: putSpy,
      get: async () => ({ storageKey: "k", bytes: Buffer.from("x"), contentType: "application/pdf", sizeBytes: 1 }),
      delete: async () => {},
      exists: async () => true,
      metadata: async () => ({
        storageKey: "procedimientos/f1/file1/v1/grande.pdf",
        sizeBytes: 6 * 1024 * 1024,
        contentType: "application/pdf",
      }),
      sha256: () => "abc",
    });

    const svc = getProcedimientosService();
    const actor = { email: "u@test.com", sector: "ELABORACION" as const };
    const folder = await svc.createFolder(actor, "Grandes", null);
    const fileId = "11111111-1111-1111-1111-111111111111";

    const file = await svc.completeBlobUpload(actor, {
      folderId: folder.id,
      fileId,
      version: 1,
      fileName: "grande.pdf",
      mimeType: "application/pdf",
      storageKey: "procedimientos/f1/file1/v1/grande.pdf",
      sizeBytes: 6 * 1024 * 1024,
      sha256: "deadbeef",
    });

    expect(file.id).toBe(fileId);
    expect(file.sizeBytes).toBe(6 * 1024 * 1024);
    expect(file.sha256).toBe("deadbeef");
    expect(putSpy).not.toHaveBeenCalled();

    const listed = await svc.list(actor, folder.id);
    expect(listed.files).toHaveLength(1);
    expect(listed.files[0]!.displayName).toBe("grande.pdf");
  });

  it("completeBlobUpload rechaza si el tamaño real en Blob no coincide con lo declarado (no confía ciegamente en el cliente)", async () => {
    const storageMod = await import("@/lib/storage/file-storage");
    vi.spyOn(storageMod, "getFileStorage").mockReturnValue({
      put: vi.fn(),
      get: async () => ({ storageKey: "k", bytes: Buffer.from("x"), contentType: "application/pdf", sizeBytes: 1 }),
      delete: async () => {},
      exists: async () => true,
      metadata: async () => ({
        storageKey: "procedimientos/f1/file1/v1/grande.pdf",
        sizeBytes: 123, // no coincide con lo declarado abajo
        contentType: "application/pdf",
      }),
      sha256: () => "abc",
    });

    const svc = getProcedimientosService();
    const actor = { email: "u@test.com", sector: "ELABORACION" as const };
    const folder = await svc.createFolder(actor, "Grandes", null);

    await expect(
      svc.completeBlobUpload(actor, {
        folderId: folder.id,
        fileId: "22222222-2222-2222-2222-222222222222",
        version: 1,
        fileName: "grande.pdf",
        mimeType: "application/pdf",
        storageKey: "procedimientos/f1/file1/v1/grande.pdf",
        sizeBytes: 6 * 1024 * 1024,
        sha256: "deadbeef",
      })
    ).rejects.toThrow(/no coincide/);
  });

  it("completeBlobUpload 403 al agregar nueva versión de un archivo ajeno", async () => {
    const storageMod = await import("@/lib/storage/file-storage");
    vi.spyOn(storageMod, "getFileStorage").mockReturnValue({
      put: vi.fn(),
      get: async () => ({ storageKey: "k", bytes: Buffer.from("x"), contentType: "application/pdf", sizeBytes: 1 }),
      delete: async () => {},
      exists: async () => true,
      metadata: async () => ({
        storageKey: "k",
        sizeBytes: 6 * 1024 * 1024,
        contentType: "application/pdf",
      }),
      sha256: () => "abc",
    });

    const svc = getProcedimientosService();
    const owner = { email: "owner@test.com", sector: "ELABORACION" as const };
    const other = { email: "other@test.com", sector: "ELABORACION" as const };
    const folder = await svc.createFolder(owner, "Grandes", null);
    const existing = await svc.completeBlobUpload(owner, {
      folderId: folder.id,
      fileId: "33333333-3333-3333-3333-333333333333",
      version: 1,
      fileName: "grande.pdf",
      mimeType: "application/pdf",
      storageKey: "k1",
      sizeBytes: 6 * 1024 * 1024,
      sha256: "aaa",
    });

    await expect(
      svc.completeBlobUpload(other, {
        folderId: folder.id,
        fileId: existing.id,
        version: 2,
        fileName: "grande.pdf",
        mimeType: "application/pdf",
        storageKey: "k2",
        sizeBytes: 6 * 1024 * 1024,
        sha256: "bbb",
        mode: "new_version",
        existingFileId: existing.id,
      })
    ).rejects.toBeInstanceOf(OrdersForbiddenError);
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
