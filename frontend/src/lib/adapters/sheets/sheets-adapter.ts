import "server-only";

import type {
  LoteSheetBundle,
  OperationsAdapter,
} from "@/lib/adapters/operations-adapter";
import { mockAdapter } from "@/lib/adapters/mock-adapter";
import { readOperationsTabs } from "@/lib/adapters/sheets/client";
import {
  buildLoteEntityPage,
  composeLoteSheetData,
  parseLoteRows,
  parseMovimientoRows,
  parseSaldoRows,
} from "@/lib/adapters/sheets/mappers/lote.mapper";

async function loadAllLoteBundles(): Promise<LoteSheetBundle[]> {
  const { lotesRows, saldosRows, movimientosRows } = await readOperationsTabs();

  const lotes = parseLoteRows(lotesRows);
  const saldos = parseSaldoRows(saldosRows);
  const movimientos = parseMovimientoRows(movimientosRows);

  return lotes.map((lote) => {
    const sheetData = composeLoteSheetData(lote, saldos, movimientos);
    return {
      loteId: lote.loteId,
      entityPage: buildLoteEntityPage(sheetData),
    };
  });
}

/** Real-data adapter — reads LOTES / SALDOS / MOVIMIENTOS from Google Sheets. */
export class SheetsAdapter implements OperationsAdapter {
  readonly mode = "real" as const;

  getInitialState() {
    return mockAdapter.getInitialState();
  }

  async listLoteEntityPages(): Promise<LoteSheetBundle[]> {
    return loadAllLoteBundles();
  }

  async getLoteEntityPage(loteId: string): Promise<LoteSheetBundle | null> {
    const bundles = await this.listLoteEntityPages();
    return bundles.find((bundle) => bundle.loteId === loteId) ?? null;
  }
}

export const sheetsAdapter = new SheetsAdapter();
