/**
 * FileStorageAdapter — almacenamiento privado de archivos (COA / Remitos).
 * Proveedor activo: VERCEL_BLOB_PRIVATE.
 *
 * Auth (orden oficial Vercel):
 * 1) OIDC: BLOB_STORE_ID + VERCEL_OIDC_TOKEN (inyectado/rotado en runtime)
 * 2) Fallback local/CLI: BLOB_READ_WRITE_TOKEN (opcional)
 *
 * BLOB_WEBHOOK_PUBLIC_KEY solo valida webhooks — no autentica put/get/delete.
 * Nunca exponer tokens, store IDs ni claves al cliente/logs.
 */
import "server-only";

import { createHash } from "node:crypto";
import { del, get, head, put } from "@vercel/blob";

export const STORAGE_PROVIDER_VERCEL_BLOB_PRIVATE = "VERCEL_BLOB_PRIVATE" as const;
export type StorageProvider = typeof STORAGE_PROVIDER_VERCEL_BLOB_PRIVATE;

export type BlobAuthMode = "OIDC" | "TOKEN" | "NONE";

export const FILE_STORAGE_NOT_CONFIGURED =
  "Almacenamiento privado de archivos no configurado.";

export type FilePutResult = {
  provider: StorageProvider;
  /** pathname / storage key interno (sin URL pública). */
  storageKey: string;
  /** URL privada del blob (solo servidor; no exponer al cliente). */
  url: string;
  sizeBytes: number;
  contentType: string | null;
  sha256: string;
};

export type FileGetResult = {
  storageKey: string;
  bytes: Buffer;
  contentType: string | null;
  sizeBytes: number;
  sha256?: string;
};

export type FileMetadata = {
  storageKey: string;
  sizeBytes: number;
  contentType: string | null;
  uploadedAt?: string;
  url?: string;
};

export type StorageHealth = {
  provider: StorageProvider;
  configured: boolean;
  authMode: BlobAuthMode;
  storeConfigured: boolean;
};

export interface FileStorageAdapter {
  put(params: {
    storageKey: string;
    bytes: Buffer | Uint8Array;
    contentType: string;
    /** Si true, sobrescribe; por defecto no. */
    allowOverwrite?: boolean;
  }): Promise<FilePutResult>;
  get(storageKey: string): Promise<FileGetResult>;
  delete(storageKey: string): Promise<void>;
  exists(storageKey: string): Promise<boolean>;
  metadata(storageKey: string): Promise<FileMetadata | null>;
  sha256(bytes: Buffer | Uint8Array): string;
}

export function sha256Hex(bytes: Buffer | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function genusFileStorageEnabled(): boolean {
  const mode = (process.env.GENUS_FILE_STORAGE ?? "vercel_blob").trim().toLowerCase();
  return mode === "vercel_blob" || mode === "vercel_blob_private";
}

function storeId(): string | null {
  return process.env.BLOB_STORE_ID?.trim() || null;
}

function oidcToken(): string | null {
  return process.env.VERCEL_OIDC_TOKEN?.trim() || null;
}

function rwToken(): string | null {
  return process.env.BLOB_READ_WRITE_TOKEN?.trim() || null;
}

/** OIDC usable: store conectado + token runtime, o store en Vercel (token inyectado). */
export function hasOidcBlobAuth(): boolean {
  if (!storeId()) return false;
  if (oidcToken()) return true;
  // En deployments Vercel el OIDC se inyecta en runtime aunque el health
  // a veces se evalúe antes de materializar VERCEL_OIDC_TOKEN en el proceso.
  return process.env.VERCEL === "1";
}

export function hasLegacyBlobTokenAuth(): boolean {
  return Boolean(rwToken());
}

/**
 * Webhook public key NO autentica uploads/lecturas.
 * Solo documentamos el helper para tests / validación futura de webhooks.
 */
export function hasBlobWebhookPublicKey(): boolean {
  return Boolean(process.env.BLOB_WEBHOOK_PUBLIC_KEY?.trim());
}

export function getBlobAuthMode(): BlobAuthMode {
  if (!genusFileStorageEnabled()) return "NONE";
  // OIDC tiene prioridad sobre token estático.
  if (hasOidcBlobAuth()) return "OIDC";
  if (hasLegacyBlobTokenAuth()) return "TOKEN";
  return "NONE";
}

export function isPrivateFileStorageConfigured(): boolean {
  return getBlobAuthMode() !== "NONE";
}

export function assertPrivateFileStorageConfigured(): void {
  if (!isPrivateFileStorageConfigured()) {
    throw new Error(FILE_STORAGE_NOT_CONFIGURED);
  }
}

/** Diagnóstico seguro — sin IDs, tokens ni claves. */
export function getStorageHealth(): StorageHealth {
  return {
    provider: STORAGE_PROVIDER_VERCEL_BLOB_PRIVATE,
    configured: isPrivateFileStorageConfigured(),
    authMode: getBlobAuthMode(),
    storeConfigured: Boolean(storeId()),
  };
}

type BlobAuthOptions = {
  token?: string;
  oidcToken?: string;
  storeId?: string;
};

/** Opciones de auth para @vercel/blob — nunca loguear el resultado. */
export function resolveBlobAuthOptions(): BlobAuthOptions {
  const mode = getBlobAuthMode();
  if (mode === "OIDC") {
    const opts: BlobAuthOptions = {};
    const sid = storeId();
    if (sid) opts.storeId = sid;
    const oidc = oidcToken();
    if (oidc) opts.oidcToken = oidc;
    return opts;
  }
  if (mode === "TOKEN") {
    const token = rwToken();
    if (!token) throw new Error(FILE_STORAGE_NOT_CONFIGURED);
    return { token };
  }
  throw new Error(FILE_STORAGE_NOT_CONFIGURED);
}

/** Sanitiza el último segmento del pathname. */
export function safeFileName(name: string): string {
  const base = name.replace(/[\\/]/g, "").replace(/\.\./g, "").trim();
  const cleaned = base.replace(/[^\w.\- ()áéíóúÁÉÍÓÚñÑ]+/gi, "_").slice(0, 180);
  return cleaned || "file";
}

export function coaStorageKey(params: {
  folderId: string;
  fileId: string;
  version: number;
  fileName: string;
}): string {
  return `coas/${params.folderId}/${params.fileId}/v${params.version}/${safeFileName(params.fileName)}`;
}

export function remitoClientPathSlug(params: {
  clientDisplay: string | null | undefined;
  clientIdNormalized: string | null | undefined;
}): string {
  const normalized = String(params.clientIdNormalized ?? "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  const visible = String(params.clientDisplay ?? "").trim() || "SIN CLIENTE";
  const base = visible
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  const hashSrc = normalized || visible.toLowerCase();
  const shortHash = createHash("sha256").update(hashSrc).digest("hex").slice(0, 6);
  return `${base || "sin-cliente"}--${shortHash}`;
}

export function remitoStorageKey(params: {
  year?: string | number;
  remitoId: string;
  version: number;
  kind: "pdf" | "xlsx";
  /** Path nuevo por cliente (remitos nuevos). */
  clientSlug?: string | null;
}): string {
  const ext = params.kind === "pdf" ? "pdf" : "xlsx";
  if (params.clientSlug) {
    return `remitos/${params.clientSlug}/${params.remitoId}/v${params.version}/remito.${ext}`;
  }
  const year = params.year ?? new Date().getFullYear();
  return `remitos/${year}/${params.remitoId}/v${params.version}/remito.${ext}`;
}

export function procedureStorageKey(params: {
  folderId: string;
  fileId: string;
  version: number;
  fileName: string;
}): string {
  return `procedimientos/${params.folderId}/${params.fileId}/v${params.version}/${safeFileName(params.fileName)}`;
}

class VercelBlobPrivateStorage implements FileStorageAdapter {
  sha256(bytes: Buffer | Uint8Array): string {
    return sha256Hex(bytes);
  }

  async put(params: {
    storageKey: string;
    bytes: Buffer | Uint8Array;
    contentType: string;
    allowOverwrite?: boolean;
  }): Promise<FilePutResult> {
    const auth = resolveBlobAuthOptions();
    const body = Buffer.isBuffer(params.bytes)
      ? params.bytes
      : Buffer.from(params.bytes);
    const sha = sha256Hex(body);
    const blob = await put(params.storageKey, body, {
      access: "private",
      contentType: params.contentType,
      addRandomSuffix: false,
      allowOverwrite: params.allowOverwrite ?? false,
      ...auth,
    });
    return {
      provider: STORAGE_PROVIDER_VERCEL_BLOB_PRIVATE,
      storageKey: blob.pathname || params.storageKey,
      url: blob.url,
      sizeBytes: body.length,
      contentType: params.contentType,
      sha256: sha,
    };
  }

  async get(storageKey: string): Promise<FileGetResult> {
    const auth = resolveBlobAuthOptions();
    const result = await get(storageKey, { access: "private", ...auth });
    if (!result?.stream) {
      throw new Error(`Archivo no encontrado en almacenamiento privado (${storageKey}).`);
    }
    const chunks: Buffer[] = [];
    const reader = result.stream.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(Buffer.from(value));
    }
    const bytes = Buffer.concat(chunks);
    return {
      storageKey,
      bytes,
      contentType: result.blob?.contentType ?? null,
      sizeBytes: bytes.length,
      sha256: sha256Hex(bytes),
    };
  }

  async delete(storageKey: string): Promise<void> {
    const auth = resolveBlobAuthOptions();
    await del(storageKey, { ...auth });
  }

  async exists(storageKey: string): Promise<boolean> {
    const meta = await this.metadata(storageKey);
    return meta != null;
  }

  async metadata(storageKey: string): Promise<FileMetadata | null> {
    const auth = resolveBlobAuthOptions();
    try {
      const h = await head(storageKey, { ...auth });
      return {
        storageKey: h.pathname || storageKey,
        sizeBytes: h.size,
        contentType: h.contentType ?? null,
        uploadedAt: h.uploadedAt?.toISOString?.() ?? undefined,
        url: h.url,
      };
    } catch {
      return null;
    }
  }
}

/** Solo tests — nunca en Preview/Production. */
class MemoryFileStorage implements FileStorageAdapter {
  private store = new Map<string, { bytes: Buffer; contentType: string }>();

  sha256(bytes: Buffer | Uint8Array): string {
    return sha256Hex(bytes);
  }

  async put(params: {
    storageKey: string;
    bytes: Buffer | Uint8Array;
    contentType: string;
    allowOverwrite?: boolean;
  }): Promise<FilePutResult> {
    if (this.store.has(params.storageKey) && !params.allowOverwrite) {
      throw new Error(`Blob ya existe: ${params.storageKey}`);
    }
    const body = Buffer.isBuffer(params.bytes)
      ? params.bytes
      : Buffer.from(params.bytes);
    this.store.set(params.storageKey, {
      bytes: body,
      contentType: params.contentType,
    });
    return {
      provider: STORAGE_PROVIDER_VERCEL_BLOB_PRIVATE,
      storageKey: params.storageKey,
      url: `memory://${params.storageKey}`,
      sizeBytes: body.length,
      contentType: params.contentType,
      sha256: sha256Hex(body),
    };
  }

  async get(storageKey: string): Promise<FileGetResult> {
    const row = this.store.get(storageKey);
    if (!row) throw new Error(`Archivo no encontrado (${storageKey}).`);
    return {
      storageKey,
      bytes: row.bytes,
      contentType: row.contentType,
      sizeBytes: row.bytes.length,
      sha256: sha256Hex(row.bytes),
    };
  }

  async delete(storageKey: string): Promise<void> {
    this.store.delete(storageKey);
  }

  async exists(storageKey: string): Promise<boolean> {
    return this.store.has(storageKey);
  }

  async metadata(storageKey: string): Promise<FileMetadata | null> {
    const row = this.store.get(storageKey);
    if (!row) return null;
    return {
      storageKey,
      sizeBytes: row.bytes.length,
      contentType: row.contentType,
    };
  }
}

const g = globalThis as unknown as {
  __genusFileStorage?: FileStorageAdapter;
  __genusMemFileStorage?: MemoryFileStorage;
};

export function getFileStorage(): FileStorageAdapter {
  if (process.env.VITEST === "true" || process.env.NODE_ENV === "test") {
    if (!g.__genusMemFileStorage) g.__genusMemFileStorage = new MemoryFileStorage();
    return g.__genusMemFileStorage;
  }
  if (!isPrivateFileStorageConfigured()) {
    throw new Error(FILE_STORAGE_NOT_CONFIGURED);
  }
  if (!g.__genusFileStorage) {
    g.__genusFileStorage = new VercelBlobPrivateStorage();
  }
  return g.__genusFileStorage;
}

/** Reset memoria de tests. */
export function resetMemoryFileStorageForTests(): void {
  g.__genusMemFileStorage = new MemoryFileStorage();
  g.__genusFileStorage = undefined;
}
