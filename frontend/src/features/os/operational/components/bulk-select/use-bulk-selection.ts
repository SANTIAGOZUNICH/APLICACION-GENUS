"use client";

import { useCallback, useMemo, useState } from "react";

/**
 * Selección múltiple reutilizable para tablas de Producción.
 * El alcance es SIEMPRE la vista actual: `visibleIds` son los registros que la tabla está mostrando
 * (ya filtrados/paginados). Lo seleccionado que deja de estar visible (cambió el filtro, la página o
 * se recargó la tabla) se descarta del conjunto efectivo — nunca se elimina algo que el usuario no ve.
 */
export function useBulkSelection(visibleIds: readonly string[]) {
  const [raw, setRaw] = useState<ReadonlySet<string>>(() => new Set());

  const selected = useMemo(() => visibleIds.filter((id) => raw.has(id)), [visibleIds, raw]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const toggle = useCallback((id: string) => {
    setRaw((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clear = useCallback(() => setRaw(new Set()), []);

  const allVisibleSelected = visibleIds.length > 0 && selected.length === visibleIds.length;
  const someSelected = selected.length > 0 && !allVisibleSelected;

  /** Header: si ya están todos los visibles → deselecciona; si no → selecciona SOLO los visibles. */
  const toggleAllVisible = useCallback(() => {
    setRaw(allVisibleSelected ? new Set() : new Set(visibleIds));
  }, [allVisibleSelected, visibleIds]);

  return {
    selected,
    count: selected.length,
    visibleCount: visibleIds.length,
    isSelected: (id: string) => selectedSet.has(id),
    toggle,
    toggleAllVisible,
    clear,
    allVisibleSelected,
    someSelected,
  };
}

export type BulkSelection = ReturnType<typeof useBulkSelection>;

/** «1 registro seleccionado» / «3 registros seleccionados». */
export function selectedCountLabel(count: number): string {
  return `${count} ${count === 1 ? "registro seleccionado" : "registros seleccionados"}`;
}
