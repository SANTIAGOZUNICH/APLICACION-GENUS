import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { getDb, isDatabaseConfigured } from "@/lib/db/client";
import {
  assertFeatureWritesEnabled,
  isFeatureMemoryAllowed,
  isFeatureSchemaReady,
  SchemaPendingError,
} from "@/lib/db/feature-schema";
import {
  coaFileVersions,
  coaFiles,
  coaFolders,
  featureAuditEvents,
} from "@/lib/db/schema";
import { validateCoaUpload } from "./drive-write";
import {
  canAdminCoas,
  canViewCoas,
  type CoaFileRecord,
  type CoaFolderRecord,
  type CoaVersionRecord,
} from "./types";
import type { SectorId } from "@/types/operational/sector";
import {
  assertPrivateFileStorageConfigured,
  coaStorageKey,
  FILE_STORAGE_NOT_CONFIGURED,
  getFileStorage,
  STORAGE_PROVIDER_VERCEL_BLOB_PRIVATE,
} from "@/lib/storage/file-storage";

export type CoaActor = { email: string; sector: SectorId };

type Mem = {
  folders: CoaFolderRecord[];
  files: CoaFileRecord[];
  versions: CoaVersionRecord[];
};

const g = globalThis as unknown as { __genusCoaMem?: Mem };
function mem(): Mem {
  if (!g.__genusCoaMem) {
    g.__genusCoaMem = { folders: [], files: [], versions: [] };
  }
  return g.__genusCoaMem;
}

function assertView(a: CoaActor) {
  if (!canViewCoas(a.sector)) throw new Error("Sin acceso a COA'S.");
}
function assertAdmin(a: CoaActor) {
  if (!canAdminCoas(a.sector)) throw new Error("Solo MP administra COA'S.");
}

function isVirtualFolderId(id: string): boolean {
  return id.startsWith("virtual:") || id.startsWith("mem-");
}

async function auditCoa(
  actor: CoaActor,
  action: string,
  entityId: string,
  payload: Record<string, unknown> = {}
) {
  if (!(isDatabaseConfigured() && (await isFeatureSchemaReady()))) return;
  try {
    const db = getDb();
    await db.insert(featureAuditEvents).values({
      domain: "coa",
      action,
      actorEmail: actor.email,
      actorSector: actor.sector,
      entityId,
      payload: { ...payload, tokenRedacted: true },
    });
  } catch {
    /* best-effort */
  }
}

export class CoaService {
  async list(
    actor: CoaActor,
    parentId: string | null
  ): Promise<{ folders: CoaFolderRecord[]; files: CoaFileRecord[] }> {
    assertView(actor);
    if (isDatabaseConfigured() && (await isFeatureSchemaReady())) {
      try {
        const db = getDb();
        const folders = await db
          .select()
          .from(coaFolders)
          .where(
            parentId
              ? and(eq(coaFolders.parentId, parentId), eq(coaFolders.archived, false))
              : and(isNull(coaFolders.parentId), eq(coaFolders.archived, false))
          );
        const files = parentId
          ? await db
              .select()
              .from(coaFiles)
              .where(
                and(eq(coaFiles.folderId, parentId), eq(coaFiles.archived, false))
              )
          : [];
        return {
          folders: folders.map((f) => ({
            id: f.id,
            parentId: f.parentId,
            name: f.name,
            driveFolderId: f.driveFolderId,
            path: f.path,
            createdBy: f.createdBy,
            createdAt: f.createdAt.toISOString(),
            updatedAt: f.updatedAt.toISOString(),
          })),
          files: files.map((f) => ({
            id: f.id,
            folderId: f.folderId,
            name: f.name,
            mimeType: f.mimeType,
            sizeBytes: f.sizeBytes,
            driveFileId: f.driveFileId,
            currentVersion: f.currentVersion,
            createdBy: f.createdBy,
            updatedBy: f.updatedBy,
            createdAt: f.createdAt.toISOString(),
            updatedAt: f.updatedAt.toISOString(),
          })),
        };
      } catch {
        if (!isFeatureMemoryAllowed()) return { folders: [], files: [] };
      }
    }
    if (!isFeatureMemoryAllowed()) return { folders: [], files: [] };
    return {
      folders: mem().folders.filter((f) => f.parentId === parentId),
      files: mem().files.filter((f) => f.folderId === (parentId ?? "")),
    };
  }

  async createFolder(
    actor: CoaActor,
    name: string,
    parentId: string | null
  ): Promise<CoaFolderRecord> {
    assertAdmin(actor);
    await assertFeatureWritesEnabled();
    const clean = name.trim();
    if (!clean) throw new Error("Nombre obligatorio.");
    let path = `/${clean}`;
    if (parentId) {
      const parent = await this.getFolder(parentId);
      if (!parent) throw new Error("Carpeta padre no encontrada.");
      path = `${parent.path.replace(/\/$/, "")}/${clean}`;
    }

    const id = randomUUID();
    const now = new Date().toISOString();
    // Carpeta virtual en Neon — sin Google Drive.
    const folder: CoaFolderRecord = {
      id,
      parentId,
      name: clean,
      driveFolderId: `virtual:${id}`,
      path,
      createdBy: actor.email,
      createdAt: now,
      updatedAt: now,
    };
    await this.persistFolder(folder);
    await auditCoa(actor, "mkdir", id, { name: clean, path });
    return folder;
  }

  async upload(
    actor: CoaActor,
    params: {
      folderId: string;
      fileName: string;
      mimeType: string;
      bytes: Buffer;
      replaceFileId?: string;
    }
  ): Promise<CoaFileRecord> {
    assertAdmin(actor);
    await assertFeatureWritesEnabled();
    if (!isFeatureMemoryAllowed()) {
      assertPrivateFileStorageConfigured();
    }
    validateCoaUpload({
      fileName: params.fileName,
      mimeType: params.mimeType,
      sizeBytes: params.bytes.length,
    });
    const folder = await this.getFolder(params.folderId);
    if (!folder) throw new Error("Carpeta no encontrada.");

    const storage = getFileStorage();
    const now = new Date().toISOString();
    const uploadedKeys: string[] = [];

    try {
      if (params.replaceFileId) {
        const existing = await this.getFile(params.replaceFileId);
        if (!existing) throw new Error("Archivo a reemplazar no encontrado.");
        const nextVersion = existing.currentVersion + 1;
        const storageKey = coaStorageKey({
          folderId: folder.id,
          fileId: existing.id,
          version: nextVersion,
          fileName: params.fileName,
        });
        const put = await storage.put({
          storageKey,
          bytes: params.bytes,
          contentType: params.mimeType,
        });
        uploadedKeys.push(put.storageKey);

        const updated: CoaFileRecord = {
          ...existing,
          name: params.fileName,
          mimeType: params.mimeType,
          sizeBytes: params.bytes.length,
          driveFileId: put.storageKey,
          currentVersion: nextVersion,
          updatedBy: actor.email,
          updatedAt: now,
        };
        await this.persistFile(updated, {
          storageProvider: STORAGE_PROVIDER_VERCEL_BLOB_PRIVATE,
          sha256: put.sha256,
        });
        await this.persistVersion(
          {
            id: randomUUID(),
            fileId: updated.id,
            version: nextVersion,
            driveFileId: put.storageKey,
            mimeType: params.mimeType,
            sizeBytes: params.bytes.length,
            uploadedBy: actor.email,
            createdAt: now,
          },
          put.sha256
        );
        await auditCoa(actor, "upload_version", updated.id, {
          version: nextVersion,
          storageKey: put.storageKey,
          sha256: put.sha256,
        });
        return updated;
      }

      const fileId = randomUUID();
      const storageKey = coaStorageKey({
        folderId: folder.id,
        fileId,
        version: 1,
        fileName: params.fileName,
      });
      const put = await storage.put({
        storageKey,
        bytes: params.bytes,
        contentType: params.mimeType,
      });
      uploadedKeys.push(put.storageKey);

      const file: CoaFileRecord = {
        id: fileId,
        folderId: params.folderId,
        name: params.fileName,
        mimeType: params.mimeType,
        sizeBytes: params.bytes.length,
        driveFileId: put.storageKey,
        currentVersion: 1,
        createdBy: actor.email,
        updatedBy: actor.email,
        createdAt: now,
        updatedAt: now,
      };
      await this.persistFile(file, {
        storageProvider: STORAGE_PROVIDER_VERCEL_BLOB_PRIVATE,
        sha256: put.sha256,
      });
      await this.persistVersion(
        {
          id: randomUUID(),
          fileId: file.id,
          version: 1,
          driveFileId: put.storageKey,
          mimeType: params.mimeType,
          sizeBytes: params.bytes.length,
          uploadedBy: actor.email,
          createdAt: now,
        },
        put.sha256
      );
      await auditCoa(actor, "upload", file.id, {
        version: 1,
        storageKey: put.storageKey,
        sha256: put.sha256,
      });
      return file;
    } catch (err) {
      for (const key of uploadedKeys) {
        try {
          await storage.delete(key);
        } catch {
          /* compensación best-effort */
        }
      }
      if (
        err instanceof Error &&
        err.message.includes(FILE_STORAGE_NOT_CONFIGURED)
      ) {
        throw err;
      }
      throw err;
    }
  }

  async renameFolder(
    actor: CoaActor,
    folderId: string,
    name: string
  ): Promise<CoaFolderRecord> {
    assertAdmin(actor);
    await assertFeatureWritesEnabled();
    const clean = name.trim();
    if (!clean) throw new Error("Nombre obligatorio.");
    const folder = await this.getFolder(folderId);
    if (!folder) throw new Error("Carpeta no encontrada.");
    const now = new Date().toISOString();
    const updated: CoaFolderRecord = {
      ...folder,
      name: clean,
      path: `${folder.path.replace(/\/[^/]+$/, "")}/${clean}`.replace(/\/+/g, "/"),
      updatedAt: now,
    };

    if (!isVirtualFolderId(folder.driveFolderId)) {
      // Legacy Drive folders: solo renombrar metadata Neon (ya no se escribe a Drive).
    }

    if (isDatabaseConfigured() && (await isFeatureSchemaReady())) {
      const db = getDb();
      await db
        .update(coaFolders)
        .set({
          name: clean,
          path: updated.path,
          updatedAt: new Date(now),
          audit: { action: "rename", at: now, by: actor.email },
        })
        .where(eq(coaFolders.id, folderId));
      return updated;
    }
    if (!isFeatureMemoryAllowed()) throw new SchemaPendingError();
    const idx = mem().folders.findIndex((f) => f.id === folderId);
    if (idx < 0) throw new Error("Carpeta no encontrada.");
    mem().folders[idx] = updated;
    return updated;
  }

  async archiveFolder(actor: CoaActor, folderId: string): Promise<void> {
    assertAdmin(actor);
    await assertFeatureWritesEnabled();
    const folder = await this.getFolder(folderId);
    if (!folder) throw new Error("Carpeta no encontrada.");

    const children = (await this.list(actor, folderId)).folders;
    const files = (await this.list(actor, folderId)).files;
    if (children.length > 0 || files.length > 0) {
      throw new Error(
        "Solo se puede eliminar una carpeta vacía (auditoría). Mové o archivá el contenido primero."
      );
    }

    if (!isVirtualFolderId(folder.driveFolderId)) {
      // Legacy Drive: archivar solo en Neon; no borrar Blob/Drive desde aquí.
    }

    if (isDatabaseConfigured() && (await isFeatureSchemaReady())) {
      const db = getDb();
      await db
        .update(coaFolders)
        .set({
          archived: true,
          updatedAt: new Date(),
          audit: { action: "archive", at: new Date().toISOString(), by: actor.email },
        })
        .where(eq(coaFolders.id, folderId));
      return;
    }
    if (!isFeatureMemoryAllowed()) throw new SchemaPendingError();
    mem().folders = mem().folders.filter((f) => f.id !== folderId);
  }

  async listVersions(actor: CoaActor, fileId: string): Promise<CoaVersionRecord[]> {
    assertView(actor);
    if (isDatabaseConfigured() && (await isFeatureSchemaReady())) {
      try {
        const db = getDb();
        const rows = await db
          .select()
          .from(coaFileVersions)
          .where(eq(coaFileVersions.fileId, fileId));
        return rows
          .map((v) => ({
            id: v.id,
            fileId: v.fileId,
            version: v.version,
            driveFileId: v.driveFileId,
            mimeType: v.mimeType,
            sizeBytes: v.sizeBytes,
            uploadedBy: v.uploadedBy,
            createdAt: v.createdAt.toISOString(),
          }))
          .sort((a, b) => b.version - a.version);
      } catch {
        if (!isFeatureMemoryAllowed()) return [];
      }
    }
    if (!isFeatureMemoryAllowed()) return [];
    return mem()
      .versions.filter((v) => v.fileId === fileId)
      .sort((a, b) => b.version - a.version);
  }

  async downloadVersion(
    actor: CoaActor,
    fileId: string,
    version?: number
  ): Promise<{ fileName: string; mimeType: string; bytes: Buffer }> {
    assertView(actor);
    const file = await this.getFile(fileId);
    if (!file) throw new Error("Archivo no encontrado.");
    const versions = await this.listVersions(actor, fileId);
    const target =
      version != null
        ? versions.find((v) => v.version === version)
        : versions[0] ?? {
            driveFileId: file.driveFileId,
            mimeType: file.mimeType,
            version: file.currentVersion,
          };
    if (!target) throw new Error("Versión no encontrada.");

    const storageKey =
      "driveFileId" in target ? target.driveFileId : file.driveFileId;
    const mimeType = "mimeType" in target ? target.mimeType : file.mimeType;
    const ver = "version" in target ? target.version : file.currentVersion;

    if (!storageKey) throw new Error("Archivo sin storage key.");

    const storage = getFileStorage();
    const got = await storage.get(storageKey);
    await auditCoa(actor, "download", fileId, {
      version: ver,
      storageKey,
      preview: false,
    });
    return { fileName: file.name, mimeType, bytes: got.bytes };
  }

  async getFolder(id: string): Promise<CoaFolderRecord | null> {
    if (isDatabaseConfigured() && (await isFeatureSchemaReady())) {
      try {
        const db = getDb();
        const [f] = await db.select().from(coaFolders).where(eq(coaFolders.id, id)).limit(1);
        if (!f || f.archived) return null;
        return {
          id: f.id,
          parentId: f.parentId,
          name: f.name,
          driveFolderId: f.driveFolderId,
          path: f.path,
          createdBy: f.createdBy,
          createdAt: f.createdAt.toISOString(),
          updatedAt: f.updatedAt.toISOString(),
        };
      } catch {
        if (!isFeatureMemoryAllowed()) return null;
      }
    }
    if (!isFeatureMemoryAllowed()) return null;
    return mem().folders.find((f) => f.id === id) ?? null;
  }

  async getFile(id: string): Promise<CoaFileRecord | null> {
    if (isDatabaseConfigured() && (await isFeatureSchemaReady())) {
      try {
        const db = getDb();
        const [f] = await db.select().from(coaFiles).where(eq(coaFiles.id, id)).limit(1);
        if (!f || f.archived) return null;
        return {
          id: f.id,
          folderId: f.folderId,
          name: f.name,
          mimeType: f.mimeType,
          sizeBytes: f.sizeBytes,
          driveFileId: f.driveFileId,
          currentVersion: f.currentVersion,
          createdBy: f.createdBy,
          updatedBy: f.updatedBy,
          createdAt: f.createdAt.toISOString(),
          updatedAt: f.updatedAt.toISOString(),
        };
      } catch {
        if (!isFeatureMemoryAllowed()) return null;
      }
    }
    if (!isFeatureMemoryAllowed()) return null;
    return mem().files.find((f) => f.id === id) ?? null;
  }

  private async persistFolder(folder: CoaFolderRecord) {
    if (isDatabaseConfigured() && (await isFeatureSchemaReady())) {
      try {
        const db = getDb();
        await db.insert(coaFolders).values({
          id: folder.id,
          parentId: folder.parentId,
          name: folder.name,
          driveFolderId: folder.driveFolderId,
          path: folder.path,
          createdBy: folder.createdBy,
          createdAt: new Date(folder.createdAt),
          updatedAt: new Date(folder.updatedAt),
          archived: false,
          audit: { action: "mkdir", at: folder.createdAt },
        });
        return;
      } catch {
        if (!isFeatureMemoryAllowed()) throw new SchemaPendingError();
      }
    }
    if (!isFeatureMemoryAllowed()) throw new SchemaPendingError();
    mem().folders.push(folder);
  }

  private async persistFile(
    file: CoaFileRecord,
    extra?: { storageProvider?: string; sha256?: string }
  ) {
    if (isDatabaseConfigured() && (await isFeatureSchemaReady())) {
      try {
        const db = getDb();
        await db
          .insert(coaFiles)
          .values({
            id: file.id,
            folderId: file.folderId,
            name: file.name,
            mimeType: file.mimeType,
            sizeBytes: file.sizeBytes,
            driveFileId: file.driveFileId,
            currentVersion: file.currentVersion,
            createdBy: file.createdBy,
            updatedBy: file.updatedBy,
            createdAt: new Date(file.createdAt),
            updatedAt: new Date(file.updatedAt),
            archived: false,
            audit: {
              action: "upload",
              at: file.updatedAt,
              storageProvider:
                extra?.storageProvider ?? STORAGE_PROVIDER_VERCEL_BLOB_PRIVATE,
              storageKey: file.driveFileId,
              sha256: extra?.sha256 ?? null,
            },
          })
          .onConflictDoUpdate({
            target: coaFiles.id,
            set: {
              name: file.name,
              mimeType: file.mimeType,
              sizeBytes: file.sizeBytes,
              driveFileId: file.driveFileId,
              currentVersion: file.currentVersion,
              updatedBy: file.updatedBy,
              updatedAt: new Date(file.updatedAt),
              audit: {
                action: "upload",
                at: file.updatedAt,
                storageProvider:
                  extra?.storageProvider ?? STORAGE_PROVIDER_VERCEL_BLOB_PRIVATE,
                storageKey: file.driveFileId,
                sha256: extra?.sha256 ?? null,
              },
            },
          });
        return;
      } catch {
        if (!isFeatureMemoryAllowed()) throw new SchemaPendingError();
      }
    }
    if (!isFeatureMemoryAllowed()) throw new SchemaPendingError();
    const idx = mem().files.findIndex((f) => f.id === file.id);
    if (idx >= 0) mem().files[idx] = file;
    else mem().files.push(file);
  }

  private async persistVersion(v: CoaVersionRecord, sha256?: string) {
    if (isDatabaseConfigured() && (await isFeatureSchemaReady())) {
      try {
        const db = getDb();
        await db.insert(coaFileVersions).values({
          id: v.id,
          fileId: v.fileId,
          version: v.version,
          driveFileId: v.driveFileId,
          mimeType: v.mimeType,
          sizeBytes: v.sizeBytes,
          uploadedBy: v.uploadedBy,
          createdAt: new Date(v.createdAt),
          checksum: sha256 ?? null,
        });
        return;
      } catch {
        if (!isFeatureMemoryAllowed()) throw new SchemaPendingError();
      }
    }
    if (!isFeatureMemoryAllowed()) throw new SchemaPendingError();
    mem().versions.push(v);
  }
}

let singleton: CoaService | null = null;
export function getCoaService(): CoaService {
  if (!singleton) singleton = new CoaService();
  return singleton;
}

export function resetCoaMemoryForTests(): void {
  g.__genusCoaMem = { folders: [], files: [], versions: [] };
  singleton = null;
}
