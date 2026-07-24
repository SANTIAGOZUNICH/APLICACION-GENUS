import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { and, eq, isNull } from "drizzle-orm";
import { getDb, isDatabaseConfigured } from "@/lib/db/client";
import { coaFileVersions, coaFiles, coaFolders } from "@/lib/db/schema";
import {
  assertCoasFolderConfigured,
  getDriveWriteClient,
  validateCoaUpload,
} from "./drive-write";
import {
  canAdminCoas,
  canViewCoas,
  type CoaFileRecord,
  type CoaFolderRecord,
} from "./types";
import type { SectorId } from "@/types/operational/sector";

export type CoaActor = { email: string; sector: SectorId };

type Mem = {
  folders: CoaFolderRecord[];
  files: CoaFileRecord[];
  versions: Array<{
    id: string;
    fileId: string;
    version: number;
    driveFileId: string;
    mimeType: string;
    sizeBytes: number;
    uploadedBy: string;
    createdAt: string;
  }>;
};

const g = globalThis as unknown as { __genusCoaMem?: Mem };
function mem(): Mem {
  if (!g.__genusCoaMem) g.__genusCoaMem = { folders: [], files: [], versions: [] };
  return g.__genusCoaMem;
}

function assertView(a: CoaActor) {
  if (!canViewCoas(a.sector)) throw new Error("Sin acceso a COA'S.");
}
function assertAdmin(a: CoaActor) {
  if (!canAdminCoas(a.sector)) throw new Error("Solo MP administra COA'S.");
}

export class CoaService {
  async list(
    actor: CoaActor,
    parentId: string | null
  ): Promise<{ folders: CoaFolderRecord[]; files: CoaFileRecord[] }> {
    assertView(actor);
    if (isDatabaseConfigured()) {
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
        /* mem */
      }
    }
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
    const clean = name.trim();
    if (!clean) throw new Error("Nombre obligatorio.");
    let parentDriveId = "mem-root";
    let path = `/${clean}`;
    try {
      parentDriveId = assertCoasFolderConfigured();
    } catch {
      if (process.env.NODE_ENV !== "test" && process.env.GOOGLE_DRIVE_COAS_FOLDER_ID) {
        throw new Error("GOOGLE_DRIVE_COAS_FOLDER_ID no configurada.");
      }
    }
    if (parentId) {
      const parent = await this.getFolder(parentId);
      if (!parent) throw new Error("Carpeta padre no encontrada.");
      parentDriveId = parent.driveFolderId;
      path = `${parent.path.replace(/\/$/, "")}/${clean}`;
    }

    let driveFolderId = `mem-${randomUUID()}`;
    try {
      const drive = await getDriveWriteClient();
      const created = await drive.files.create({
        requestBody: {
          name: clean,
          mimeType: "application/vnd.google-apps.folder",
          parents: [parentDriveId],
        },
        fields: "id",
        supportsAllDrives: true,
      });
      driveFolderId = created.data.id!;
    } catch (err) {
      // Sin credenciales / sin APPLY: memoria con id sintético
      if (process.env.NODE_ENV === "test" || !process.env.GOOGLE_DRIVE_COAS_FOLDER_ID) {
        /* ok */
      } else if (!(err instanceof Error && /no configurada|Credenciales/i.test(err.message))) {
        throw err;
      }
    }

    const now = new Date().toISOString();
    const folder: CoaFolderRecord = {
      id: randomUUID(),
      parentId,
      name: clean,
      driveFolderId,
      path,
      createdBy: actor.email,
      createdAt: now,
      updatedAt: now,
    };
    await this.persistFolder(folder);
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
    validateCoaUpload({
      fileName: params.fileName,
      mimeType: params.mimeType,
      sizeBytes: params.bytes.length,
    });
    const folder = await this.getFolder(params.folderId);
    if (!folder) throw new Error("Carpeta no encontrada.");

    let driveFileId = `mem-file-${randomUUID()}`;
    try {
      const drive = await getDriveWriteClient();
      const res = await drive.files.create({
        requestBody: {
          name: params.fileName,
          parents: [folder.driveFolderId],
        },
        media: {
          mimeType: params.mimeType,
          body: Readable.from(params.bytes),
        },
        fields: "id,size,mimeType",
        supportsAllDrives: true,
      });
      driveFileId = res.data.id!;
    } catch (err) {
      if (
        process.env.NODE_ENV === "test" ||
        !process.env.GOOGLE_DRIVE_COAS_FOLDER_ID
      ) {
        /* mem */
      } else {
        throw err;
      }
    }

    const now = new Date().toISOString();

    if (params.replaceFileId) {
      const existing = await this.getFile(params.replaceFileId);
      if (!existing) throw new Error("Archivo a reemplazar no encontrado.");
      const nextVersion = existing.currentVersion + 1;
      const updated: CoaFileRecord = {
        ...existing,
        name: params.fileName,
        mimeType: params.mimeType,
        sizeBytes: params.bytes.length,
        driveFileId,
        currentVersion: nextVersion,
        updatedBy: actor.email,
        updatedAt: now,
      };
      await this.persistFile(updated);
      await this.persistVersion({
        id: randomUUID(),
        fileId: updated.id,
        version: nextVersion,
        driveFileId,
        mimeType: params.mimeType,
        sizeBytes: params.bytes.length,
        uploadedBy: actor.email,
        createdAt: now,
      });
      return updated;
    }

    const file: CoaFileRecord = {
      id: randomUUID(),
      folderId: params.folderId,
      name: params.fileName,
      mimeType: params.mimeType,
      sizeBytes: params.bytes.length,
      driveFileId,
      currentVersion: 1,
      createdBy: actor.email,
      updatedBy: actor.email,
      createdAt: now,
      updatedAt: now,
    };
    try {
      await this.persistFile(file);
      await this.persistVersion({
        id: randomUUID(),
        fileId: file.id,
        version: 1,
        driveFileId,
        mimeType: params.mimeType,
        sizeBytes: params.bytes.length,
        uploadedBy: actor.email,
        createdAt: now,
      });
    } catch (err) {
      // Rollback Drive si metadata falla
      try {
        const drive = await getDriveWriteClient();
        await drive.files.update({
          fileId: driveFileId,
          requestBody: { trashed: true },
          supportsAllDrives: true,
        });
      } catch {
        /* ignore */
      }
      throw err;
    }
    return file;
  }

  async getFolder(id: string): Promise<CoaFolderRecord | null> {
    if (isDatabaseConfigured()) {
      try {
        const db = getDb();
        const [f] = await db.select().from(coaFolders).where(eq(coaFolders.id, id)).limit(1);
        if (!f) return null;
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
        /* mem */
      }
    }
    return mem().folders.find((f) => f.id === id) ?? null;
  }

  async getFile(id: string): Promise<CoaFileRecord | null> {
    if (isDatabaseConfigured()) {
      try {
        const db = getDb();
        const [f] = await db.select().from(coaFiles).where(eq(coaFiles.id, id)).limit(1);
        if (!f) return null;
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
        /* mem */
      }
    }
    return mem().files.find((f) => f.id === id) ?? null;
  }

  private async persistFolder(folder: CoaFolderRecord) {
    if (isDatabaseConfigured()) {
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
          audit: {},
        });
        return;
      } catch {
        /* mem */
      }
    }
    mem().folders.push(folder);
  }

  private async persistFile(file: CoaFileRecord) {
    if (isDatabaseConfigured()) {
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
            audit: {},
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
            },
          });
        return;
      } catch {
        /* mem */
      }
    }
    const idx = mem().files.findIndex((f) => f.id === file.id);
    if (idx >= 0) mem().files[idx] = file;
    else mem().files.push(file);
  }

  private async persistVersion(v: Mem["versions"][number]) {
    if (isDatabaseConfigured()) {
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
        });
        return;
      } catch {
        /* mem */
      }
    }
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
