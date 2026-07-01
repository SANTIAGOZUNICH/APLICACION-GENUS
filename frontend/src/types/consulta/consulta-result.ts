export type ConsultaEntityKind = "oe" | "lote" | "pedido";

export type ConsultaDataSource = "drive" | "demo";

export interface ConsultaResultItem {
  kind: ConsultaEntityKind;
  id: string;
  title: string;
  subtitle?: string;
  href: string;
  metadata: Array<{ id: string; label: string; value: string }>;
  source: ConsultaDataSource;
}

export interface ConsultaSearchResponse {
  query: string;
  results: ConsultaResultItem[];
  counts: Record<ConsultaEntityKind, number>;
  source: ConsultaDataSource;
  indexSummary: {
    oes: number;
    lotes: number;
    pedidos: number;
  };
  message?: string;
  diagnostics?: {
    lotes?: {
      rowsRead: number;
      rowsMapped: number;
      reason?: string;
      sampleHeaders?: string[];
    };
    pedidos?: {
      rowsRead: number;
      rowsMapped: number;
      reason?: string;
      sampleHeaders?: string[];
    };
  };
}
