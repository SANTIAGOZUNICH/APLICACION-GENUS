/** Folder keys mapped in drive-folder-config — not tied to Google Drive in callers. */
export type OperationsFolderKey =
  | "genus"
  | "produccion_2026"
  | "elaboracion"
  | "pcp"
  | "lotes"
  | "productos"
  | "desarrollo";

export type CriticalSheetKey =
  | "asignacion_lotes_2026"
  | "pedidos_2026"
  | "semanas_2026";

export interface DocumentRef {
  fileId: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  folderKey: OperationsFolderKey;
}

export interface OeIndexEntry {
  oeId: string;
  fileId: string;
  fileName: string;
  modifiedTime?: string;
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
  foldersConfigured: boolean;
  genusFolderAccessible?: boolean;
  cache: { entries: number; ttlSeconds: number };
  message?: string;
}

export interface RefreshResult {
  refreshedAt: string;
  scope: RefreshScope;
  folders: Partial<Record<OperationsFolderKey, number>>;
  oeIndexCount: number;
  criticalSheets: Partial<Record<CriticalSheetKey, string>>;
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

export interface OeListItem {
  oeId: string;
  fileId: string;
  fileName: string;
  modifiedTime?: string;
}
