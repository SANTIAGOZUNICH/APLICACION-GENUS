import type { AsignacionLote } from "../adapters/asignacion-lotes-repository";
import { getAllAsignacionLotes } from "../adapters/asignacion-lotes-repository";

export function normalizeAsignacionSearchText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

export function matchesAsignacionLoteSearch(item: AsignacionLote, query: string): boolean {
  const normalizedQuery = normalizeAsignacionSearchText(query);
  if (!normalizedQuery) return true;
  const haystack = normalizeAsignacionSearchText(
    [
      item.lote,
      item.fecha,
      item.producto,
      item.codigo,
      item.marca,
      item.vto ?? "",
      item.muestras,
      item.cjMuestra,
      item.fechaAnalisis ?? "",
      item.observaciones,
    ].join(" ")
  );
  return haystack.includes(normalizedQuery);
}

export function filterAsignacionLotesBySearch<T extends AsignacionLote>(items: T[], query: string): T[] {
  return items.filter((item) => matchesAsignacionLoteSearch(item, query));
}

export function searchAsignacionLotes(
  query: string,
  options: { limit?: number; includeArchived?: boolean } = {}
): AsignacionLote[] {
  const normalizedQuery = normalizeAsignacionSearchText(query);
  if (!normalizedQuery) return [];
  return filterAsignacionLotesBySearch(
    getAllAsignacionLotes({ includeArchived: options.includeArchived }),
    normalizedQuery
  ).slice(0, options.limit ?? 8);
}
