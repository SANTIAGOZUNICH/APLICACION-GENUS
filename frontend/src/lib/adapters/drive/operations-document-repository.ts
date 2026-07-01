import "server-only";

import {
  CRITICAL_SHEET_FOLDER,
  CRITICAL_SHEET_NAMES,
  getCriticalSheetFastPathId,
  getFolderId,
  hasAnyFolderConfigured,
} from "@/lib/adapters/drive/drive-folder-config";
import { serverCache } from "@/lib/adapters/drive/cache/server-cache";
import { googleDriveGateway } from "@/lib/adapters/drive/google-drive-gateway";
import {
  normalizeOeId,
  parseOeIdFromFileName,
} from "@/lib/adapters/drive/parse-oe-id";
import type {
  CriticalSheetKey,
  DocumentRef,
  DriveHealthResult,
  OeIndexEntry,
  OperationsFolderKey,
  RefreshResult,
  RefreshScope,
} from "@/lib/adapters/drive/types/document.types";
import { hasGoogleCredentials } from "@/lib/adapters/google/google-auth";
import { getServerDataMode } from "@/lib/config/data-mode";

const CACHE_PREFIX = {
  folder: "docrepo:folder:",
  critical: "docrepo:critical:",
  oeIndex: "docrepo:oe-index",
  oeById: "docrepo:oe:",
} as const;

/**
 * OperationsDocumentRepository — document index abstraction.
 * Internally uses Google Drive today; swappable for API/S3/DB later.
 * Drive is an index/repository, NOT a database — metadata only, no mass reads.
 */
export class OperationsDocumentRepository {
  private indexReady = false;
  private refreshInFlight: Promise<RefreshResult> | null = null;

  async health(): Promise<DriveHealthResult> {
    const mode = getServerDataMode();
    const credentialsConfigured = hasGoogleCredentials();
    const foldersConfigured = hasAnyFolderConfigured();
    const cache = serverCache.stats();

    if (mode !== "real") {
      return {
        ok: true,
        mode: "demo",
        credentialsConfigured,
        foldersConfigured,
        cache,
        message: "Modo demo activo.",
      };
    }

    if (!credentialsConfigured) {
      return {
        ok: false,
        mode: "real",
        credentialsConfigured: false,
        foldersConfigured,
        cache,
        message: "Credenciales Google no configuradas.",
      };
    }

    if (!foldersConfigured) {
      return {
        ok: false,
        mode: "real",
        credentialsConfigured: true,
        foldersConfigured: false,
        cache,
        message:
          "Folder IDs no configurados. Configurá GOOGLE_DRIVE_* o IDs fijos de Sheets críticos.",
      };
    }

    const genusFolderId = getFolderId("genus");
    let genusFolderAccessible: boolean | undefined;
    if (genusFolderId) {
      genusFolderAccessible =
        await googleDriveGateway.canAccessFolder(genusFolderId);
    }

    return {
      ok: Boolean(genusFolderAccessible ?? foldersConfigured),
      mode: "real",
      credentialsConfigured: true,
      foldersConfigured: true,
      genusFolderAccessible,
      cache,
      message: genusFolderAccessible
        ? "Drive accesible."
        : "Drive configurado; verificar permisos de carpeta GENUS.",
    };
  }

  async refresh(scope: RefreshScope = "all"): Promise<RefreshResult> {
    if (this.refreshInFlight) {
      return this.refreshInFlight;
    }

    this.refreshInFlight = this.performRefresh(scope).finally(() => {
      this.refreshInFlight = null;
    });

    return this.refreshInFlight;
  }

  async listDocuments(folderKey: OperationsFolderKey): Promise<DocumentRef[]> {
    await this.ensureIndex();
    return (
      serverCache.get<DocumentRef[]>(`${CACHE_PREFIX.folder}${folderKey}`) ?? []
    );
  }

  async getCriticalSheetRef(sheetKey: CriticalSheetKey): Promise<DocumentRef> {
    await this.ensureIndex();

    const cached = serverCache.get<DocumentRef>(`${CACHE_PREFIX.critical}${sheetKey}`);
    if (cached) return cached;

    const fastPathId = getCriticalSheetFastPathId(sheetKey);
    if (fastPathId) {
      const metadata = await googleDriveGateway.getFileMetadata(fastPathId);
      if (metadata) {
        const ref: DocumentRef = {
          ...metadata,
          folderKey: CRITICAL_SHEET_FOLDER[sheetKey],
        };
        serverCache.set(`${CACHE_PREFIX.critical}${sheetKey}`, ref);
        return ref;
      }
    }

    throw new Error(
      `Sheet crítico "${CRITICAL_SHEET_NAMES[sheetKey]}" no indexado. Ejecutá GET /api/v1/drive/refresh.`
    );
  }

  async getOeIndex(): Promise<OeIndexEntry[]> {
    await this.ensureIndex();
    return serverCache.get<OeIndexEntry[]>(CACHE_PREFIX.oeIndex) ?? [];
  }

  async resolveOeById(oeId: string): Promise<OeIndexEntry | null> {
    await this.ensureIndex();
    const normalized = normalizeOeId(oeId);
    const cached = serverCache.get<OeIndexEntry>(
      `${CACHE_PREFIX.oeById}${normalized}`
    );
    if (cached) return cached;

    const index = await this.getOeIndex();
    const entry = index.find((item) => item.oeId === normalized) ?? null;
    if (entry) {
      serverCache.set(`${CACHE_PREFIX.oeById}${normalized}`, entry);
    }
    return entry;
  }

  private async ensureIndex(): Promise<void> {
    if (this.indexReady && serverCache.get<OeIndexEntry[]>(CACHE_PREFIX.oeIndex)) {
      return;
    }

    if (getCriticalSheetFastPathId("asignacion_lotes_2026") &&
        getCriticalSheetFastPathId("pedidos_2026") &&
        serverCache.get<OeIndexEntry[]>(CACHE_PREFIX.oeIndex)) {
      this.indexReady = true;
      return;
    }

    await this.refresh("all");
  }

  private async performRefresh(scope: RefreshScope): Promise<RefreshResult> {
    const folders: Partial<Record<OperationsFolderKey, number>> = {};
    const criticalSheets: Partial<Record<CriticalSheetKey, string>> = {};

    if (scope === "all" || scope === "elaboracion") {
      serverCache.deleteByPrefix(CACHE_PREFIX.oeById);
      serverCache.delete(CACHE_PREFIX.oeIndex);
      folders.elaboracion = await this.refreshFolderIndex("elaboracion");
      await this.rebuildOeIndex();
    }

    if (scope === "all" || scope === "pcp" || scope === "critical_sheets") {
      folders.pcp = await this.refreshFolderIndex("pcp");
      await this.indexCriticalSheet("pedidos_2026", criticalSheets);
      await this.indexCriticalSheet("semanas_2026", criticalSheets);
    }

    if (scope === "all" || scope === "lotes" || scope === "critical_sheets") {
      folders.lotes = await this.refreshFolderIndex("lotes");
      await this.indexCriticalSheet("asignacion_lotes_2026", criticalSheets);
    }

    if (scope === "all") {
      for (const key of ["genus", "produccion_2026", "productos", "desarrollo"] as const) {
        const count = await this.refreshFolderIndex(key);
        if (count > 0) folders[key] = count;
      }
    }

    this.indexReady = true;

    return {
      refreshedAt: new Date().toISOString(),
      scope,
      folders,
      oeIndexCount: serverCache.get<OeIndexEntry[]>(CACHE_PREFIX.oeIndex)?.length ?? 0,
      criticalSheets,
    };
  }

  private async refreshFolderIndex(
    folderKey: OperationsFolderKey
  ): Promise<number> {
    const folderId = getFolderId(folderKey);
    if (!folderId) return 0;

    serverCache.delete(`${CACHE_PREFIX.folder}${folderKey}`);

    const files = await googleDriveGateway.listSpreadsheetsInFolder(
      folderId,
      folderKey
    );
    serverCache.set(`${CACHE_PREFIX.folder}${folderKey}`, files);
    return files.length;
  }

  private async indexCriticalSheet(
    sheetKey: CriticalSheetKey,
    result: Partial<Record<CriticalSheetKey, string>>
  ): Promise<void> {
    serverCache.delete(`${CACHE_PREFIX.critical}${sheetKey}`);

    const fastPathId = getCriticalSheetFastPathId(sheetKey);
    if (fastPathId) {
      const metadata = await googleDriveGateway.getFileMetadata(fastPathId);
      if (metadata) {
        const ref: DocumentRef = {
          ...metadata,
          folderKey: CRITICAL_SHEET_FOLDER[sheetKey],
        };
        serverCache.set(`${CACHE_PREFIX.critical}${sheetKey}`, ref);
        result[sheetKey] = ref.fileId;
        return;
      }
    }

    const folderKey = CRITICAL_SHEET_FOLDER[sheetKey];
    const folderFiles =
      serverCache.get<DocumentRef[]>(`${CACHE_PREFIX.folder}${folderKey}`) ??
      (await (async () => {
        await this.refreshFolderIndex(folderKey);
        return (
          serverCache.get<DocumentRef[]>(`${CACHE_PREFIX.folder}${folderKey}`) ??
          []
        );
      })());

    const targetName = CRITICAL_SHEET_NAMES[sheetKey].toLowerCase();
    const match = folderFiles.find(
      (file) => file.name.trim().toLowerCase() === targetName
    );

    if (match) {
      serverCache.set(`${CACHE_PREFIX.critical}${sheetKey}`, match);
      result[sheetKey] = match.fileId;
    }
  }

  private async rebuildOeIndex(): Promise<void> {
    const files =
      serverCache.get<DocumentRef[]>(`${CACHE_PREFIX.folder}elaboracion`) ?? [];

    const index: OeIndexEntry[] = [];
    const seen = new Set<string>();

    for (const file of files) {
      const oeId = parseOeIdFromFileName(file.name);
      if (!oeId || seen.has(oeId)) continue;
      seen.add(oeId);

      const entry: OeIndexEntry = {
        oeId,
        fileId: file.fileId,
        fileName: file.name,
        modifiedTime: file.modifiedTime,
      };
      index.push(entry);
      serverCache.set(`${CACHE_PREFIX.oeById}${oeId}`, entry);
    }

    index.sort((a, b) => a.oeId.localeCompare(b.oeId));
    serverCache.set(CACHE_PREFIX.oeIndex, index);
  }
}

export const operationsDocumentRepository = new OperationsDocumentRepository();
