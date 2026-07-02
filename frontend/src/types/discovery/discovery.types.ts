/** E7.2 — Data Discovery types. No UI mapping until schemas are confirmed. */

export type DiscoveryConnectionStatus =
  | "connected"
  | "not_connected"
  | "pending_mapper";

export interface DiscoveryFieldMatch {
  field: string;
  required: boolean;
  matched: boolean;
  matchedVia?: string;
  valueSample?: string;
}

export interface DiscoveryHeaderAnalysis {
  /** 1-based row index where headers were detected, if tabular layout. */
  headerRowIndex?: number;
  detectedHeaderRows?: number[];
  headers: string[];
  /** First data rows after header (tabular) or label/value preview. */
  sampleRows: string[][];
  layout: "tabular" | "label_value" | "unknown";
}

export interface DriveSummaryResponse {
  source: "drive" | "demo";
  scannedAt: string;
  foldersScanned: number;
  folderIndexCount: number;
  documentsByAlias: Record<string, number>;
  formatsDetected: Record<string, number>;
  googleSheetsCount: number;
  excelCount: number;
  criticalSheets: Array<{
    key: string;
    name: string;
    connected: boolean;
    fileId?: string;
    mimeType?: string;
    modifiedTime?: string;
  }>;
  oeIndexCount: number;
  lastModified?: string;
  warnings: string[];
  message?: string;
}

export interface OeSchemaSample {
  fileName: string;
  fileId: string;
  folderPath?: string;
  modifiedTime?: string;
  sampleReason: string;
  tabs: string[];
  tabUsed?: string;
  detectedHeaderRows: number[];
  headers: string[];
  sampleRows: string[][];
  layout: "tabular" | "label_value" | "unknown";
  fieldsDetected: DiscoveryFieldMatch[];
  fieldsMissing: string[];
  warnings: string[];
}

export interface OeSchemasResponse {
  source: "drive" | "demo";
  scannedAt: string;
  samplesRequested: number;
  samples: OeSchemaSample[];
  oeIndexCount: number;
  warnings: string[];
  message?: string;
}

export interface LotesSchemaResponse {
  source: "drive" | "demo";
  scannedAt: string;
  connected: boolean;
  connectionStatus: DiscoveryConnectionStatus;
  sourceFile?: {
    fileId: string;
    fileName: string;
    mimeType: string;
    modifiedTime?: string;
    folderPath?: string;
  };
  tabs: string[];
  tabUsed?: string;
  detectedHeaderRows: number[];
  headers: string[];
  sampleRows: string[][];
  fieldsDetected: DiscoveryFieldMatch[];
  fieldsMissing: string[];
  rowsRead: number;
  rowsMappable: number;
  warnings: string[];
  message?: string;
}

export interface PedidosSchemaResponse {
  source: "drive" | "demo";
  scannedAt: string;
  connected: boolean;
  connectionStatus: DiscoveryConnectionStatus;
  sourceFile?: {
    fileId: string;
    fileName: string;
    mimeType: string;
    modifiedTime?: string;
    folderPath?: string;
  };
  mimeType?: string;
  readerUsed?: "sheets" | "excel";
  workbookSheets: string[];
  tabUsed?: string;
  detectedHeaderRows: number[];
  headers: string[];
  sampleRows: string[][];
  fieldsDetected: DiscoveryFieldMatch[];
  fieldsMissing: string[];
  rowsRead: number;
  rowsMappable: number;
  warnings: string[];
  message?: string;
}

export interface DiscoverySummaryResponse {
  source: "drive" | "demo";
  scannedAt: string;
  oes: {
    count: number;
    status: DiscoveryConnectionStatus;
    fieldsDetectedCount?: number;
    fieldsMissingCount?: number;
    warnings: string[];
  };
  lotes: {
    status: DiscoveryConnectionStatus;
    rowsRead: number;
    rowsMappable: number;
    warnings: string[];
  };
  pedidos: {
    status: DiscoveryConnectionStatus;
    rowsRead: number;
    rowsMappable: number;
    warnings: string[];
  };
  schemaWarnings: string[];
  readyForUiMapping: boolean;
  blockers: string[];
}
