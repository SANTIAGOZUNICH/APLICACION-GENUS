import "server-only";

import { google } from "googleapis";
import { createGoogleAuth } from "@/lib/adapters/google/google-auth";
import type { DocumentRef } from "@/lib/adapters/drive/types/document.types";
import type { OperationsFolderKey } from "@/lib/adapters/drive/types/document.types";
import { SPREADSHEET_MIME } from "@/lib/adapters/sheets/sheets-reader";

/** Low-level Google Drive API access — internal infrastructure only. */
export class GoogleDriveGateway {
  async getFileMetadata(fileId: string): Promise<DocumentRef | null> {
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
        folderKey: "genus",
      };
    } catch {
      return null;
    }
  }

  async listSpreadsheetsInFolder(
    folderId: string,
    folderKey: OperationsFolderKey,
    options?: { pageSize?: number }
  ): Promise<DocumentRef[]> {
    const auth = createGoogleAuth();
    const drive = google.drive({ version: "v3", auth });
    const pageSize = options?.pageSize ?? 1000;
    const files: DocumentRef[] = [];
    let pageToken: string | undefined;

    do {
      const response = await drive.files.list({
        q: `'${folderId}' in parents and mimeType='${SPREADSHEET_MIME}' and trashed=false`,
        fields: "nextPageToken, files(id,name,mimeType,modifiedTime)",
        pageSize,
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
          folderKey,
        });
      }

      pageToken = response.data.nextPageToken ?? undefined;
    } while (pageToken);

    return files;
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
}

export const googleDriveGateway = new GoogleDriveGateway();
