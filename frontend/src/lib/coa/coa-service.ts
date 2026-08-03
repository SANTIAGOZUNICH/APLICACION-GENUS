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

type MemFolder = CoaFolderRecord & { archived?: boolean };
type MemFile = CoaFileRecord & { archived?: boolean };

type Mem = {
  folders: MemFolder[];
  files: MemFile[];
  versions: CoaVersionRecord[];
};

export type CoaListOptions = { includeArchived?: boolean };

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
    parentId: string | null,
    options: CoaListOptions = {}
  ): Promise<{ folders: CoaFolderRecord[]; files: CoaFileRecord[] }> {
    assertView(actor);
    const wantArchived = Boolean(options.includeArchived);
    if (isDatabaseConfigured() && (await isFeatureSchemaReady())) {
      try {
        const db = getDb();
        const folders = await db
          .select()
          .from(coaFolders)
          .where(
            parentId
              ? and(
                  eq(coaFolders.parentId, parentId),
                  eq(coaFolders.archived, wantArchived)
                )
              : and(isNull(coaFolders.parentId), eq(coaFolders.archived, wantArchived))
          );
        const files = parentId
          ? await db
              .select()
              .from(coaFiles)
              .where(
                and(eq(coaFiles.folderId, parentId), eq(coaFiles.archived, wantArchived))
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
      folders: mem()
        .folders.filter(
          (f) => f.parentId === parentId && Boolean(f.archived) === wantArchived
        )
        .map(({ archived: _a, ...f }) => f),
      files: mem()
        .files.filter(
          (f) => f.folderId === (parentId ?? "") && Boolean(f.archived) === wantArchived
        )
        .map(({ archived: _a, ...f }) => f),
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
    const folder = await this.getFolder(folderId, { includeArchived: true });
    if (!folder) throw new Error("Carpeta no encontrada.");
    if (await this.isFolderArchived(folderId)) {
      throw new Error("La carpeta ya está archivada.");
    }

    const now = new Date().toISOString();
    if (isDatabaseConfigured() && (await isFeatureSchemaReady())) {
      const db = getDb();
      await db
        .update(coaFolders)
        .set({
          archived: true,
          updatedAt: new Date(now),
          audit: { action: "archive", at: now, by: actor.email },
        })
        .where(eq(coaFolders.id, folderId));
      await auditCoa(actor, "archive_folder", folderId, { name: folder.name });
      return;
    }
    if (!isFeatureMemoryAllowed()) throw new SchemaPendingError();
    const idx = mem().folders.findIndex((f) => f.id === folderId);
    if (idx < 0) throw new Error("Carpeta no encontrada.");
    mem().folders[idx] = { ...mem().folders[idx]!, archived: true, updatedAt: now };
  }

  async hardDeleteFolder(actor: CoaActor, folderId: string): Promise<void> {
    assertAdmin(actor);
    await assertFeatureWritesEnabled();
    const folder = await this.getFolder(folderId, { includeArchived: true });
    if (!folder) throw new Error("Carpeta no encontrada.");

    const childCount = await this.countFolderChildren(folderId);
    if (childCount.subfolders > 0 || childCount.files > 0) {
      throw new Error(
        "Solo se puede eliminar definitivamente una carpeta vacía (sin archivos ni subcarpetas, activos o archivados)."
      );
    }

    if (isDatabaseConfigured() && (await isFeatureSchemaReady())) {
      const db = getDb();
      await db.delete(coaFolders).where(eq(coaFolders.id, folderId));
      await auditCoa(actor, "delete_folder", folderId, { name: folder.name });
      return;
    }
    if (!isFeatureMemoryAllowed()) throw new SchemaPendingError();
    mem().folders = mem().folders.filter((f) => f.id !== folderId);
    await auditCoa(actor, "delete_folder", folderId, { name: folder.name });
  }

  async restoreFolder(actor: CoaActor, folderId: string): Promise<CoaFolderRecord> {
    assertAdmin(actor);
    await assertFeatureWritesEnabled();
    const folder = await this.getFolder(folderId, { includeArchived: true });
    if (!folder) throw new Error("Carpeta no encontrada.");
    if (!(await this.isFolderArchived(folderId))) {
      throw new Error("La carpeta no está archivada.");
    }

    const now = new Date().toISOString();
    const restored: CoaFolderRecord = { ...folder, updatedAt: now };
    if (isDatabaseConfigured() && (await isFeatureSchemaReady())) {
      const db = getDb();
      await db
        .update(coaFolders)
        .set({
          archived: false,
          updatedAt: new Date(now),
          audit: { action: "restore", at: now, by: actor.email },
        })
        .where(eq(coaFolders.id, folderId));
      await auditCoa(actor, "restore_folder", folderId, { name: folder.name });
      return restored;
    }
    if (!isFeatureMemoryAllowed()) throw new SchemaPendingError();
    const idx = mem().folders.findIndex((f) => f.id === folderId);
    if (idx < 0) throw new Error("Carpeta no encontrada.");
    mem().folders[idx] = { ...mem().folders[idx]!, archived: false, updatedAt: now };
    return restored;
  }

  /** Soft-archive: oculta metadata sin borrar Blobs ni versiones. */
  async softArchiveFile(
    actor: CoaActor,
    fileId: string,
    reason?: string
  ): Promise<void> {
    assertAdmin(actor);
    await assertFeatureWritesEnabled();
    const file = await this.getFile(fileId, { includeArchived: true });
    if (!file) throw new Error("Archivo no encontrado.");
    if (await this.isFileArchived(fileId)) {
      throw new Error("El archivo ya está archivado.");
    }

    const now = new Date().toISOString();
    const auditPayload = {
      action: "archive_file",
      at: now,
      by: actor.email,
      reason: reason?.trim() || null,
      name: file.name,
      folderId: file.folderId,
    };

    if (isDatabaseConfigured() && (await isFeatureSchemaReady())) {
      const db = getDb();
      await db
        .update(coaFiles)
        .set({
          archived: true,
          updatedAt: new Date(now),
          updatedBy: actor.email,
          audit: auditPayload,
        })
        .where(eq(coaFiles.id, fileId));
    } else {
      if (!isFeatureMemoryAllowed()) throw new SchemaPendingError();
      const idx = mem().files.findIndex((f) => f.id === fileId);
      if (idx < 0) throw new Error("Archivo no encontrado.");
      mem().files[idx] = {
        ...mem().files[idx]!,
        archived: true,
        updatedAt: now,
        updatedBy: actor.email,
      };
    }
    await auditCoa(actor, "archive_file", fileId, {
      name: file.name,
      reason: reason?.trim() || null,
    });
  }

  /** Alias retrocompatible → softArchiveFile. */
  async archiveFile(
    actor: CoaActor,
    fileId: string,
    reason?: string
  ): Promise<void> {
    return this.softArchiveFile(actor, fileId, reason);
  }

  /**
   * Elimina archivo completo: borra todos los Blobs, soft-archiva metadata y deja auditoría mínima.
   * Si falla Blob → no archiva (queda visible). Si Blob OK y Neon falla → tombstone inconsistente.
   */
  async hardDeleteFile(
    actor: CoaActor,
    fileId: string,
    reason?: string
  ): Promise<{ ok: true; versionsDeleted: number }> {
    assertAdmin(actor);
    await assertFeatureWritesEnabled();
    const file = await this.getFile(fileId, { includeArchived: true });
    if (!file) throw new Error("Archivo no encontrado.");
    const versions = await this.listVersions(actor, fileId);
    const keys = Array.from(
      new Set(
        [
          ...versions.map((v) => v.driveFileId).filter(Boolean),
          file.driveFileId,
        ].filter((k): k is string => Boolean(k))
      )
    );

    const storage = getFileStorage();
    const { deleteBlobsThenMetadata } = await import("@/lib/lifecycle/blob-safe");
    const blobResult = await deleteBlobsThenMetadata({
      storage,
      keys,
      afterBlobsDeleted: async () => {
        /* metadata below */
      },
    });
    if (!blobResult.ok) {
      throw new Error(
        `No se pudo borrar el archivo en almacenamiento privado (${blobResult.failedKey.slice(0, 24)}…). El archivo sigue visible. Reintentá.`
      );
    }
    const deletedKeys = blobResult.deletedKeys;

    const now = new Date().toISOString();
    const auditPayload = {
      action: "delete_file",
      at: now,
      by: actor.email,
      reason: reason?.trim() || null,
      name: file.name,
      folderId: file.folderId,
      versionCount: versions.length,
      hashes: versions.map((v) => ({ version: v.version, storageKey: v.driveFileId })),
      blobKeysDeleted: deletedKeys.length,
    };

    try {
      if (isDatabaseConfigured() && (await isFeatureSchemaReady())) {
        const db = getDb();
        await db
          .update(coaFiles)
          .set({
            archived: true,
            updatedAt: new Date(now),
            updatedBy: actor.email,
            audit: auditPayload,
          })
          .where(eq(coaFiles.id, fileId));
        // Hard-delete version rows after blobs gone — evita metadata sin blob.
        await db.delete(coaFileVersions).where(eq(coaFileVersions.fileId, fileId));
      } else {
        if (!isFeatureMemoryAllowed()) throw new SchemaPendingError();
        mem().files = mem().files.filter((f) => f.id !== fileId);
        mem().versions = mem().versions.filter((v) => v.fileId !== fileId);
      }
      await auditCoa(actor, "delete_file", fileId, {
        name: file.name,
        reason: reason?.trim() || null,
        versionCount: versions.length,
        blobKeysDeleted: deletedKeys.length,
      });
      return { ok: true, versionsDeleted: versions.length };
    } catch (err) {
      await auditCoa(actor, "delete_file_inconsistent", fileId, {
        name: file.name,
        reason: reason?.trim() || null,
        blobKeysDeleted: deletedKeys.length,
        neonError: err instanceof Error ? err.message : "neon_failed",
        needsAdminRepair: true,
      });
      // Best-effort hide from list even if full persist failed.
      try {
        if (isDatabaseConfigured() && (await isFeatureSchemaReady())) {
          const db = getDb();
          await db
            .update(coaFiles)
            .set({
              archived: true,
              updatedAt: new Date(),
              updatedBy: actor.email,
              audit: { ...auditPayload, inconsistent: true },
            })
            .where(eq(coaFiles.id, fileId));
        }
      } catch {
        /* already audited */
      }
      throw new Error(
        "Los archivos binarios se eliminaron pero falló la metadata. El archivo no quedará descargable; contactá soporte para reparación."
      );
    }
  }

  async restoreFile(actor: CoaActor, fileId: string): Promise<CoaFileRecord> {
    assertAdmin(actor);
    await assertFeatureWritesEnabled();
    const file = await this.getFile(fileId, { includeArchived: true });
    if (!file) throw new Error("Archivo no encontrado.");
    if (!(await this.isFileArchived(fileId))) {
      throw new Error("El archivo no está archivado.");
    }

    const now = new Date().toISOString();
    const restored: CoaFileRecord = { ...file, updatedAt: now, updatedBy: actor.email };
    if (isDatabaseConfigured() && (await isFeatureSchemaReady())) {
      const db = getDb();
      await db
        .update(coaFiles)
        .set({
          archived: false,
          updatedAt: new Date(now),
          updatedBy: actor.email,
          audit: { action: "restore", at: now, by: actor.email },
        })
        .where(eq(coaFiles.id, fileId));
    } else {
      if (!isFeatureMemoryAllowed()) throw new SchemaPendingError();
      const idx = mem().files.findIndex((f) => f.id === fileId);
      if (idx < 0) throw new Error("Archivo no encontrado.");
      mem().files[idx] = {
        ...mem().files[idx]!,
        archived: false,
        updatedAt: now,
        updatedBy: actor.email,
      };
    }
    await auditCoa(actor, "restore_file", fileId, { name: file.name });
    return restored;
  }

  /**
   * Elimina una versión: borra su Blob y la fila.
   * Si era la vigente → promover la más reciente restante.
   * Si era la única → elimina el archivo completo.
   */
  async deleteVersion(
    actor: CoaActor,
    fileId: string,
    version: number,
    reason?: string
  ): Promise<{ ok: true; fileDeleted?: boolean; currentVersion?: number }> {
    assertAdmin(actor);
    await assertFeatureWritesEnabled();
    const file = await this.getFile(fileId);
    if (!file) throw new Error("Archivo no encontrado.");
    const versions = await this.listVersions(actor, fileId);
    const target = versions.find((v) => v.version === version);
    if (!target) throw new Error("Versión no encontrada.");

    if (versions.length <= 1) {
      await this.hardDeleteFile(actor, fileId, reason || `Única versión v${version} eliminada`);
      return { ok: true, fileDeleted: true };
    }

    const storage = getFileStorage();
    try {
      await storage.delete(target.driveFileId);
    } catch {
      throw new Error(
        `No se pudo borrar la versión v${version} en almacenamiento privado. La versión sigue disponible.`
      );
    }

    const remaining = versions
      .filter((v) => v.version !== version)
      .sort((a, b) => b.version - a.version);
    const nextCurrent = remaining[0]!;
    const now = new Date().toISOString();

    try {
      if (isDatabaseConfigured() && (await isFeatureSchemaReady())) {
        const db = getDb();
        await db
          .delete(coaFileVersions)
          .where(
            and(eq(coaFileVersions.fileId, fileId), eq(coaFileVersions.version, version))
          );
        await db
          .update(coaFiles)
          .set({
            driveFileId: nextCurrent.driveFileId,
            currentVersion: nextCurrent.version,
            mimeType: nextCurrent.mimeType,
            sizeBytes: nextCurrent.sizeBytes,
            updatedAt: new Date(now),
            updatedBy: actor.email,
            audit: {
              action: "delete_version",
              at: now,
              by: actor.email,
              reason: reason?.trim() || null,
              deletedVersion: version,
              currentVersion: nextCurrent.version,
            },
          })
          .where(eq(coaFiles.id, fileId));
      } else {
        if (!isFeatureMemoryAllowed()) throw new SchemaPendingError();
        mem().versions = mem().versions.filter(
          (v) => !(v.fileId === fileId && v.version === version)
        );
        const idx = mem().files.findIndex((f) => f.id === fileId);
        if (idx >= 0) {
          mem().files[idx] = {
            ...mem().files[idx]!,
            driveFileId: nextCurrent.driveFileId,
            currentVersion: nextCurrent.version,
            mimeType: nextCurrent.mimeType,
            sizeBytes: nextCurrent.sizeBytes,
            updatedAt: now,
            updatedBy: actor.email,
          };
        }
      }
      await auditCoa(actor, "delete_version", fileId, {
        version,
        reason: reason?.trim() || null,
        currentVersion: nextCurrent.version,
      });
      return { ok: true, currentVersion: nextCurrent.version };
    } catch (err) {
      await auditCoa(actor, "delete_version_inconsistent", fileId, {
        version,
        reason: reason?.trim() || null,
        neonError: err instanceof Error ? err.message : "neon_failed",
        needsAdminRepair: true,
      });
      throw new Error(
        "El Blob de la versión se eliminó pero falló la metadata. No se mostrará como descargable; contactá soporte."
      );
    }
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
    const file = await this.getFile(fileId, { includeArchived: true });
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

  async getFolder(
    id: string,
    options: { includeArchived?: boolean } = {}
  ): Promise<CoaFolderRecord | null> {
    const includeArchived = Boolean(options.includeArchived);
    if (isDatabaseConfigured() && (await isFeatureSchemaReady())) {
      try {
        const db = getDb();
        const [f] = await db.select().from(coaFolders).where(eq(coaFolders.id, id)).limit(1);
        if (!f || (!includeArchived && f.archived)) return null;
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
    const f = mem().folders.find((x) => x.id === id);
    if (!f || (!includeArchived && f.archived)) return null;
    const { archived: _a, ...rest } = f;
    return rest;
  }

  async getFile(
    id: string,
    options: { includeArchived?: boolean } = {}
  ): Promise<CoaFileRecord | null> {
    const includeArchived = Boolean(options.includeArchived);
    if (isDatabaseConfigured() && (await isFeatureSchemaReady())) {
      try {
        const db = getDb();
        const [f] = await db.select().from(coaFiles).where(eq(coaFiles.id, id)).limit(1);
        if (!f || (!includeArchived && f.archived)) return null;
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
    const f = mem().files.find((x) => x.id === id);
    if (!f || (!includeArchived && f.archived)) return null;
    const { archived: _a, ...rest } = f;
    return rest;
  }

  private async isFolderArchived(folderId: string): Promise<boolean> {
    if (isDatabaseConfigured() && (await isFeatureSchemaReady())) {
      try {
        const db = getDb();
        const [f] = await db
          .select({ archived: coaFolders.archived })
          .from(coaFolders)
          .where(eq(coaFolders.id, folderId))
          .limit(1);
        return Boolean(f?.archived);
      } catch {
        if (!isFeatureMemoryAllowed()) return false;
      }
    }
    if (!isFeatureMemoryAllowed()) return false;
    return Boolean(mem().folders.find((f) => f.id === folderId)?.archived);
  }

  private async isFileArchived(fileId: string): Promise<boolean> {
    if (isDatabaseConfigured() && (await isFeatureSchemaReady())) {
      try {
        const db = getDb();
        const [f] = await db
          .select({ archived: coaFiles.archived })
          .from(coaFiles)
          .where(eq(coaFiles.id, fileId))
          .limit(1);
        return Boolean(f?.archived);
      } catch {
        if (!isFeatureMemoryAllowed()) return false;
      }
    }
    if (!isFeatureMemoryAllowed()) return false;
    return Boolean(mem().files.find((f) => f.id === fileId)?.archived);
  }

  private async countFolderChildren(
    folderId: string
  ): Promise<{ subfolders: number; files: number }> {
    if (isDatabaseConfigured() && (await isFeatureSchemaReady())) {
      try {
        const db = getDb();
        const subfolders = await db
          .select({ id: coaFolders.id })
          .from(coaFolders)
          .where(eq(coaFolders.parentId, folderId));
        const files = await db
          .select({ id: coaFiles.id })
          .from(coaFiles)
          .where(eq(coaFiles.folderId, folderId));
        return { subfolders: subfolders.length, files: files.length };
      } catch {
        if (!isFeatureMemoryAllowed()) return { subfolders: 0, files: 0 };
      }
    }
    if (!isFeatureMemoryAllowed()) return { subfolders: 0, files: 0 };
    return {
      subfolders: mem().folders.filter((f) => f.parentId === folderId).length,
      files: mem().files.filter((f) => f.folderId === folderId).length,
    };
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
