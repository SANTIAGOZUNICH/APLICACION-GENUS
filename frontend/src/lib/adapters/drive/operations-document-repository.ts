import "server-only";

import {
  CRITICAL_SHEET_FOLDER,
  CRITICAL_SHEET_NAMES,
  EXPECTED_FOLDER_PATHS,
  FOLDER_ALIAS_PATHS,
  getCriticalSheetFastPathId,
  getFolderOverrideId,
  getGenusFolderId,
  getMaxIndexDepth,
  type CriticalSheetKey,
} from "@/lib/adapters/drive/drive-folder-config";
import {
  findFolderByRelativePath,
  findFoldersUnderPath,
  getMaxDepthInIndex,
  getMissingExpectedPaths,
} from "@/lib/adapters/drive/folder-index-utils";
import { serverCache } from "@/lib/adapters/drive/cache/server-cache";
import { googleDriveGateway } from "@/lib/adapters/drive/google-drive-gateway";
import {
  fileNameToSlug,
  looksLikeDriveFileId,
  normalizeLookupKey,
  stripSheetExtension,
} from "@/lib/adapters/drive/oe-document-locator";
import type {
  DocumentRef,
  DriveHealthResult,
  FolderAlias,
  FolderIndexEntry,
  OeIndexEntry,
  RefreshResult,
  RefreshScope,
} from "@/lib/adapters/drive/types/document.types";
import { hasGoogleCredentials } from "@/lib/adapters/google/google-auth";
import { getServerDataMode } from "@/lib/config/data-mode";

const CACHE_PREFIX = {
  folderIndex: "docrepo:folder-index",
  documents: "docrepo:documents:",
  critical: "docrepo:critical:",
  oeIndex: "docrepo:oe-index",
  oeByFileId: "docrepo:oe:file:",
  oeBySlug: "docrepo:oe:slug:",
  oeByBusinessId: "docrepo:oe:biz:",
  resolvedFolder: "docrepo:resolved-folder:",
} as const;

/** Aliases indexed for documents during refresh (E7.1 slice + elaboracion recursive). */
const DOCUMENT_INDEX_ALIASES: FolderAlias[] = [
  "elaboracion",
  "pcp",
  "lotes",
];

const RECURSIVE_DOCUMENT_ALIASES = new Set<FolderAlias>(["elaboracion"]);

/**
 * OperationsDocumentRepository — document index abstraction.
 * Discovers folder structure from GENUS root; Drive is index only, not a database.
 */
export class OperationsDocumentRepository {
  private indexReady = false;
  private refreshInFlight: Promise<RefreshResult> | null = null;

  async health(): Promise<DriveHealthResult> {
    const mode = getServerDataMode();
    const credentialsConfigured = hasGoogleCredentials();
    const genusFolderConfigured = Boolean(getGenusFolderId());
    const cache = serverCache.stats();
    const folderIndexCount =
      serverCache.get<FolderIndexEntry[]>(CACHE_PREFIX.folderIndex)?.length ?? 0;

    if (mode !== "real") {
      return {
        ok: true,
        mode: "demo",
        credentialsConfigured,
        genusFolderConfigured,
        folderIndexCount,
        cache,
        message: "Modo demo activo.",
      };
    }

    if (!credentialsConfigured) {
      return {
        ok: false,
        mode: "real",
        credentialsConfigured: false,
        genusFolderConfigured,
        folderIndexCount,
        cache,
        message: "Credenciales Google no configuradas.",
      };
    }

    if (!genusFolderConfigured) {
      return {
        ok: false,
        mode: "real",
        credentialsConfigured: true,
        genusFolderConfigured: false,
        folderIndexCount,
        cache,
        message:
          "Configurá GOOGLE_DRIVE_GENUS_FOLDER_ID (única variable obligatoria).",
      };
    }

    const genusFolderId = getGenusFolderId()!;
    const genusFolderAccessible =
      await googleDriveGateway.canAccessFolder(genusFolderId);

    return {
      ok: genusFolderAccessible,
      mode: "real",
      credentialsConfigured: true,
      genusFolderConfigured: true,
      genusFolderAccessible,
      folderIndexCount,
      cache,
      message: genusFolderAccessible
        ? "GENUS accesible. Ejecutá /api/v1/drive/refresh para indexar."
        : "GENUS configurado pero inaccesible — verificar permisos de la service account.",
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

  getFolderIndex(): FolderIndexEntry[] {
    return serverCache.get<FolderIndexEntry[]>(CACHE_PREFIX.folderIndex) ?? [];
  }

  async listDocuments(alias: FolderAlias): Promise<DocumentRef[]> {
    await this.ensureIndex();
    return serverCache.get<DocumentRef[]>(`${CACHE_PREFIX.documents}${alias}`) ?? [];
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
          folderAlias: CRITICAL_SHEET_FOLDER[sheetKey],
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

  async resolveOeDocument(lookupKey: string): Promise<OeIndexEntry | null> {
    await this.ensureIndex();
    const key = normalizeLookupKey(lookupKey);

    const cachedByFile = serverCache.get<OeIndexEntry>(
      `${CACHE_PREFIX.oeByFileId}${key}`
    );
    if (cachedByFile) return cachedByFile;

    const index = await this.getOeIndex();

    if (looksLikeDriveFileId(key)) {
      const byId = index.find((item) => item.fileId === key) ?? null;
      if (byId) return byId;
    }

    const bySlug = serverCache.get<OeIndexEntry>(`${CACHE_PREFIX.oeBySlug}${key.toLowerCase()}`);
    if (bySlug) return bySlug;

    const slug = fileNameToSlug(key);
    if (slug) {
      const slugMatch = index.find((item) => item.fileSlug === slug) ?? null;
      if (slugMatch) return slugMatch;
    }

    const byExactName =
      index.find(
        (item) =>
          stripSheetExtension(item.fileName).toLowerCase() ===
          stripSheetExtension(key).toLowerCase()
      ) ?? null;
    if (byExactName) return byExactName;

    const businessFileId = serverCache.get<string>(
      `${CACHE_PREFIX.oeByBusinessId}${key.toUpperCase()}`
    );
    if (businessFileId) {
      return index.find((item) => item.fileId === businessFileId) ?? null;
    }

    return null;
  }

  /** Cache business OE_ID → fileId after reading sheet content. */
  registerOeBusinessId(oeId: string, fileId: string): void {
    const normalized = oeId.trim().toUpperCase();
    if (!normalized) return;
    serverCache.set(`${CACHE_PREFIX.oeByBusinessId}${normalized}`, fileId);
  }

  /** @deprecated Use resolveOeDocument */
  async resolveOeById(lookupKey: string): Promise<OeIndexEntry | null> {
    return this.resolveOeDocument(lookupKey);
  }

  resolveFolderId(alias: FolderAlias): string | null {
    const cached = serverCache.get<string>(`${CACHE_PREFIX.resolvedFolder}${alias}`);
    if (cached) return cached;

    const override = getFolderOverrideId(alias);
    if (override && alias !== "genus") {
      return override;
    }

    if (alias === "genus") {
      return getGenusFolderId();
    }

    const folderIndex = this.getFolderIndex();
    const targetPath = FOLDER_ALIAS_PATHS[alias];
    const entry = findFolderByRelativePath(folderIndex, targetPath);
    return entry?.folderId ?? null;
  }

  private async ensureIndex(): Promise<void> {
    if (this.indexReady && this.getFolderIndex().length > 0) {
      return;
    }

    const hasDocuments = DOCUMENT_INDEX_ALIASES.some(
      (alias) =>
        (serverCache.get<DocumentRef[]>(`${CACHE_PREFIX.documents}${alias}`)?.length ??
          0) > 0
    );

    if (hasDocuments && this.getFolderIndex().length > 0) {
      this.indexReady = true;
      return;
    }

    if (getCriticalSheetFastPathId("asignacion_lotes_2026") &&
        getCriticalSheetFastPathId("pedidos_2026")) {
      this.indexReady = true;
      return;
    }

    await this.refresh("all");
  }

  private async performRefresh(scope: RefreshScope): Promise<RefreshResult> {
    const started = Date.now();
    const genusFolderId = getGenusFolderId();

    if (!genusFolderId) {
      throw new Error("GOOGLE_DRIVE_GENUS_FOLDER_ID no configurado.");
    }

    let foldersScanned = 0;
    let maxDepthUsed = 0;
    let folderIndex: FolderIndexEntry[] = [];
    const documentsByAlias: Partial<Record<FolderAlias, number>> = {};
    const criticalSheets: Partial<Record<CriticalSheetKey, string>> = {};
    let documentsIndexed = 0;

    const shouldRebuildFolders =
      scope === "all" ||
      scope === "elaboracion" ||
      scope === "pcp" ||
      scope === "lotes";

    if (shouldRebuildFolders) {
      serverCache.delete(CACHE_PREFIX.folderIndex);
      serverCache.deleteByPrefix(CACHE_PREFIX.resolvedFolder);

      const crawl = await googleDriveGateway.buildFolderIndex(
        genusFolderId,
        getMaxIndexDepth()
      );
      folderIndex = crawl.entries;
      foldersScanned = crawl.foldersScanned;
      maxDepthUsed = crawl.maxDepthUsed;
      serverCache.set(CACHE_PREFIX.folderIndex, folderIndex);

      for (const alias of Object.keys(FOLDER_ALIAS_PATHS) as FolderAlias[]) {
        const folderId = this.resolveFolderId(alias);
        if (folderId) {
          serverCache.set(`${CACHE_PREFIX.resolvedFolder}${alias}`, folderId);
        }
      }
    } else {
      folderIndex = this.getFolderIndex();
      foldersScanned = folderIndex.length;
      maxDepthUsed = getMaxDepthInIndex(folderIndex);
    }

    const aliasesToIndex = this.resolveAliasesForScope(scope);

    if (scope === "all" || scope === "elaboracion") {
      serverCache.deleteByPrefix(CACHE_PREFIX.oeByFileId);
      serverCache.deleteByPrefix(CACHE_PREFIX.oeBySlug);
      serverCache.deleteByPrefix(CACHE_PREFIX.oeByBusinessId);
      serverCache.delete(CACHE_PREFIX.oeIndex);
    }

    for (const alias of aliasesToIndex) {
      serverCache.delete(`${CACHE_PREFIX.documents}${alias}`);
      const docs = await this.indexDocumentsForAlias(alias, folderIndex);
      serverCache.set(`${CACHE_PREFIX.documents}${alias}`, docs);
      documentsByAlias[alias] = docs.length;
      documentsIndexed += docs.length;
    }

    if (scope === "all" || scope === "critical_sheets" || scope === "pcp" || scope === "lotes") {
      await this.indexCriticalSheet("pedidos_2026", criticalSheets, folderIndex);
      await this.indexCriticalSheet("semanas_2026", criticalSheets, folderIndex);
      await this.indexCriticalSheet("asignacion_lotes_2026", criticalSheets, folderIndex);
    }

    if (scope === "all" || scope === "elaboracion") {
      await this.rebuildOeIndex();
    }

    this.indexReady = true;
    const missingExpectedPaths = getMissingExpectedPaths(
      folderIndex,
      EXPECTED_FOLDER_PATHS
    );

    return {
      refreshedAt: new Date().toISOString(),
      scope,
      foldersScanned,
      folderIndexCount: folderIndex.length,
      documentsIndexed,
      oeIndexCount:
        serverCache.get<OeIndexEntry[]>(CACHE_PREFIX.oeIndex)?.length ?? 0,
      maxDepthUsed,
      missingExpectedPaths,
      durationMs: Date.now() - started,
      criticalSheets,
      documentsByAlias,
    };
  }

  private resolveAliasesForScope(scope: RefreshScope): FolderAlias[] {
    switch (scope) {
      case "elaboracion":
        return ["elaboracion"];
      case "pcp":
        return ["pcp"];
      case "lotes":
        return ["lotes"];
      case "critical_sheets":
        return ["pcp", "lotes"];
      default:
        return DOCUMENT_INDEX_ALIASES;
    }
  }

  private async indexDocumentsForAlias(
    alias: FolderAlias,
    folderIndex: FolderIndexEntry[]
  ): Promise<DocumentRef[]> {
    const folderId = this.resolveFolderId(alias);
    if (!folderId) return [];

    const rootPath = FOLDER_ALIAS_PATHS[alias];
    const recursive = RECURSIVE_DOCUMENT_ALIASES.has(alias);

    if (!recursive) {
      return googleDriveGateway.listSpreadsheetsInFolder(folderId, {
        alias,
        folderPath: rootPath,
      });
    }

    const foldersUnder = findFoldersUnderPath(folderIndex, rootPath);
    const folderIds = new Set<string>([folderId, ...foldersUnder.map((f) => f.folderId)]);

    const documents: DocumentRef[] = [];
    const seen = new Set<string>();

    for (const id of folderIds) {
      const folderEntry =
        foldersUnder.find((entry) => entry.folderId === id) ??
        findFolderByRelativePath(folderIndex, rootPath);

      const batch = await googleDriveGateway.listSpreadsheetsInFolder(id, {
        alias,
        folderPath: folderEntry?.relativePath ?? rootPath,
      });

      for (const doc of batch) {
        if (seen.has(doc.fileId)) continue;
        seen.add(doc.fileId);
        documents.push(doc);
      }
    }

    return documents;
  }

  private async indexCriticalSheet(
    sheetKey: CriticalSheetKey,
    result: Partial<Record<CriticalSheetKey, string>>,
    folderIndex: FolderIndexEntry[]
  ): Promise<void> {
    serverCache.delete(`${CACHE_PREFIX.critical}${sheetKey}`);

    const fastPathId = getCriticalSheetFastPathId(sheetKey);
    if (fastPathId) {
      const metadata = await googleDriveGateway.getFileMetadata(fastPathId);
      if (metadata) {
        const ref: DocumentRef = {
          ...metadata,
          folderAlias: CRITICAL_SHEET_FOLDER[sheetKey],
        };
        serverCache.set(`${CACHE_PREFIX.critical}${sheetKey}`, ref);
        result[sheetKey] = ref.fileId;
        return;
      }
    }

    const alias = CRITICAL_SHEET_FOLDER[sheetKey];
    const docs =
      serverCache.get<DocumentRef[]>(`${CACHE_PREFIX.documents}${alias}`) ??
      (await this.indexDocumentsForAlias(alias, folderIndex));

    const targetName = CRITICAL_SHEET_NAMES[sheetKey].toLowerCase();
    const match = docs.find(
      (file) => file.name.trim().toLowerCase() === targetName
    );

    if (match) {
      serverCache.set(`${CACHE_PREFIX.critical}${sheetKey}`, match);
      result[sheetKey] = match.fileId;
    }
  }

  private async rebuildOeIndex(): Promise<void> {
    const files =
      serverCache.get<DocumentRef[]>(`${CACHE_PREFIX.documents}elaboracion`) ??
      [];

    const index: OeIndexEntry[] = [];
    const seen = new Set<string>();

    for (const file of files) {
      if (seen.has(file.fileId)) continue;
      seen.add(file.fileId);

      const fileSlug = fileNameToSlug(file.name);
      const entry: OeIndexEntry = {
        fileId: file.fileId,
        fileName: file.name,
        fileSlug,
        modifiedTime: file.modifiedTime,
        folderPath: file.folderPath,
      };
      index.push(entry);
      serverCache.set(`${CACHE_PREFIX.oeByFileId}${file.fileId}`, entry);
      if (fileSlug) {
        serverCache.set(`${CACHE_PREFIX.oeBySlug}${fileSlug}`, entry);
      }
    }

    index.sort((a, b) => a.fileName.localeCompare(b.fileName, "es"));
    serverCache.set(CACHE_PREFIX.oeIndex, index);
  }
}

export const operationsDocumentRepository = new OperationsDocumentRepository();
