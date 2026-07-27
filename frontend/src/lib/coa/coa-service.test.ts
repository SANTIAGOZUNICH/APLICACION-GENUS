import { describe, expect, it, beforeEach, vi } from "vitest";
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

  it("elimina archivo y versiones en memoria (MP admin)", async () => {
    const storageMod = await import("@/lib/storage/file-storage");
    const deleted: string[] = [];
    vi.spyOn(storageMod, "getFileStorage").mockReturnValue({
      put: async ({ storageKey, bytes }: { storageKey: string; bytes: Buffer }) => ({
        provider: "VERCEL_BLOB_PRIVATE",
        storageKey,
        url: "https://example.invalid",
        sizeBytes: bytes.length,
        contentType: "application/pdf",
        sha256: "abc",
      }),
      get: async () => ({ storageKey: "k", bytes: Buffer.from("x"), contentType: null, sizeBytes: 1 }),
      delete: async (key: string) => {
        deleted.push(key);
      },
      head: async () => ({ storageKey: "k", sizeBytes: 1, contentType: null }),
    } as never);

    const svc = getCoaService();
    const mp = { email: "mp@test", sector: "MATERIA_PRIMA" as const };
    const folder = await svc.createFolder(mp, "Lotes", null);
    const file = await svc.upload(mp, {
      folderId: folder.id,
      fileName: "coa.pdf",
      mimeType: "application/pdf",
      bytes: Buffer.from("%PDF-1.4"),
    });
    await svc.upload(mp, {
      folderId: folder.id,
      fileName: "coa.pdf",
      mimeType: "application/pdf",
      bytes: Buffer.from("%PDF-1.5"),
      replaceFileId: file.id,
    });
    const result = await svc.archiveFile(mp, file.id, "prueba");
    expect(result.versionsDeleted).toBe(2);
    expect(deleted.length).toBeGreaterThanOrEqual(2);
    expect(await svc.getFile(file.id)).toBeNull();
    await expect(
      svc.archiveFile({ email: "p@test", sector: "PRODUCCION" }, file.id)
    ).rejects.toThrow(/Solo MP/);
  });

  it("eliminar versión vigente promueve la anterior", async () => {
    const storageMod = await import("@/lib/storage/file-storage");
    const keys = new Map<string, Buffer>();
    vi.spyOn(storageMod, "getFileStorage").mockReturnValue({
      put: async ({
        storageKey,
        bytes,
      }: {
        storageKey: string;
        bytes: Buffer;
      }) => {
        keys.set(storageKey, bytes);
        return {
          provider: "VERCEL_BLOB_PRIVATE",
          storageKey,
          url: "https://example.invalid",
          sizeBytes: bytes.length,
          contentType: "application/pdf",
          sha256: "abc",
        };
      },
      get: async (key: string) => ({
        storageKey: key,
        bytes: keys.get(key) ?? Buffer.from("x"),
        contentType: "application/pdf",
        sizeBytes: 1,
      }),
      delete: async (key: string) => {
        keys.delete(key);
      },
      head: async (key: string) => ({
        storageKey: key,
        sizeBytes: keys.get(key)?.length ?? 0,
        contentType: "application/pdf",
      }),
    } as never);

    const svc = getCoaService();
    const mp = { email: "mp@test", sector: "MATERIA_PRIMA" as const };
    const folder = await svc.createFolder(mp, "V", null);
    const file = await svc.upload(mp, {
      folderId: folder.id,
      fileName: "v.pdf",
      mimeType: "application/pdf",
      bytes: Buffer.from("v1"),
    });
    await svc.upload(mp, {
      folderId: folder.id,
      fileName: "v.pdf",
      mimeType: "application/pdf",
      bytes: Buffer.from("v2"),
      replaceFileId: file.id,
    });
    const before = await svc.getFile(file.id);
    expect(before?.currentVersion).toBe(2);
    const del = await svc.deleteVersion(mp, file.id, 2, "rollback");
    expect(del.currentVersion).toBe(1);
    const after = await svc.getFile(file.id);
    expect(after?.currentVersion).toBe(1);
    const versions = await svc.listVersions(mp, file.id);
    expect(versions).toHaveLength(1);
    expect(versions[0]?.version).toBe(1);
  });
});
