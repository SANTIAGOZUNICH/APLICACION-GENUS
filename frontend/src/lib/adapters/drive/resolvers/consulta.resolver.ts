import "server-only";

import { oeResolver } from "@/lib/adapters/drive/resolvers/oe.resolver";
import { oePageHref } from "@/config/entity-pages";
import {
  buildOeIndexCardData,
  oeIndexSearchFields,
} from "@/lib/mappers/oe-index-display";
import { matchesConsultaQuery } from "@/lib/adapters/drive/resolvers/consulta-search";
import type { ConsultaSearchResponse } from "@/types/consulta/consulta-result";

export { matchesConsultaQuery } from "@/lib/adapters/drive/resolvers/consulta-search";

/** E7.2 — OE-only consulta from ELABORACION index. */
export class ConsultaResolver {
  async search(query: string): Promise<ConsultaSearchResponse> {
    const trimmed = query.trim();
    const oeIndex = await oeResolver.listOeIndex();

    const indexSummary = {
      oes: oeIndex.length,
      lotes: 0,
      pedidos: 0,
    };

    const integrationPending = {
      lotes: "Lotes — pendiente de integración (E7.3)",
      pedidos: "Pedidos — pendiente de integración (E7.3)",
    };

    if (!trimmed) {
      return {
        query: trimmed,
        results: [],
        counts: { oe: 0, lote: 0, pedido: 0 },
        source: "drive",
        indexSummary,
        integrationPending,
        message: `${indexSummary.oes} OEs indexadas en ELABORACION. Ingresá producto, cliente o nombre de archivo.`,
      };
    }

    const results = oeIndex
      .filter((entry) => matchesConsultaQuery(oeIndexSearchFields(entry), trimmed))
      .map((entry) => {
        const card = buildOeIndexCardData(entry);
        return {
          kind: "oe" as const,
          id: card.lookupKey,
          title: card.title,
          subtitle: card.cliente ? card.cliente : card.producto,
          href: oePageHref(card.lookupKey),
          metadata: [
            { id: "producto", label: "Producto", value: card.producto },
            ...(card.cliente
              ? [{ id: "cliente", label: "Cliente", value: card.cliente }]
              : []),
            { id: "carpeta", label: "Mes / carpeta", value: card.folderLabel },
            { id: "mod", label: "Última modificación", value: card.modifiedLabel },
            { id: "archivo", label: "Archivo", value: card.fileName },
            { id: "origen", label: "Origen", value: "Google Drive · ELABORACION" },
          ],
          source: "drive" as const,
        };
      });

    return {
      query: trimmed,
      results,
      counts: {
        oe: results.length,
        lote: 0,
        pedido: 0,
      },
      source: "drive",
      indexSummary,
      integrationPending,
      message:
        results.length > 0
          ? `${results.length} OE(s) encontrada(s) en ELABORACION.`
          : undefined,
    };
  }
}

export const consultaResolver = new ConsultaResolver();
