import { describe, expect, it, beforeEach } from "vitest";
import {
  coaStorageKey,
  getFileStorage,
  remitoStorageKey,
  resetMemoryFileStorageForTests,
  safeFileName,
  sha256Hex,
  FILE_STORAGE_NOT_CONFIGURED,
  isPrivateFileStorageConfigured,
} from "./file-storage";

describe("FileStorageAdapter (memory in tests)", () => {
  beforeEach(() => {
    resetMemoryFileStorageForTests();
  });

  it("put/get/exists/metadata/delete + sha256", async () => {
    const storage = getFileStorage();
    const bytes = Buffer.from("%PDF-1.4 smoke test");
    const key = coaStorageKey({
      folderId: "folder-1",
      fileId: "file-1",
      version: 1,
      fileName: "COA Glicerina.pdf",
    });
    const put = await storage.put({
      storageKey: key,
      bytes,
      contentType: "application/pdf",
    });
    expect(put.provider).toBe("VERCEL_BLOB_PRIVATE");
    expect(put.storageKey).toBe(key);
    expect(put.sha256).toBe(sha256Hex(bytes));
    expect(put.sizeBytes).toBe(bytes.length);

    expect(await storage.exists(key)).toBe(true);
    const meta = await storage.metadata(key);
    expect(meta?.sizeBytes).toBe(bytes.length);

    const got = await storage.get(key);
    expect(got.bytes.equals(bytes)).toBe(true);
    expect(got.sha256).toBe(put.sha256);

    await storage.delete(key);
    expect(await storage.exists(key)).toBe(false);
  });

  it("compensa: delete parcial no deja blob", async () => {
    const storage = getFileStorage();
    const k1 = remitoStorageKey({
      year: 2026,
      remitoId: "r1",
      version: 1,
      kind: "pdf",
    });
    const k2 = remitoStorageKey({
      year: 2026,
      remitoId: "r1",
      version: 1,
      kind: "xlsx",
    });
    await storage.put({
      storageKey: k1,
      bytes: Buffer.from("pdf"),
      contentType: "application/pdf",
    });
    await storage.put({
      storageKey: k2,
      bytes: Buffer.from("xlsx"),
      contentType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    await storage.delete(k1);
    await storage.delete(k2);
    expect(await storage.exists(k1)).toBe(false);
    expect(await storage.exists(k2)).toBe(false);
  });

  it("safeFileName strips path traversal", () => {
    expect(safeFileName("../x/y.pdf")).toBe("xy.pdf");
    expect(safeFileName("ok name.xlsx")).toContain("ok");
  });

  it("FILE_STORAGE_NOT_CONFIGURED message is stable", () => {
    expect(FILE_STORAGE_NOT_CONFIGURED).toMatch(/Almacenamiento privado/);
    // In vitest memory adapter is used; config helper still reflects env.
    expect(typeof isPrivateFileStorageConfigured()).toBe("boolean");
  });
});
