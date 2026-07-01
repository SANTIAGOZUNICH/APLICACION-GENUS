import type { ApiDataSource } from "@/lib/api/operations-client";

export interface OperationsEntityCounts {
  oe: number;
  lotes: number;
  pedidos: number;
  oa: number;
  liberaciones: number;
}

export interface OperationsFallbackUsed {
  bandeja: boolean;
  workspaces: boolean;
  entityPages: boolean;
  panorama: boolean;
}

export interface OperationsDiagnostics {
  dataMode: "demo" | "real";
  source: ApiDataSource;
  counts: OperationsEntityCounts;
  fallbackUsed: OperationsFallbackUsed;
  message?: string;
}

export function createEmptyCounts(): OperationsEntityCounts {
  return {
    oe: 0,
    lotes: 0,
    pedidos: 0,
    oa: 0,
    liberaciones: 0,
  };
}

export function createEmptyFallbackUsed(): OperationsFallbackUsed {
  return {
    bandeja: false,
    workspaces: false,
    entityPages: false,
    panorama: false,
  };
}
