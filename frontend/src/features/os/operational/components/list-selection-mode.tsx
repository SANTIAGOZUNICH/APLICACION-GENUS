"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";

export type ListSelectionModeState = {
  active: boolean;
  selectedIds: Set<string>;
  selectedCount: number;
  enter: () => void;
  cancel: () => void;
  toggle: (id: string) => void;
  selectAllVisible: () => void;
  deselectAll: () => void;
  isSelected: (id: string) => boolean;
};

/**
 * Modo selección explícito: fuera de `active` no hay selección.
 * `selectAllVisible` opera solo sobre `visibleIds` (lista filtrada actual).
 */
export function useListSelectionMode(visibleIds: string[]): ListSelectionModeState {
  const [active, setActive] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());

  const visibleKey = visibleIds.join("\0");
  const visibleSet = useMemo(() => new Set(visibleIds), [visibleKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!active) return;
    setSelectedIds((prev) => {
      const next = new Set<string>();
      for (const id of prev) {
        if (visibleSet.has(id)) next.add(id);
      }
      return next.size === prev.size ? prev : next;
    });
  }, [active, visibleSet]);

  const enter = useCallback(() => {
    setActive(true);
    setSelectedIds(new Set());
  }, []);

  const cancel = useCallback(() => {
    setActive(false);
    setSelectedIds(new Set());
  }, []);

  const toggle = useCallback(
    (id: string) => {
      if (!active) return;
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    },
    [active]
  );

  const selectAllVisible = useCallback(() => {
    if (!active) return;
    setSelectedIds(new Set(visibleIds));
  }, [active, visibleIds]);

  const deselectAll = useCallback(() => {
    if (!active) return;
    setSelectedIds(new Set());
  }, [active]);

  const isSelected = useCallback((id: string) => selectedIds.has(id), [selectedIds]);

  return {
    active,
    selectedIds,
    selectedCount: selectedIds.size,
    enter,
    cancel,
    toggle,
    selectAllVisible,
    deselectAll,
    isSelected,
  };
}

export function bulkDeleteConfirmMessage(count: number): string {
  const n = Math.max(0, count);
  return `Estás por eliminar ${n} registro${n === 1 ? "" : "s"}. Esta acción no se puede deshacer. ¿Querés continuar?`;
}

export function ListSelectionEnterButton({
  onClick,
  disabled,
}: {
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <Button type="button" variant="secondary" className="min-h-10" disabled={disabled} onClick={onClick}>
      Seleccionar
    </Button>
  );
}

export function ListSelectionToolbar({
  selectedCount,
  onSelectAll,
  onDeselectAll,
  onDelete,
  onCancel,
  busy,
  deleteLabel = "Eliminar seleccionados",
}: {
  selectedCount: number;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onDelete: () => void;
  onCancel: () => void;
  busy?: boolean;
  deleteLabel?: string;
}) {
  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-[var(--os-radius-sm)] border border-[var(--os-teal)]/30 bg-[var(--os-teal-soft)]/40 px-3 py-2"
      data-testid="list-selection-toolbar"
    >
      <span className="text-sm font-medium text-[var(--os-text)]">
        Modo selección · {selectedCount} seleccionada{selectedCount === 1 ? "" : "s"}
      </span>
      <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={onSelectAll}>
        Seleccionar todo
      </Button>
      <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={onDeselectAll}>
        Deseleccionar todo
      </Button>
      <Button
        type="button"
        size="sm"
        disabled={busy || selectedCount === 0}
        title={selectedCount === 0 ? "Seleccioná al menos un registro" : undefined}
        onClick={onDelete}
      >
        {deleteLabel}
      </Button>
      <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={onCancel}>
        Cancelar
      </Button>
    </div>
  );
}

export function SelectionCheckbox({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <input
      type="checkbox"
      className="size-4 accent-[var(--os-teal)]"
      checked={checked}
      disabled={disabled}
      aria-label={label}
      onChange={onChange}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

export function selectedRowClassName(selected: boolean): string {
  return selected
    ? "bg-[var(--os-teal-soft)]/55 shadow-[inset_3px_0_0_0_rgb(18_191_183_/_0.75)]"
    : "";
}
