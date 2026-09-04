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

  /**
   * Regresión: antes, `VERCEL==="1"` + BLOB_STORE_ID solo alcanzaban para
   * que hasOidcBlobAuth() asumiera OIDC disponible, sin exigir un
   * VERCEL_OIDC_TOKEN real — falso positivo. Confirmado en producción:
   * correr en Vercel (VERCEL==="1") NO garantiza que VERCEL_OIDC_TOKEN
   * llegue al runtime (depende de que OIDC Federation esté realmente
   * habilitado para ese environment). Sin el token real, debe caer a NONE
   * (o a TOKEN si hay un BLOB_READ_WRITE_TOKEN real — ver test siguiente),
   * nunca reportar OIDC sin haber verificado el token.
   */
  it("estar en Vercel (VERCEL=1) con store pero SIN VERCEL_OIDC_TOKEN real → NONE, nunca un falso OIDC", async () => {
    process.env.BLOB_STORE_ID = "store_preview";
    process.env.VERCEL = "1";
    const { getBlobAuthMode, isPrivateFileStorageConfigured, hasOidcBlobAuth } = await import(
      "./file-storage"
    );
    expect(hasOidcBlobAuth()).toBe(false);
    expect(isPrivateFileStorageConfigured()).toBe(false);
    expect(getBlobAuthMode()).toBe("NONE");
  });

  it("estar en Vercel (VERCEL=1) con store + token real (sin OIDC) → TOKEN, no un falso OIDC", async () => {
    // Reproduce el caso real de Production: BLOB_STORE_ID + BLOB_READ_WRITE_TOKEN
    // presentes, VERCEL_OIDC_TOKEN ausente, corriendo en Vercel.
    process.env.BLOB_STORE_ID = "store_prod";
    process.env.VERCEL = "1";
    process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_prod";
    const { getBlobAuthMode, isPrivateFileStorageConfigured, hasOidcBlobAuth, resolveBlobAuthOptions } =
      await import("./file-storage");
    expect(hasOidcBlobAuth()).toBe(false);
    expect(isPrivateFileStorageConfigured()).toBe(true);
    expect(getBlobAuthMode()).toBe("TOKEN");
    expect(resolveBlobAuthOptions()).toEqual({ token: "vercel_blob_rw_prod" });
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

  /**
   * Regresión real: Production tenía GENUS_FILE_STORAGE="blob" (no
   * "vercel_blob"/"vercel_blob_private") — genusFileStorageEnabled()
   * devolvía false y getBlobAuthMode() cortaba a "NONE" en la primera
   * línea, SIN llegar a evaluar ni OIDC ni el token, aunque ambos podían
   * estar perfectamente configurados. "blob" es un alias legítimo, no un
   * valor inválido.
   */
  it('GENUS_FILE_STORAGE="blob" (alias real visto en Production) habilita igual que "vercel_blob"', async () => {
    process.env.GENUS_FILE_STORAGE = "blob";
    process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_test";
    const { getBlobAuthMode, isPrivateFileStorageConfigured } = await import("./file-storage");
    expect(isPrivateFileStorageConfigured()).toBe(true);
    expect(getBlobAuthMode()).toBe("TOKEN");
  });

  it('GENUS_FILE_STORAGE="blob" también habilita OIDC cuando hay credenciales OIDC reales', async () => {
    process.env.GENUS_FILE_STORAGE = "blob";
    process.env.BLOB_STORE_ID = "store_test_oidc";
    process.env.VERCEL_OIDC_TOKEN = "oidc.jwt.test";
    const { getBlobAuthMode, isPrivateFileStorageConfigured } = await import("./file-storage");
    expect(isPrivateFileStorageConfigured()).toBe(true);
    expect(getBlobAuthMode()).toBe("OIDC");
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
