import "server-only";

import { stripSheetExtension } from "@/lib/adapters/drive/oe-document-locator";
import { oeResolver } from "@/lib/adapters/drive/resolvers/oe.resolver";
import { loteResolver } from "@/lib/adapters/drive/resolvers/lote.resolver";
import { pedidoResolver } from "@/lib/adapters/drive/resolvers/pedido.resolver";
import {
  lotePageHref,
  oePageHref,
  pedidoPageHref,
} from "@/config/entity-pages";
import { parseAsignacionLoteRowsWithDiagnostics } from "@/lib/mappers/diagnose-asignacion-lotes";
import { parsePedidosWithDiagnostics } from "@/lib/mappers/diagnose-pedidos";
import type { ConsultaEntityKind, ConsultaResultItem, ConsultaSearchResponse } from "@/types/consulta/consulta-result";

export type ConsultaSearchScope = ConsultaEntityKind;

function normalizeSearchText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function tokenizeQuery(query: string): string[] {
  return normalizeSearchText(query).split(/\s+/).filter(Boolean);
}

/** All query tokens must appear somewhere in the combined searchable text. */
export function matchesConsultaQuery(
  searchableFields: Array<string | undefined>,
  query: string
): boolean {
  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) return false;

  const haystack = normalizeSearchText(
    searchableFields.filter(Boolean).join(" ")
  );

  return tokens.every((token) => haystack.includes(token));
}

async function searchOes(query: string): Promise<ConsultaResultItem[]> {
  const entries = await oeResolver.listOeIndex();

  return entries
    .filter((entry) =>
      matchesConsultaQuery(
        [
          entry.fileName,
          stripSheetExtension(entry.fileName),
          entry.fileSlug,
          entry.folderPath,
        ],
        query
      )
    )
    .map((entry) => ({
      kind: "oe" as const,
      id: entry.fileSlug || entry.fileId,
      title: stripSheetExtension(entry.fileName),
      subtitle: entry.folderPath || "Elaboración · Google Drive",
      href: oePageHref(entry.fileSlug || entry.fileId),
      metadata: [
        { id: "archivo", label: "Archivo", value: entry.fileName },
        ...(entry.folderPath
          ? [{ id: "carpeta", label: "Carpeta", value: entry.folderPath }]
          : []),
      ],
      source: "drive" as const,
    }));
}

async function searchLotes(query: string): Promise<ConsultaResultItem[]> {
  const rows = await loteResolver.readAsignacionRows();
  const lotes = parseAsignacionLoteRowsWithDiagnostics(rows).lotes;

  return lotes
    .filter((lote) => {
      const loteId = lote.loteId || lote.nroLote;
      return matchesConsultaQuery(
        [loteId, lote.nroLote, lote.itemId, lote.tipoItem, lote.estado, lote.proveedor],
        query
      );
    })
    .map((lote) => {
      const loteId = lote.loteId || lote.nroLote;
      return {
        kind: "lote" as const,
        id: loteId,
        title: lote.itemId || loteId,
        subtitle: lote.tipoItem || "Lote",
        href: lotePageHref(loteId),
        metadata: [
          { id: "lote", label: "Lote", value: loteId },
          ...(lote.estado
            ? [{ id: "estado", label: "Estado", value: lote.estado }]
            : []),
          ...(lote.fechaVencimiento
            ? [{ id: "venc", label: "Vencimiento", value: lote.fechaVencimiento }]
            : []),
        ],
        source: "drive" as const,
      };
    });
}

async function searchPedidos(query: string): Promise<ConsultaResultItem[]> {
  const pedidos = await pedidoResolver.listPedidos();

  return pedidos
    .filter((pedido) =>
      matchesConsultaQuery(
        [pedido.pedidoId, pedido.cliente, pedido.producto, pedido.estado, pedido.fecha],
        query
      )
    )
    .map((pedido) => ({
      kind: "pedido" as const,
      id: pedido.pedidoId,
      title: pedido.cliente || pedido.pedidoId,
      subtitle: pedido.producto || "Pedido comercial",
      href: pedidoPageHref(pedido.pedidoId),
      metadata: [
        { id: "pedido", label: "Pedido", value: pedido.pedidoId },
        ...(pedido.estado
          ? [{ id: "estado", label: "Estado", value: pedido.estado }]
          : []),
        ...(pedido.fecha
          ? [{ id: "fecha", label: "Compromiso", value: pedido.fecha }]
          : []),
      ],
      source: "drive" as const,
    }));
}

export class ConsultaResolver {
  async search(
    query: string,
    scopes: ConsultaSearchScope[] = ["oe", "lote", "pedido"]
  ): Promise<ConsultaSearchResponse> {
    const trimmed = query.trim();
    const scopeSet = new Set(scopes);

    const [oeIndex, pedidoRead, loteRead] = await Promise.all([
      scopeSet.has("oe") ? oeResolver.listOeIndex() : Promise.resolve([]),
      scopeSet.has("pedido")
        ? pedidoResolver.readPedidosWithMeta()
        : Promise.resolve({ rows: [], tabsAttempted: [] }),
      scopeSet.has("lote")
        ? loteResolver.readAsignacionWithMeta()
        : Promise.resolve({ rows: [], tabsAttempted: [] }),
    ]);

    const lotesParsed = parseAsignacionLoteRowsWithDiagnostics(loteRead.rows);
    const pedidosParsed = parsePedidosWithDiagnostics(pedidoRead.rows);

    const indexSummary = {
      oes: oeIndex.length,
      lotes: lotesParsed.lotes.length,
      pedidos: pedidosParsed.pedidos.length,
    };

    const diagnostics = {
      lotes: {
        rowsRead: lotesParsed.diagnostic.rowsRead,
        rowsMapped: lotesParsed.diagnostic.rowsMapped,
        reason:
          lotesParsed.diagnostic.rowsRead > 0 &&
          lotesParsed.diagnostic.rowsMapped === 0
            ? lotesParsed.diagnostic.discardReasons[0] ??
              "Mapper no reconoce columnas de ASIGNACION DE LOTES 2026."
            : lotesParsed.diagnostic.rowsRead === 0
              ? "Sheet sin filas de datos o tab no encontrada."
              : undefined,
        sampleHeaders: lotesParsed.diagnostic.headersDetected.slice(0, 12),
      },
      pedidos: {
        rowsRead: pedidosParsed.diagnostic.rowsRead,
        rowsMapped: pedidosParsed.diagnostic.rowsMapped,
        reason:
          pedidosParsed.diagnostic.rowsRead > 0 &&
          pedidosParsed.diagnostic.rowsMapped === 0
            ? pedidosParsed.diagnostic.discardReasons[0] ??
              "Mapper no reconoce columnas de PEDIDOS 2026."
            : pedidosParsed.diagnostic.rowsRead === 0
              ? "Sheet sin filas de datos o tab no encontrada."
              : undefined,
        sampleHeaders: pedidosParsed.diagnostic.headersDetected.slice(0, 12),
      },
    };

    if (!trimmed) {
      return {
        query: trimmed,
        results: [],
        counts: { oe: 0, lote: 0, pedido: 0 },
        source: "drive",
        indexSummary,
        diagnostics,
      };
    }

    const results: ConsultaResultItem[] = [];

    if (scopeSet.has("oe")) {
      const oeResults = await searchOes(trimmed);
      results.push(...oeResults);
    }
    if (scopeSet.has("lote")) {
      results.push(...(await searchLotes(trimmed)));
    }
    if (scopeSet.has("pedido")) {
      results.push(...(await searchPedidos(trimmed)));
    }

    const counts = {
      oe: results.filter((item) => item.kind === "oe").length,
      lote: results.filter((item) => item.kind === "lote").length,
      pedido: results.filter((item) => item.kind === "pedido").length,
    };

    return {
      query: trimmed,
      results,
      counts,
      source: "drive",
      indexSummary,
      diagnostics,
    };
  }
}

export const consultaResolver = new ConsultaResolver();
