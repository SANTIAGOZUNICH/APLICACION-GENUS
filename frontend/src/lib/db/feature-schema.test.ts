/**
 * Pruebas de gate schema-pending y COA sin metadata huérfana.
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertFeatureWritesEnabled,
  isFeatureMemoryAllowed,
  resetFeatureSchemaCache,
  SchemaPendingError,
} from "./feature-schema";
import {
  getCoaService,
  resetCoaMemoryForTests,
} from "@/lib/coa/coa-service";

describe("feature schema gate", () => {
  afterEach(() => {
    resetFeatureSchemaCache();
    vi.unstubAllEnvs();
  });

  it("en vitest permite memoria", () => {
    expect(isFeatureMemoryAllowed()).toBe(true);
  });

  it("sin memoria ni DB lista, assertFeatureWritesEnabled falla", async () => {
    vi.stubEnv("VITEST", "false");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("GENUS_FEATURE_MEMORY", "");
    resetFeatureSchemaCache();
    // Sin DATABASE_URL → isFeatureSchemaReady false
    vi.stubEnv("DATABASE_URL", "");
    await expect(assertFeatureWritesEnabled()).rejects.toBeInstanceOf(
      SchemaPendingError
    );
  });
});

describe("COA — fallo Drive no deja metadata", () => {
  beforeEach(() => {
    resetCoaMemoryForTests();
  });

  it("upload en memoria versiona y download funciona", async () => {
    const svc = getCoaService();
    const mp = { email: "mp@test", sector: "MATERIA_PRIMA" as const };
    const folder = await svc.createFolder(mp, "Lotes", null);
    const file = await svc.upload(mp, {
      folderId: folder.id,
      fileName: "coa.pdf",
      mimeType: "application/pdf",
      bytes: Buffer.from("%PDF-mem"),
    });
    const dl = await svc.downloadVersion(mp, file.id, 1);
    expect(dl.bytes.toString()).toContain("%PDF-mem");

    await svc.renameFolder(mp, folder.id, "Lotes-v2");
    const listed = await svc.list(mp, null);
    expect(listed.folders[0]?.name).toBe("Lotes-v2");

    const empty = await svc.createFolder(mp, "Vacia", null);
    await svc.archiveFolder(mp, empty.id);
    const after = await svc.list(mp, null);
    expect(after.folders.some((f) => f.name === "Vacia")).toBe(false);
  });

  it("archiva carpeta con archivos (soft); hard delete rechaza no vacía", async () => {
    const svc = getCoaService();
    const mp = { email: "mp@test", sector: "MATERIA_PRIMA" as const };
    const folder = await svc.createFolder(mp, "ConArchivos", null);
    await svc.upload(mp, {
      folderId: folder.id,
      fileName: "a.pdf",
      mimeType: "application/pdf",
      bytes: Buffer.from("%PDF"),
    });
    await svc.archiveFolder(mp, folder.id);
    const archived = await svc.list(mp, null, { includeArchived: true });
    expect(archived.folders.some((f) => f.name === "ConArchivos")).toBe(true);
    await expect(svc.hardDeleteFolder(mp, folder.id)).rejects.toThrow(/vacía/);
  });
});
