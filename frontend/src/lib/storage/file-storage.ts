/**
 * FileStorageAdapter — almacenamiento privado de archivos (COA / Remitos).
 * Proveedor activo: VERCEL_BLOB_PRIVATE.
 * El token BLOB_READ_WRITE_TOKEN nunca sale del servidor.
 */
import "server-only";

import { createHash } from "node:crypto";
import { del, get, head, put } from "@vercel/blob";

export const STORAGE_PROVIDER_VERCEL_BLOB_PRIVATE = "VERCEL_BLOB_PRIVATE" as const;
export type StorageProvider = typeof STORAGE_PROVIDER_VERCEL_BLOB_PRIVATE;

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

export function isPrivateFileStorageConfigured(): boolean {
  const mode = (process.env.GENUS_FILE_STORAGE ?? "vercel_blob").trim().toLowerCase();
  if (mode !== "vercel_blob" && mode !== "vercel_blob_private") return false;
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim());
}

export function assertPrivateFileStorageConfigured(): void {
  if (!isPrivateFileStorageConfigured()) {
    throw new Error(FILE_STORAGE_NOT_CONFIGURED);
  }
}

function requireToken(): string {
  const token = process.env.BLOB_READ_WRITE_TOKEN?.trim();
  if (!token) throw new Error(FILE_STORAGE_NOT_CONFIGURED);
  return token;
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

export function remitoStorageKey(params: {
  year: string | number;
  remitoId: string;
  version: number;
  kind: "pdf" | "xlsx";
}): string {
  const ext = params.kind === "pdf" ? "pdf" : "xlsx";
  return `remitos/${params.year}/${params.remitoId}/v${params.version}/remito.${ext}`;
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
    const token = requireToken();
    const body = Buffer.isBuffer(params.bytes)
      ? params.bytes
      : Buffer.from(params.bytes);
    const sha = sha256Hex(body);
    const blob = await put(params.storageKey, body, {
      access: "private",
      token,
      contentType: params.contentType,
      addRandomSuffix: false,
      allowOverwrite: params.allowOverwrite ?? false,
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
    const token = requireToken();
    const result = await get(storageKey, { access: "private", token });
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
    const token = requireToken();
    await del(storageKey, { token });
  }

  async exists(storageKey: string): Promise<boolean> {
    const meta = await this.metadata(storageKey);
    return meta != null;
  }

  async metadata(storageKey: string): Promise<FileMetadata | null> {
    const token = requireToken();
    try {
      const h = await head(storageKey, { token });
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
}
