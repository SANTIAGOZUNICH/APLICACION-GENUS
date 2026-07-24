/** Helpers puros — filtrar bandeja principal vs sub-pestaña Archivados. */

export function toArchivedIdSet(
  archivedWorkItemIds: Iterable<string> | ReadonlySet<string>
): Set<string> {
  return archivedWorkItemIds instanceof Set
    ? archivedWorkItemIds
    : new Set(archivedWorkItemIds);
}

/** Lista principal: oculta ítems archivados de mi vista. */
export function excludeArchivedFromView<T extends { id: string }>(
  items: T[],
  archivedWorkItemIds: Iterable<string> | ReadonlySet<string>
): T[] {
  const set = toArchivedIdSet(archivedWorkItemIds);
  if (set.size === 0) return items;
  return items.filter((item) => !set.has(item.id));
}

/** Sub-pestaña Archivados: solo ítems archivados de mi vista. */
export function onlyArchivedFromView<T extends { id: string }>(
  items: T[],
  archivedWorkItemIds: Iterable<string> | ReadonlySet<string>
): T[] {
  const set = toArchivedIdSet(archivedWorkItemIds);
  if (set.size === 0) return [];
  return items.filter((item) => set.has(item.id));
}
