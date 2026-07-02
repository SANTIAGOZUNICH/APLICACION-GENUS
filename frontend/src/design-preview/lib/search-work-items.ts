import type { WorkItem } from "@/types/operational/work-item";

export type SearchEntityType =
  | "Producto"
  | "Cliente"
  | "OE"
  | "OA"
  | "Pedido"
  | "Lote"
  | "Trabajo";

export interface SearchResult {
  id: string;
  type: SearchEntityType;
  label: string;
  meta: string;
  workItemId?: string;
  href?: "work" | "oe" | "oa" | "client";
  ref?: string;
}

function normalize(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function pushUnique(results: SearchResult[], result: SearchResult) {
  if (!results.some((item) => item.id === result.id)) {
    results.push(result);
  }
}

/** Búsqueda tipo Spotlight sobre WorkItems — preview F9.6. */
export function searchWorkItems(items: WorkItem[], query: string): SearchResult[] {
  const q = normalize(query);
  if (!q) return [];

  const results: SearchResult[] = [];

  for (const item of items) {
    const client = item.client ?? "";
    const product = item.product ?? "";
    const oe = item.oeRef ?? "";
    const oa = item.oaRef ?? "";
    const pedido = item.pedidoRef ?? "";
    const lote = item.loteRef ?? "";

    if (client && normalize(client).includes(q)) {
      pushUnique(results, {
        id: `client-${item.id}-${client}`,
        type: "Cliente",
        label: client,
        meta: product ? `${product} · ${item.sector}` : item.sector,
        workItemId: item.id,
        href: "client",
        ref: client,
      });
    }

    if (product && normalize(product).includes(q)) {
      pushUnique(results, {
        id: `product-${item.id}-${product}`,
        type: "Producto",
        label: product,
        meta: client ? `${client} · ${item.quantity ?? ""} ${item.unit ?? ""}`.trim() : item.sector,
        workItemId: item.id,
        href: "work",
      });
    }

    if (oe && normalize(oe).includes(q)) {
      pushUnique(results, {
        id: `oe-${item.id}-${oe}`,
        type: "OE",
        label: oe,
        meta: `${client} · ${product}`.trim(),
        workItemId: item.id,
        href: "oe",
        ref: oe,
      });
    }

    if (oa && normalize(oa).includes(q)) {
      pushUnique(results, {
        id: `oa-${item.id}-${oa}`,
        type: "OA",
        label: oa,
        meta: `${client} · ${product}`.trim(),
        workItemId: item.id,
        href: "oa",
        ref: oa,
      });
    }

    if (pedido && normalize(pedido).includes(q)) {
      pushUnique(results, {
        id: `pedido-${item.id}-${pedido}`,
        type: "Pedido",
        label: pedido,
        meta: client || product || item.sector,
        workItemId: item.id,
        href: "work",
      });
    }

    if (lote && normalize(lote).includes(q)) {
      pushUnique(results, {
        id: `lote-${item.id}-${lote}`,
        type: "Lote",
        label: lote,
        meta: `${client} · ${product}`.trim(),
        workItemId: item.id,
        href: "work",
      });
    }

    if (normalize(item.id).includes(q)) {
      pushUnique(results, {
        id: `work-${item.id}`,
        type: "Trabajo",
        label: client || product || item.id,
        meta: `${item.sector} · ${item.status}`,
        workItemId: item.id,
        href: "work",
      });
    }
  }

  return results.slice(0, 12);
}

/** Sugerencias iniciales cuando el campo está vacío. */
export function defaultSearchSuggestions(items: WorkItem[]): SearchResult[] {
  const seen = new Set<string>();
  const results: SearchResult[] = [];

  for (const item of items) {
    if (item.client && !seen.has(item.client)) {
      seen.add(item.client);
      results.push({
        id: `suggest-client-${item.client}`,
        type: "Cliente",
        label: item.client,
        meta: "Cliente frecuente",
        workItemId: item.id,
        href: "client",
        ref: item.client,
      });
    }
    if (results.length >= 5) break;
  }

  return results;
}
