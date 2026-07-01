import "server-only";

import { google } from "googleapis";
import { createGoogleAuth } from "@/lib/adapters/google/google-auth";
import type {
  DocumentRef,
  FolderAlias,
  FolderIndexEntry,
} from "@/lib/adapters/drive/types/document.types";
import { getMaxIndexDepth } from "@/lib/adapters/drive/drive-folder-config";
import { SPREADSHEET_MIME } from "@/lib/adapters/sheets/sheets-reader";
import { buildTabularMimeQuery } from "@/lib/adapters/excel/excel-mime";

export const FOLDER_MIME = "application/vnd.google-apps.folder";

interface DriveChildFolder {
  folderId: string;
  name: string;
}

/** Low-level Google Drive API — internal infrastructure only. */
export class GoogleDriveGateway {
  async getFileMetadata(fileId: string): Promise<Pick<DocumentRef, "fileId" | "name" | "mimeType" | "modifiedTime"> | null> {
    const auth = createGoogleAuth();
    const drive = google.drive({ version: "v3", auth });

    try {
      const response = await drive.files.get({
        fileId,
        fields: "id,name,mimeType,modifiedTime",
        supportsAllDrives: true,
      });

      if (!response.data.id || !response.data.name) {
        return null;
      }

      return {
        fileId: response.data.id,
        name: response.data.name,
        mimeType: response.data.mimeType ?? SPREADSHEET_MIME,
        modifiedTime: response.data.modifiedTime ?? undefined,
      };
    } catch {
      return null;
    }
  }

  async canAccessFolder(folderId: string): Promise<boolean> {
    const auth = createGoogleAuth();
    const drive = google.drive({ version: "v3", auth });

    try {
      await drive.files.get({
        fileId: folderId,
        fields: "id,name",
        supportsAllDrives: true,
      });
      return true;
    } catch {
      return false;
    }
  }

  async listSubfolders(parentFolderId: string): Promise<DriveChildFolder[]> {
    const auth = createGoogleAuth();
    const drive = google.drive({ version: "v3", auth });
    const folders: DriveChildFolder[] = [];
    let pageToken: string | undefined;

    do {
      const response = await drive.files.list({
        q: `'${parentFolderId}' in parents and mimeType='${FOLDER_MIME}' and trashed=false`,
        fields: "nextPageToken, files(id,name)",
        pageSize: 200,
        pageToken,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });

      for (const file of response.data.files ?? []) {
        if (!file.id || !file.name) continue;
        folders.push({ folderId: file.id, name: file.name });
      }

      pageToken = response.data.nextPageToken ?? undefined;
    } while (pageToken);

    return folders;
  }

  async listSpreadsheetsInFolder(
    folderId: string,
    context: { alias: FolderAlias; folderPath?: string }
  ): Promise<DocumentRef[]> {
    return this.listTabularFilesInFolder(folderId, context);
  }

  /** Lists Google Sheets and Excel (.xlsx/.xls) files in a folder. */
  async listTabularFilesInFolder(
    folderId: string,
    context: { alias: FolderAlias; folderPath?: string }
  ): Promise<DocumentRef[]> {
    const auth = createGoogleAuth();
    const drive = google.drive({ version: "v3", auth });
    const files: DocumentRef[] = [];
    let pageToken: string | undefined;

    do {
      const response = await drive.files.list({
        q: `'${folderId}' in parents and (${buildTabularMimeQuery()}) and trashed=false`,
        fields: "nextPageToken, files(id,name,mimeType,modifiedTime)",
        pageSize: 200,
        pageToken,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });

      for (const file of response.data.files ?? []) {
        if (!file.id || !file.name) continue;
        files.push({
          fileId: file.id,
          name: file.name,
          mimeType: file.mimeType ?? SPREADSHEET_MIME,
          modifiedTime: file.modifiedTime ?? undefined,
          folderAlias: context.alias,
          folderPath: context.folderPath,
        });
      }

      pageToken = response.data.nextPageToken ?? undefined;
    } while (pageToken);

    return files;
  }

  /**
   * BFS crawl from GENUS root — builds folder index up to maxDepth.
   * Does NOT open any spreadsheets.
   */
  async buildFolderIndex(
    genusFolderId: string,
    maxDepth = getMaxIndexDepth()
  ): Promise<{
    entries: FolderIndexEntry[];
    foldersScanned: number;
    maxDepthUsed: number;
  }> {
    const entries: FolderIndexEntry[] = [];
    let maxDepthUsed = 0;

    type QueueItem = {
      folderId: string;
      parentId: string | null;
      relativePath: string;
      depth: number;
    };

    const queue: QueueItem[] = [
      { folderId: genusFolderId, parentId: null, relativePath: "", depth: 0 },
    ];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current.folderId)) continue;
      visited.add(current.folderId);

      if (current.depth > 0) {
        const metadata = await this.getFileMetadata(current.folderId);
        entries.push({
          folderId: current.folderId,
          name: metadata?.name ?? current.folderId,
          parentId: current.parentId,
          relativePath: current.relativePath,
          depth: current.depth,
        });
        maxDepthUsed = Math.max(maxDepthUsed, current.depth);
      }

      if (current.depth >= maxDepth) continue;

      const children = await this.listSubfolders(current.folderId);
      for (const child of children) {
        const childPath = current.relativePath
          ? `${current.relativePath}/${child.name}`
          : child.name;

        queue.push({
          folderId: child.folderId,
          parentId: current.folderId,
          relativePath: childPath,
          depth: current.depth + 1,
        });
      }
    }

    return {
      entries,
      foldersScanned: entries.length,
      maxDepthUsed,
    };
  }
}

export const googleDriveGateway = new GoogleDriveGateway();
