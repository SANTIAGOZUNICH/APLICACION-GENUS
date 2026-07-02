export type SemanasBlockKind =
  | "ELABORACION"
  | "ACONDICIONAMIENTO"
  | "ENTREGAS"
  | "DESARROLLO"
  | "OTRO";

export interface SemanasMergedCell {
  tab: string;
  range: string;
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
}

export interface SemanasTabDiscovery {
  tab: string;
  headerRows: number[];
  headers: string[];
  mergedCells: SemanasMergedCell[];
  sampleRows: string[][];
  rowsRead: number;
  rowsMappable: number;
  blocksDetected: SemanasBlockKind[];
  blockDetails: Array<{
    kind: SemanasBlockKind;
    startRow: number;
    headerRow: number | null;
    dataRowCount: number;
  }>;
  warnings: string[];
}

export interface SemanasDiscoveryResponse {
  source: "drive" | "demo";
  scannedAt: string;
  sourceFile?: {
    fileId: string;
    fileName: string;
    mimeType: string;
    modifiedTime?: string;
  };
  tabs: string[];
  tabDiscoveries: SemanasTabDiscovery[];
  blocksSummary: Record<SemanasBlockKind, number>;
  rowsRead: number;
  rowsMappable: number;
  warnings: string[];
  message?: string;
}
