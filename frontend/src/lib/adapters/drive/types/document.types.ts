/** Logical folder alias — resolved via index or optional env override. */
export type FolderAlias =
  | "genus"
  | "produccion_2026"
  | "elaboracion"
  | "pcp"
  | "lotes"
  | "productos"
  | "desarrollo"
  | "calidad";

/** @deprecated Use FolderAlias — kept for gradual migration. */
export type OperationsFolderKey = FolderAlias;

export type CriticalSheetKey =
  | "asignacion_lotes_2026"
  | "pedidos_2026"
  | "semanas_2026";

export interface FolderIndexEntry {
  folderId: string;
  name: string;
  parentId: string | null;
  /** Path relative to GENUS root, e.g. PRODUCCION 2026/ELABORACION/ENERO */
  relativePath: string;
  depth: number;
}

export interface DocumentRef {
  fileId: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  folderAlias: FolderAlias;
  folderPath?: string;
}

/** OE document index entry — file name locates the doc; business OE_ID lives in the Sheet. */
export interface OeIndexEntry {
  fileId: string;
  fileName: string;
  fileSlug: string;
  modifiedTime?: string;
  folderPath?: string;
}

export type RefreshScope =
  | "all"
  | "elaboracion"
  | "pcp"
  | "lotes"
  | "critical_sheets";

export interface DriveHealthResult {
  ok: boolean;
  mode: "demo" | "real";
  credentialsConfigured: boolean;
  genusFolderConfigured: boolean;
  genusFolderAccessible?: boolean;
  folderIndexCount?: number;
  cache: { entries: number; ttlSeconds: number };
  message?: string;
}

export interface RefreshResult {
  refreshedAt: string;
  scope: RefreshScope;
  foldersScanned: number;
  folderIndexCount: number;
  documentsIndexed: number;
  oeIndexCount: number;
  maxDepthUsed: number;
  missingExpectedPaths: string[];
  durationMs: number;
  criticalSheets: Partial<Record<CriticalSheetKey, string>>;
  documentsByAlias: Partial<Record<FolderAlias, number>>;
}

export interface PedidoSummary {
  pedidoId: string;
  cliente?: string;
  producto?: string;
  estado?: string;
  cantidad?: string;
  fecha?: string;
  raw: Record<string, string>;
}

export interface OeSheetFields {
  oeId: string;
  lote: string;
  cliente: string;
  producto: string;
  estado: string;
  responsable: string;
  batch: string;
  fecha: string;
  raw: Record<string, string>;
}

export interface OeListItem {
  fileId: string;
  fileName: string;
  fileSlug: string;
  modifiedTime?: string;
  folderPath?: string;
}

/** OA document index entry — file name locates the doc; business OA_ID lives in the Sheet. */
export interface OaIndexEntry {
  fileId: string;
  fileName: string;
  fileSlug: string;
  modifiedTime?: string;
  folderPath?: string;
}

export interface OaListItem {
  fileId: string;
  fileName: string;
  fileSlug: string;
  modifiedTime?: string;
  folderPath?: string;
}

export interface OaSheetFields {
  oaId: string;
  sku: string;
  lotePt: string;
  loteGranel: string;
  oeRef: string;
  unidades: string;
  estado: string;
  responsable: string;
  avance: string;
  raw: Record<string, string>;
}

export interface LiberacionListItem {
  liberacionId: string;
  loteId: string;
  loteNumber: string;
  producto: string;
  estado: string;
  status: string;
}
