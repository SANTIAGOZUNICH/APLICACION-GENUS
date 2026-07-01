import "server-only";

import {
  buildLiberacionSummariesFromLotes,
  findLiberacionEntityPage,
} from "@/lib/mappers/sheet-liberacion-to-entity";
import { parseAsignacionLoteRows } from "@/lib/mappers/sheet-lote-to-entity";
import { loteResolver } from "@/lib/adapters/drive/resolvers/lote.resolver";
import type { LiberacionListItem } from "@/lib/adapters/drive/types/document.types";
import type { LiberacionSheetBundle } from "@/lib/adapters/operations-adapter";

export class LiberacionResolver {
  async listLiberaciones(): Promise<LiberacionListItem[]> {
    const rows = await loteResolver.readAsignacionRows();
    const lotes = parseAsignacionLoteRows(rows);

    return buildLiberacionSummariesFromLotes(lotes).map((item) => ({
      liberacionId: item.liberacionId,
      loteId: item.loteId,
      loteNumber: item.loteNumber,
      producto: item.producto,
      estado: item.estado,
      status: item.status,
    }));
  }

  async getLiberacionEntityPage(
    lookupKey: string
  ): Promise<LiberacionSheetBundle | null> {
    const rows = await loteResolver.readAsignacionRows();
    const lotes = parseAsignacionLoteRows(rows);
    const entityPage = findLiberacionEntityPage(lotes, lookupKey);

    if (!entityPage) return null;

    return {
      liberacionId: entityPage.entityId,
      loteId: lookupKey,
      entityPage,
    };
  }
}

export const liberacionResolver = new LiberacionResolver();
