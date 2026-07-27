import "server-only";

import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb, isDatabaseConfigured } from "@/lib/db/client";
import { isFeatureMemoryAllowed } from "@/lib/db/feature-schema";
import {
  assertProcedureMetricsWritesEnabled,
  isProcedureMetricsSchemaReady,
} from "@/lib/db/procedure-metrics-schema";
import { OrdersForbiddenError, OrdersNotFoundError, OrdersValidationError } from "@/lib/orders/types";
import type { SectorId } from "@/types/operational/sector";
import {
  assertPrivateFileStorageConfigured,
  getFileStorage,
  procedureStorageKey,
  STORAGE_PROVIDER_VERCEL_BLOB_PRIVATE,
} from "@/lib/storage/file-storage";
import { joinRelativePath, sanitizePathSegment } from "./path-sanitize";
import { mimeMatchesFilter, validateProcedureUpload } from "./upload-validation";
import {
  canAccessProcedimientos,
  canMutateProcedureEntity,
  type ProcedureActor,
  type ProcedureFileRecord,
  type ProcedureFolderRecord,
  type ProcedureListFilters,
  type ProcedureVersionRecord,
  type VersionUploadMode,
} from "./types";

type Mem = {
  folders: ProcedureFolderRecord[];
  files: ProcedureFileRecord[];
  versions: ProcedureVersionRecord[];
};

const g = globalThis as unknown as { __genusProcedimientosMem?: Mem };

function mem(): Mem {
  if (!g.__genusProcedimientosMem) {
    g.__genusProcedimientosMem = { folders: [], files: [], versions: [] };
  }
  return g.__genusProcedimientosMem;
}

export function resetProcedimientosMemoryForTests(): void {
  g.__genusProcedimientosMem = { folders: [], files: [], versions: [] };
}

function assertAccess(actor: ProcedureActor): void {
  if (!canAccessProcedimientos(actor.sector)) {
    throw new OrdersForbiddenError("Sin acceso a Procedimientos.");
  }
}

function assertMutate(actor: ProcedureActor, ownerEmail: string): void {
  if (!canMutateProcedureEntity(actor, ownerEmail)) {
    throw new OrdersForbiddenError("Sin permiso para modificar este recurso.");
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function mapFolder(row: Record<string, unknown>): ProcedureFolderRecord {
  return {
    id: String(row.id),
    parentId: row.parent_id ? String(row.parent_id) : null,
    name: String(row.name),
    relativePath: String(row.relative_path ?? "/"),
    status: String(row.status) as ProcedureFolderRecord["status"],
    createdBy: String(row.created_by),
    createdBySector: String(row.created_by_sector) as SectorId,
    updatedBy: String(row.updated_by ?? ""),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
    archivedAt: row.archived_at ? new Date(String(row.archived_at)).toISOString() : null,
    deletedAt: row.deleted_at ? new Date(String(row.deleted_at)).toISOString() : null,
  };
}

function mapFile(row: Record<string, unknown>): ProcedureFileRecord {
  return {
    id: String(row.id),
    folderId: String(row.folder_id),
    displayName: String(row.display_name),
    relativePath: String(row.relative_path ?? ""),
    mime: String(row.mime),
    sizeBytes: Number(row.size_bytes ?? 0),
    sha256: String(row.sha256 ?? ""),
    currentVersion: Number(row.current_version ?? 1),
    status: String(row.status) as ProcedureFileRecord["status"],
    createdBy: String(row.created_by),
    createdBySector: String(row.created_by_sector) as SectorId,
    updatedBy: String(row.updated_by ?? ""),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
    archivedAt: row.archived_at ? new Date(String(row.archived_at)).toISOString() : null,
    deletedAt: row.deleted_at ? new Date(String(row.deleted_at)).toISOString() : null,
  };
}

function mapVersion(row: Record<string, unknown>): ProcedureVersionRecord {
  return {
    id: String(row.id),
    fileId: String(row.file_id),
    version: Number(row.version),
    storageProvider: String(row.storage_provider),
    storageKey: String(row.storage_key),
    originalName: String(row.original_name),
    displayName: String(row.display_name),
    mime: String(row.mime),
    sizeBytes: Number(row.size_bytes ?? 0),
    sha256: String(row.sha256 ?? ""),
    changeReason: row.change_reason ? String(row.change_reason) : null,
    isCurrent: Boolean(row.is_current),
    createdBy: String(row.created_by),
    createdBySector: String(row.created_by_sector) as SectorId,
    createdAt: new Date(String(row.created_at)).toISOString(),
  };
}

async function audit(
  actor: ProcedureActor,
  action: string,
  entityType: string,
  entityId: string,
  detail: Record<string, unknown> = {}
): Promise<void> {
  if (!(isDatabaseConfigured() && (await isProcedureMetricsSchemaReady()))) return;
  try {
    const db = getDb();
    await db.execute(sql`
      insert into procedure_audit_events (actor_email, actor_sector, action, entity_type, entity_id, detail)
      values (${actor.email}, ${actor.sector}, ${action}, ${entityType}, ${entityId}, ${JSON.stringify(detail)}::jsonb)
    `);
  } catch {
    /* best-effort */
  }
}

export class ProcedimientosService {
  async list(
    actor: ProcedureActor,
    parentId: string | null,
    filters: ProcedureListFilters = {}
  ): Promise<{ folders: ProcedureFolderRecord[]; files: ProcedureFileRecord[] }> {
    assertAccess(actor);
    const includeArchived = filters.includeArchived ?? false;

    if (isDatabaseConfigured() && (await isProcedureMetricsSchemaReady())) {
      try {
        const db = getDb();
        const folderRows = parentId
          ? includeArchived
            ? await db.execute(sql`
                select * from procedure_folders
                where parent_id = ${parentId}::uuid and status in ('active', 'archived')
                order by name
              `)
            : await db.execute(sql`
                select * from procedure_folders
                where parent_id = ${parentId}::uuid and status = 'active'
                order by name
              `)
          : includeArchived
            ? await db.execute(sql`
                select * from procedure_folders
                where parent_id is null and status in ('active', 'archived')
                order by name
              `)
            : await db.execute(sql`
                select * from procedure_folders
                where parent_id is null and status = 'active'
                order by name
              `);
        const fileRows = parentId
          ? includeArchived
            ? await db.execute(sql`
                select * from procedure_files
                where folder_id = ${parentId}::uuid and status in ('active', 'archived')
                order by display_name
              `)
            : await db.execute(sql`
                select * from procedure_files
                where folder_id = ${parentId}::uuid and status = 'active'
                order by display_name
              `)
          : { rows: [] as Record<string, unknown>[] };

        let folders = (folderRows.rows as Record<string, unknown>[]).map(mapFolder);
        let files = (fileRows.rows as Record<string, unknown>[]).map(mapFile);

        if (filters.q) {
          const q = filters.q.toLowerCase();
          folders = folders.filter((f) => f.name.toLowerCase().includes(q));
          files = files.filter((f) => f.displayName.toLowerCase().includes(q));
        }
        if (filters.mimeFilter) {
          files = files.filter((f) => mimeMatchesFilter(f.mime, filters.mimeFilter!));
        }
        return { folders, files };
      } catch {
        if (!isFeatureMemoryAllowed()) return { folders: [], files: [] };
      }
    }

    if (!isFeatureMemoryAllowed()) return { folders: [], files: [] };

    const m = mem();
    let folders = m.folders.filter(
      (f) =>
        f.parentId === parentId &&
        (includeArchived ? f.status !== "deleted" : f.status === "active")
    );
    let files = m.files.filter(
      (f) =>
        f.folderId === (parentId ?? "") &&
        (includeArchived ? f.status !== "deleted" : f.status === "active")
    );
    if (filters.q) {
      const q = filters.q.toLowerCase();
      folders = folders.filter((f) => f.name.toLowerCase().includes(q));
      files = files.filter((f) => f.displayName.toLowerCase().includes(q));
    }
    if (filters.mimeFilter) {
      files = files.filter((f) => mimeMatchesFilter(f.mime, filters.mimeFilter!));
    }
    return { folders, files };
  }

  async search(
    actor: ProcedureActor,
    q: string,
    mimeFilter?: string
  ): Promise<{ folders: ProcedureFolderRecord[]; files: ProcedureFileRecord[] }> {
    assertAccess(actor);
    const query = q.trim().toLowerCase();
    if (!query) return { folders: [], files: [] };

    if (isDatabaseConfigured() && (await isProcedureMetricsSchemaReady())) {
      try {
        const db = getDb();
        const pattern = `%${query}%`;
        const folderRows = await db.execute(sql`
          select * from procedure_folders
          where status = 'active' and lower(name) like ${pattern}
          order by name limit 50
        `);
        const fileRows = await db.execute(sql`
          select * from procedure_files
          where status = 'active' and lower(display_name) like ${pattern}
          order by display_name limit 50
        `);
        let files = (fileRows.rows as Record<string, unknown>[]).map(mapFile);
        if (mimeFilter) {
          files = files.filter((f) => mimeMatchesFilter(f.mime, mimeFilter));
        }
        return {
          folders: (folderRows.rows as Record<string, unknown>[]).map(mapFolder),
          files,
        };
      } catch {
        if (!isFeatureMemoryAllowed()) return { folders: [], files: [] };
      }
    }

    if (!isFeatureMemoryAllowed()) return { folders: [], files: [] };
    const m = mem();
    let files = m.files.filter(
      (f) => f.status === "active" && f.displayName.toLowerCase().includes(query)
    );
    if (mimeFilter) files = files.filter((f) => mimeMatchesFilter(f.mime, mimeFilter));
    return {
      folders: m.folders.filter(
        (f) => f.status === "active" && f.name.toLowerCase().includes(query)
      ),
      files,
    };
  }

  async getFolder(id: string): Promise<ProcedureFolderRecord | null> {
    if (isDatabaseConfigured() && (await isProcedureMetricsSchemaReady())) {
      try {
        const db = getDb();
        const res = await db.execute(sql`select * from procedure_folders where id = ${id}::uuid limit 1`);
        const row = (res.rows as Record<string, unknown>[])[0];
        return row ? mapFolder(row) : null;
      } catch {
        if (!isFeatureMemoryAllowed()) return null;
      }
    }
    if (!isFeatureMemoryAllowed()) return null;
    return mem().folders.find((f) => f.id === id) ?? null;
  }

  async getFile(id: string): Promise<ProcedureFileRecord | null> {
    if (isDatabaseConfigured() && (await isProcedureMetricsSchemaReady())) {
      try {
        const db = getDb();
        const res = await db.execute(sql`select * from procedure_files where id = ${id}::uuid limit 1`);
        const row = (res.rows as Record<string, unknown>[])[0];
        return row ? mapFile(row) : null;
      } catch {
        if (!isFeatureMemoryAllowed()) return null;
      }
    }
    if (!isFeatureMemoryAllowed()) return null;
    return mem().files.find((f) => f.id === id) ?? null;
  }

  async createFolder(
    actor: ProcedureActor,
    name: string,
    parentId: string | null
  ): Promise<ProcedureFolderRecord> {
    assertAccess(actor);
    await assertProcedureMetricsWritesEnabled();
    const clean = sanitizePathSegment(name);
    let relativePath = `/${clean}`;
    if (parentId) {
      const parent = await this.getFolder(parentId);
      if (!parent || parent.status === "deleted") {
        throw new OrdersNotFoundError("Carpeta padre no encontrada.");
      }
      relativePath = `${parent.relativePath.replace(/\/$/, "")}/${clean}`;
    }

    const id = randomUUID();
    const now = nowIso();
    const folder: ProcedureFolderRecord = {
      id,
      parentId,
      name: clean,
      relativePath,
      status: "active",
      createdBy: actor.email,
      createdBySector: actor.sector,
      updatedBy: actor.email,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      deletedAt: null,
    };

    if (isDatabaseConfigured() && (await isProcedureMetricsSchemaReady())) {
      const db = getDb();
      await db.execute(sql`
        insert into procedure_folders (id, parent_id, name, relative_path, status, created_by, created_by_sector, updated_by, created_at, updated_at)
        values (${id}::uuid, ${parentId}::uuid, ${clean}, ${relativePath}, 'active', ${actor.email}, ${actor.sector}, ${actor.email}, ${now}::timestamptz, ${now}::timestamptz)
      `);
    } else if (isFeatureMemoryAllowed()) {
      mem().folders.push(folder);
    }

    await audit(actor, "mkdir", "folder", id, { name: clean, path: relativePath });
    return folder;
  }

  /**
   * Crea (o reutiliza) la cadena de carpetas bajo `baseParentId`.
   * segments: ["CALIDAD", "Controles"] → carpeta hoja.
   */
  async ensureFolderPath(
    actor: ProcedureActor,
    baseParentId: string | null,
    segments: string[]
  ): Promise<ProcedureFolderRecord | null> {
    assertAccess(actor);
    await assertProcedureMetricsWritesEnabled();
    let parentId = baseParentId;
    let last: ProcedureFolderRecord | null = null;
    for (const raw of segments) {
      const name = sanitizePathSegment(raw);
      if (!name) continue;
      const listed = await this.list(actor, parentId, {});
      const existing = listed.folders.find(
        (f) => f.status === "active" && f.name.toLowerCase() === name.toLowerCase()
      );
      if (existing) {
        last = existing;
        parentId = existing.id;
        continue;
      }
      last = await this.createFolder(actor, name, parentId);
      parentId = last.id;
    }
    return last;
  }

  async upload(
    actor: ProcedureActor,
    params: {
      folderId: string;
      fileName: string;
      mimeType: string;
      bytes: Buffer;
      relativePath?: string;
      mode?: VersionUploadMode;
      existingFileId?: string;
      changeReason?: string;
    }
  ): Promise<ProcedureFileRecord> {
    assertAccess(actor);
    await assertProcedureMetricsWritesEnabled();
    if (!isFeatureMemoryAllowed()) assertPrivateFileStorageConfigured();

    validateProcedureUpload({
      fileName: params.fileName,
      mimeType: params.mimeType,
      sizeBytes: params.bytes.length,
    });

    const folder = await this.getFolder(params.folderId);
    if (!folder || folder.status === "deleted") {
      throw new OrdersNotFoundError("Carpeta no encontrada.");
    }

    const storage = getFileStorage();
    const sha256 = storage.sha256(params.bytes);
    const now = nowIso();
    const relPath = params.relativePath
      ? joinRelativePath(folder.relativePath.replace(/^\//, ""), params.fileName)
      : params.fileName;

    if (params.mode === "new_version" && params.existingFileId) {
      const existing = await this.getFile(params.existingFileId);
      if (!existing) throw new OrdersNotFoundError("Archivo no encontrado.");
      assertMutate(actor, existing.createdBy);
      const nextVersion = existing.currentVersion + 1;
      const fileId = existing.id;
      const key = procedureStorageKey({
        folderId: params.folderId,
        fileId,
        version: nextVersion,
        fileName: params.fileName,
      });
      const put = await storage.put({
        storageKey: key,
        bytes: params.bytes,
        contentType: params.mimeType,
      });

      const version: ProcedureVersionRecord = {
        id: randomUUID(),
        fileId,
        version: nextVersion,
        storageProvider: STORAGE_PROVIDER_VERCEL_BLOB_PRIVATE,
        storageKey: put.storageKey,
        originalName: params.fileName,
        displayName: existing.displayName,
        mime: params.mimeType,
        sizeBytes: params.bytes.length,
        sha256: put.sha256,
        changeReason: params.changeReason ?? null,
        isCurrent: true,
        createdBy: actor.email,
        createdBySector: actor.sector,
        createdAt: now,
      };

      const updated: ProcedureFileRecord = {
        ...existing,
        mime: params.mimeType,
        sizeBytes: params.bytes.length,
        sha256: put.sha256,
        currentVersion: nextVersion,
        updatedBy: actor.email,
        updatedAt: now,
      };

      if (isDatabaseConfigured() && (await isProcedureMetricsSchemaReady())) {
        const db = getDb();
        await db.execute(sql`update procedure_file_versions set is_current = false where file_id = ${fileId}::uuid`);
        await db.execute(sql`
          insert into procedure_file_versions (id, file_id, version, storage_provider, storage_key, original_name, display_name, mime, size_bytes, sha256, change_reason, is_current, created_by, created_by_sector, created_at)
          values (${version.id}::uuid, ${fileId}::uuid, ${nextVersion}, ${version.storageProvider}, ${put.storageKey}, ${params.fileName}, ${existing.displayName}, ${params.mimeType}, ${params.bytes.length}, ${put.sha256}, ${params.changeReason ?? null}, true, ${actor.email}, ${actor.sector}, ${now}::timestamptz)
        `);
        await db.execute(sql`
          update procedure_files set mime = ${params.mimeType}, size_bytes = ${params.bytes.length}, sha256 = ${put.sha256}, current_version = ${nextVersion}, updated_by = ${actor.email}, updated_at = ${now}::timestamptz
          where id = ${fileId}::uuid
        `);
      } else if (isFeatureMemoryAllowed()) {
        const m = mem();
        m.versions.forEach((v) => {
          if (v.fileId === fileId) v.isCurrent = false;
        });
        m.versions.push(version);
        const idx = m.files.findIndex((f) => f.id === fileId);
        if (idx >= 0) m.files[idx] = updated;
      }

      await audit(actor, "new_version", "file", fileId, { version: nextVersion });
      return updated;
    }

    const fileId = randomUUID();
    const key = procedureStorageKey({
      folderId: params.folderId,
      fileId,
      version: 1,
      fileName: params.fileName,
    });
    const put = await storage.put({
      storageKey: key,
      bytes: params.bytes,
      contentType: params.mimeType,
    });

    const file: ProcedureFileRecord = {
      id: fileId,
      folderId: params.folderId,
      displayName: params.fileName,
      relativePath: relPath,
      mime: params.mimeType,
      sizeBytes: params.bytes.length,
      sha256: put.sha256,
      currentVersion: 1,
      status: "active",
      createdBy: actor.email,
      createdBySector: actor.sector,
      updatedBy: actor.email,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      deletedAt: null,
    };

    const version: ProcedureVersionRecord = {
      id: randomUUID(),
      fileId,
      version: 1,
      storageProvider: STORAGE_PROVIDER_VERCEL_BLOB_PRIVATE,
      storageKey: put.storageKey,
      originalName: params.fileName,
      displayName: params.fileName,
      mime: params.mimeType,
      sizeBytes: params.bytes.length,
      sha256: put.sha256,
      changeReason: null,
      isCurrent: true,
      createdBy: actor.email,
      createdBySector: actor.sector,
      createdAt: now,
    };

    if (isDatabaseConfigured() && (await isProcedureMetricsSchemaReady())) {
      const db = getDb();
      await db.execute(sql`
        insert into procedure_files (id, folder_id, display_name, relative_path, mime, size_bytes, sha256, current_version, status, created_by, created_by_sector, updated_by, created_at, updated_at)
        values (${fileId}::uuid, ${params.folderId}::uuid, ${params.fileName}, ${relPath}, ${params.mimeType}, ${params.bytes.length}, ${put.sha256}, 1, 'active', ${actor.email}, ${actor.sector}, ${actor.email}, ${now}::timestamptz, ${now}::timestamptz)
      `);
      await db.execute(sql`
        insert into procedure_file_versions (id, file_id, version, storage_provider, storage_key, original_name, display_name, mime, size_bytes, sha256, is_current, created_by, created_by_sector, created_at)
        values (${version.id}::uuid, ${fileId}::uuid, 1, ${version.storageProvider}, ${put.storageKey}, ${params.fileName}, ${params.fileName}, ${params.mimeType}, ${params.bytes.length}, ${put.sha256}, true, ${actor.email}, ${actor.sector}, ${now}::timestamptz)
      `);
    } else if (isFeatureMemoryAllowed()) {
      mem().files.push(file);
      mem().versions.push(version);
    }

    await audit(actor, "upload", "file", fileId, { name: params.fileName });
    return file;
  }

  async listVersions(actor: ProcedureActor, fileId: string): Promise<ProcedureVersionRecord[]> {
    assertAccess(actor);
    const file = await this.getFile(fileId);
    if (!file) throw new OrdersNotFoundError("Archivo no encontrado.");

    if (isDatabaseConfigured() && (await isProcedureMetricsSchemaReady())) {
      try {
        const db = getDb();
        const res = await db.execute(sql`
          select * from procedure_file_versions where file_id = ${fileId}::uuid order by version desc
        `);
        return (res.rows as Record<string, unknown>[]).map(mapVersion);
      } catch {
        if (!isFeatureMemoryAllowed()) return [];
      }
    }
    if (!isFeatureMemoryAllowed()) return [];
    return mem().versions.filter((v) => v.fileId === fileId).sort((a, b) => b.version - a.version);
  }

  async downloadVersion(
    actor: ProcedureActor,
    fileId: string,
    version?: number
  ): Promise<{ bytes: Buffer; mimeType: string; fileName: string }> {
    assertAccess(actor);
    const file = await this.getFile(fileId);
    if (!file || file.status === "deleted") {
      throw new OrdersNotFoundError("Archivo no encontrado.");
    }

    let ver: ProcedureVersionRecord | undefined;
    const versions = await this.listVersions(actor, fileId);
    if (version != null) {
      ver = versions.find((v) => v.version === version);
    } else {
      ver = versions.find((v) => v.isCurrent) ?? versions[0];
    }
    if (!ver) throw new OrdersNotFoundError("Versión no encontrada.");

    const storage = getFileStorage();
    const result = await storage.get(ver.storageKey);
    return {
      bytes: result.bytes,
      mimeType: ver.mime,
      fileName: ver.displayName,
    };
  }

  async renameFolder(actor: ProcedureActor, folderId: string, name: string): Promise<ProcedureFolderRecord> {
    assertAccess(actor);
    await assertProcedureMetricsWritesEnabled();
    const folder = await this.getFolder(folderId);
    if (!folder || folder.status === "deleted") throw new OrdersNotFoundError("Carpeta no encontrada.");
    assertMutate(actor, folder.createdBy);
    const clean = sanitizePathSegment(name);
    const now = nowIso();
    const updated = { ...folder, name: clean, updatedBy: actor.email, updatedAt: now };

    if (isDatabaseConfigured() && (await isProcedureMetricsSchemaReady())) {
      const db = getDb();
      await db.execute(sql`update procedure_folders set name = ${clean}, updated_by = ${actor.email}, updated_at = ${now}::timestamptz where id = ${folderId}::uuid`);
    } else if (isFeatureMemoryAllowed()) {
      const idx = mem().folders.findIndex((f) => f.id === folderId);
      if (idx >= 0) mem().folders[idx] = updated;
    }
    await audit(actor, "rename_folder", "folder", folderId, { name: clean });
    return updated;
  }

  async archiveFolder(actor: ProcedureActor, folderId: string): Promise<void> {
    assertAccess(actor);
    await assertProcedureMetricsWritesEnabled();
    const folder = await this.getFolder(folderId);
    if (!folder) throw new OrdersNotFoundError("Carpeta no encontrada.");
    assertMutate(actor, folder.createdBy);
    const now = nowIso();
    if (isDatabaseConfigured() && (await isProcedureMetricsSchemaReady())) {
      const db = getDb();
      await db.execute(sql`update procedure_folders set status = 'archived', archived_at = ${now}::timestamptz, updated_by = ${actor.email}, updated_at = ${now}::timestamptz where id = ${folderId}::uuid`);
    } else if (isFeatureMemoryAllowed()) {
      const f = mem().folders.find((x) => x.id === folderId);
      if (f) { f.status = "archived"; f.archivedAt = now; f.updatedAt = now; }
    }
    await audit(actor, "archive_folder", "folder", folderId);
  }

  async restoreFolder(actor: ProcedureActor, folderId: string): Promise<void> {
    assertAccess(actor);
    await assertProcedureMetricsWritesEnabled();
    const folder = await this.getFolder(folderId);
    if (!folder) throw new OrdersNotFoundError("Carpeta no encontrada.");
    assertMutate(actor, folder.createdBy);
    const now = nowIso();
    if (isDatabaseConfigured() && (await isProcedureMetricsSchemaReady())) {
      const db = getDb();
      await db.execute(sql`update procedure_folders set status = 'active', archived_at = null, updated_by = ${actor.email}, updated_at = ${now}::timestamptz where id = ${folderId}::uuid`);
    } else if (isFeatureMemoryAllowed()) {
      const f = mem().folders.find((x) => x.id === folderId);
      if (f) { f.status = "active"; f.archivedAt = null; f.updatedAt = now; }
    }
    await audit(actor, "restore_folder", "folder", folderId);
  }

  async deleteFolder(actor: ProcedureActor, folderId: string): Promise<void> {
    assertAccess(actor);
    await assertProcedureMetricsWritesEnabled();
    const folder = await this.getFolder(folderId);
    if (!folder) throw new OrdersNotFoundError("Carpeta no encontrada.");
    assertMutate(actor, folder.createdBy);
    const files = mem().files.filter((f) => f.folderId === folderId && f.status !== "deleted");
    for (const file of files.length ? files : await this.listFilesInFolder(folderId)) {
      await this.deleteFile(actor, file.id);
    }
    const now = nowIso();
    if (isDatabaseConfigured() && (await isProcedureMetricsSchemaReady())) {
      const db = getDb();
      await db.execute(sql`update procedure_folders set status = 'deleted', deleted_at = ${now}::timestamptz, updated_by = ${actor.email}, updated_at = ${now}::timestamptz where id = ${folderId}::uuid`);
    } else if (isFeatureMemoryAllowed()) {
      const f = mem().folders.find((x) => x.id === folderId);
      if (f) { f.status = "deleted"; f.deletedAt = now; }
    }
    await audit(actor, "delete_folder", "folder", folderId);
  }

  private async listFilesInFolder(folderId: string): Promise<ProcedureFileRecord[]> {
    if (isDatabaseConfigured() && (await isProcedureMetricsSchemaReady())) {
      const db = getDb();
      const res = await db.execute(sql`select * from procedure_files where folder_id = ${folderId}::uuid and status != 'deleted'`);
      return (res.rows as Record<string, unknown>[]).map(mapFile);
    }
    return mem().files.filter((f) => f.folderId === folderId && f.status !== "deleted");
  }

  async archiveFile(actor: ProcedureActor, fileId: string): Promise<void> {
    assertAccess(actor);
    await assertProcedureMetricsWritesEnabled();
    const file = await this.getFile(fileId);
    if (!file) throw new OrdersNotFoundError("Archivo no encontrado.");
    assertMutate(actor, file.createdBy);
    const now = nowIso();
    if (isDatabaseConfigured() && (await isProcedureMetricsSchemaReady())) {
      const db = getDb();
      await db.execute(sql`update procedure_files set status = 'archived', archived_at = ${now}::timestamptz, updated_by = ${actor.email}, updated_at = ${now}::timestamptz where id = ${fileId}::uuid`);
    } else if (isFeatureMemoryAllowed()) {
      const f = mem().files.find((x) => x.id === fileId);
      if (f) { f.status = "archived"; f.archivedAt = now; }
    }
    await audit(actor, "archive_file", "file", fileId);
  }

  async restoreFile(actor: ProcedureActor, fileId: string): Promise<void> {
    assertAccess(actor);
    await assertProcedureMetricsWritesEnabled();
    const file = await this.getFile(fileId);
    if (!file) throw new OrdersNotFoundError("Archivo no encontrado.");
    assertMutate(actor, file.createdBy);
    const now = nowIso();
    if (isDatabaseConfigured() && (await isProcedureMetricsSchemaReady())) {
      const db = getDb();
      await db.execute(sql`update procedure_files set status = 'active', archived_at = null, updated_by = ${actor.email}, updated_at = ${now}::timestamptz where id = ${fileId}::uuid`);
    } else if (isFeatureMemoryAllowed()) {
      const f = mem().files.find((x) => x.id === fileId);
      if (f) { f.status = "active"; f.archivedAt = null; }
    }
    await audit(actor, "restore_file", "file", fileId);
  }

  async deleteFile(actor: ProcedureActor, fileId: string): Promise<void> {
    assertAccess(actor);
    await assertProcedureMetricsWritesEnabled();
    const file = await this.getFile(fileId);
    if (!file) throw new OrdersNotFoundError("Archivo no encontrado.");
    assertMutate(actor, file.createdBy);

    const versions = await this.listVersions(actor, fileId);
    const storage = getFileStorage();
    for (const v of versions) {
      try {
        await storage.delete(v.storageKey);
      } catch {
        throw new OrdersValidationError(
          "No se pudo eliminar el archivo del almacenamiento. Metadatos conservados."
        );
      }
    }

    const now = nowIso();
    if (isDatabaseConfigured() && (await isProcedureMetricsSchemaReady())) {
      const db = getDb();
      await db.execute(sql`update procedure_files set status = 'deleted', deleted_at = ${now}::timestamptz, updated_by = ${actor.email}, updated_at = ${now}::timestamptz where id = ${fileId}::uuid`);
    } else if (isFeatureMemoryAllowed()) {
      const f = mem().files.find((x) => x.id === fileId);
      if (f) { f.status = "deleted"; f.deletedAt = now; }
      mem().versions = mem().versions.filter((v) => v.fileId !== fileId);
    }
    await audit(actor, "delete_file", "file", fileId);
  }

  async renameFile(actor: ProcedureActor, fileId: string, displayName: string): Promise<ProcedureFileRecord> {
    assertAccess(actor);
    await assertProcedureMetricsWritesEnabled();
    const file = await this.getFile(fileId);
    if (!file || file.status === "deleted") throw new OrdersNotFoundError("Archivo no encontrado.");
    assertMutate(actor, file.createdBy);
    const clean = displayName.trim();
    if (!clean) throw new OrdersValidationError("Nombre obligatorio.");
    const now = nowIso();
    const updated = { ...file, displayName: clean, updatedBy: actor.email, updatedAt: now };

    if (isDatabaseConfigured() && (await isProcedureMetricsSchemaReady())) {
      const db = getDb();
      await db.execute(sql`update procedure_files set display_name = ${clean}, updated_by = ${actor.email}, updated_at = ${now}::timestamptz where id = ${fileId}::uuid`);
    } else if (isFeatureMemoryAllowed()) {
      const idx = mem().files.findIndex((f) => f.id === fileId);
      if (idx >= 0) mem().files[idx] = updated;
    }
    await audit(actor, "rename_file", "file", fileId, { name: clean });
    return updated;
  }
}

let singleton: ProcedimientosService | null = null;

export function getProcedimientosService(): ProcedimientosService {
  if (!singleton) singleton = new ProcedimientosService();
  return singleton;
}
