import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ENV_KEYS = [
  "GENUS_FILE_STORAGE",
  "BLOB_STORE_ID",
  "VERCEL_OIDC_TOKEN",
  "BLOB_READ_WRITE_TOKEN",
  "BLOB_WEBHOOK_PUBLIC_KEY",
  "VERCEL",
] as const;

function clearBlobEnv() {
  for (const k of ENV_KEYS) delete process.env[k];
}

describe("file-storage OIDC / config", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
    }
    clearBlobEnv();
    process.env.GENUS_FILE_STORAGE = "vercel_blob";
  });

  afterEach(() => {
    clearBlobEnv();
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    vi.resetModules();
  });

  it("OIDC configurado con BLOB_STORE_ID + VERCEL_OIDC_TOKEN", async () => {
    process.env.BLOB_STORE_ID = "store_test_oidc";
    process.env.VERCEL_OIDC_TOKEN = "oidc.jwt.test";
    const {
      getBlobAuthMode,
      isPrivateFileStorageConfigured,
      getStorageHealth,
      resolveBlobAuthOptions,
    } = await import("./file-storage");
    expect(isPrivateFileStorageConfigured()).toBe(true);
    expect(getBlobAuthMode()).toBe("OIDC");
    const health = getStorageHealth();
    expect(health).toEqual({
      provider: "VERCEL_BLOB_PRIVATE",
      configured: true,
      authMode: "OIDC",
      storeConfigured: true,
    });
    const auth = resolveBlobAuthOptions();
    expect(auth.storeId).toBe("store_test_oidc");
    expect(auth.oidcToken).toBe("oidc.jwt.test");
    expect(auth.token).toBeUndefined();
  });

  it("OIDC en Vercel con store y sin token explícito (runtime)", async () => {
    process.env.BLOB_STORE_ID = "store_preview";
    process.env.VERCEL = "1";
    const { getBlobAuthMode, isPrivateFileStorageConfigured } = await import(
      "./file-storage"
    );
    expect(isPrivateFileStorageConfigured()).toBe(true);
    expect(getBlobAuthMode()).toBe("OIDC");
  });

  it("Token legacy BLOB_READ_WRITE_TOKEN como fallback local", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_test";
    const {
      getBlobAuthMode,
      isPrivateFileStorageConfigured,
      resolveBlobAuthOptions,
      getStorageHealth,
    } = await import("./file-storage");
    expect(isPrivateFileStorageConfigured()).toBe(true);
    expect(getBlobAuthMode()).toBe("TOKEN");
    expect(resolveBlobAuthOptions()).toEqual({ token: "vercel_blob_rw_test" });
    expect(getStorageHealth().storeConfigured).toBe(false);
  });

  it("OIDC tiene prioridad sobre token legacy", async () => {
    process.env.BLOB_STORE_ID = "store_x";
    process.env.VERCEL_OIDC_TOKEN = "oidc.x";
    process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_ignored";
    const { getBlobAuthMode, resolveBlobAuthOptions } = await import("./file-storage");
    expect(getBlobAuthMode()).toBe("OIDC");
    expect(resolveBlobAuthOptions().token).toBeUndefined();
  });

  it("ninguna autenticación configurada", async () => {
    const {
      getBlobAuthMode,
      isPrivateFileStorageConfigured,
      FILE_STORAGE_NOT_CONFIGURED,
      assertPrivateFileStorageConfigured,
      getStorageHealth,
    } = await import("./file-storage");
    expect(isPrivateFileStorageConfigured()).toBe(false);
    expect(getBlobAuthMode()).toBe("NONE");
    expect(getStorageHealth()).toEqual({
      provider: "VERCEL_BLOB_PRIVATE",
      configured: false,
      authMode: "NONE",
      storeConfigured: false,
    });
    expect(() => assertPrivateFileStorageConfigured()).toThrow(
      FILE_STORAGE_NOT_CONFIGURED,
    );
  });

  it("BLOB_WEBHOOK_PUBLIC_KEY no autentica uploads", async () => {
    process.env.BLOB_WEBHOOK_PUBLIC_KEY = "pk_webhook_only";
    const {
      isPrivateFileStorageConfigured,
      getBlobAuthMode,
      hasBlobWebhookPublicKey,
      resolveBlobAuthOptions,
      FILE_STORAGE_NOT_CONFIGURED,
    } = await import("./file-storage");
    expect(hasBlobWebhookPublicKey()).toBe(true);
    expect(isPrivateFileStorageConfigured()).toBe(false);
    expect(getBlobAuthMode()).toBe("NONE");
    expect(() => resolveBlobAuthOptions()).toThrow(FILE_STORAGE_NOT_CONFIGURED);
  });

  it("solo BLOB_STORE_ID sin OIDC ni Vercel no alcanza", async () => {
    process.env.BLOB_STORE_ID = "store_alone";
    const { isPrivateFileStorageConfigured, getBlobAuthMode } = await import(
      "./file-storage"
    );
    expect(isPrivateFileStorageConfigured()).toBe(false);
    expect(getBlobAuthMode()).toBe("NONE");
  });

  it("health nunca expone IDs, tokens ni claves", async () => {
    process.env.BLOB_STORE_ID = "store_secret_id_abc";
    process.env.VERCEL_OIDC_TOKEN = "super.secret.oidc.jwt";
    process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_secret";
    process.env.BLOB_WEBHOOK_PUBLIC_KEY = "webhook_pk_secret";
    const { getStorageHealth } = await import("./file-storage");
    const health = getStorageHealth();
    const json = JSON.stringify(health);
    expect(json).not.toContain("store_secret_id_abc");
    expect(json).not.toContain("super.secret");
    expect(json).not.toContain("vercel_blob_rw_secret");
    expect(json).not.toContain("webhook_pk_secret");
    expect(Object.keys(health).sort()).toEqual([
      "authMode",
      "configured",
      "provider",
      "storeConfigured",
    ]);
  });

  it("keys coa/remito + upload/get/delete con adapter mock", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_test";
    const {
      getFileStorage,
      resetMemoryFileStorageForTests,
      coaStorageKey,
      remitoStorageKey,
      sha256Hex,
    } = await import("./file-storage");
    resetMemoryFileStorageForTests();
    const storage = getFileStorage();
    const key = coaStorageKey({
      folderId: "f1",
      fileId: "file1",
      version: 1,
      fileName: "coa.pdf",
    });
    expect(key).toBe("coas/f1/file1/v1/coa.pdf");
    expect(
      remitoStorageKey({ year: 2026, remitoId: "r1", version: 2, kind: "xlsx" }),
    ).toBe("remitos/2026/r1/v2/remito.xlsx");
    const { remitoClientPathSlug } = await import("./file-storage");
    const slug = remitoClientPathSlug({
      clientDisplay: "THELMA Y LOUISE",
      clientIdNormalized: "thelma y louise",
    });
    expect(slug.startsWith("thelma-y-louise--")).toBe(true);
    expect(
      remitoStorageKey({
        remitoId: "r2",
        version: 1,
        kind: "xlsx",
        clientSlug: slug,
      }),
    ).toBe(`remitos/${slug}/r2/v1/remito.xlsx`);

    const bytes = Buffer.from("contenido-privado");
    const put = await storage.put({
      storageKey: key,
      bytes,
      contentType: "application/pdf",
    });
    expect(put.sha256).toBe(sha256Hex(bytes));
    expect(put.url.startsWith("http")).toBe(false);

    const got = await storage.get(key);
    expect(got.bytes.toString()).toBe("contenido-privado");
    expect(await storage.exists(key)).toBe(true);
    await storage.delete(key);
    expect(await storage.exists(key)).toBe(false);
  });
});
