export interface MapperWarning {
  entity: "lote" | "pedido" | "oe";
  reason: string;
  sampleHeaders?: string[];
  sampleRow?: Record<string, string>;
}

export interface MapperSheetDiagnostic {
  entity: "lote" | "pedido";
  sheetId?: string;
  sheetName?: string;
  tabUsed?: string;
  tabsAttempted: string[];
  headersDetected: string[];
  rowsRead: number;
  rowsMapped: number;
  rowsDiscarded: number;
  discardReasons: string[];
  sampleRow?: Record<string, string>;
}

export interface RealSourcesDiagnostic {
  elaboracionIndexCount: number;
  lotesRowsRead: number;
  lotesRowsMapped: number;
  pedidosRowsRead: number;
  pedidosRowsMapped: number;
  pedidosFileMimeType?: string;
  pedidosReaderUsed?: "sheets" | "excel";
  pedidosWarning?: string;
}
