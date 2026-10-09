"use client";

/**
 * Edición tipo planilla de Depósito ME (Ingresos, Salidas, Inventario): la MISMA política que aplica el servidor
 * (`me-sheet-edit.ts`). Cada guardado va a PATCH /api/v1/inventory/cells (transaccional, versión por fila, auditoría)
 * y después se recarga: lo que se ve es lo que la base confirmó (incluido el stock recalculado).
 */
import { useCallback } from "react";
import type { GenusGridCellChange, GenusGridCommitResult } from "@/components/data-grid/genus-grid";
import {
  ME_STOCK_FIELDS,
  isMeSheetField,
  meSheetFieldKind,
  meSheetProtection,
  validateMeSheetValue,
  type MeSheetResource,
} from "@/lib/inventory/me-sheet-edit";
import type { SectorId } from "@/types/operational/sector";
import { patchInventoryCells } from "../adapters/inventory-client";

export function useMeSheetEditing<R extends { id?: string; updatedAt: string }>(
  resource: MeSheetResource,
  sector: SectorId | null | undefined,
  canWrite: boolean,
  /** clave de columna de la tabla → campo del dominio (las que no estén quedan de solo lectura). */
  fieldOf: Record<string, string>,
  reload: () => Promise<void> | void
) {
  const onCellsCommit = useCallback(
    async (changes: GenusGridCellChange[]): Promise<GenusGridCommitResult> => {
      const payload = changes.flatMap((c) => {
        const field = fieldOf[c.columnKey];
        return field ? [{ id: c.rowId, field, value: c.newValue, expectedVersion: c.rowVersion ?? "", reason: c.reason }] : [];
      });
      const res = await patchInventoryCells(resource, payload);
      await reload();
      const failures = res.results.flatMap((r, i) => (r.ok ? [] : [{ rowId: payload[i]?.id ?? "", columnKey: Object.keys(fieldOf).find((k) => fieldOf[k] === payload[i]?.field) ?? "", message: r.message ?? "Error" }]));
      if (res.ok && failures.length === 0) return { ok: true };
      return { ok: false, message: res.error ?? failures[0]?.message, failures };
    },
    [resource, fieldOf, reload]
  );

  const edit = useCallback(
    (columnKey: string) => {
      const field = fieldOf[columnKey];
      if (!field || !isMeSheetField(resource, field)) return undefined;
      return {
        kind: meSheetFieldKind(field),
        sensitive: ME_STOCK_FIELDS.has(field),
        protection: (r: R) => (canWrite ? meSheetProtection(resource, r as never, field, sector) : "Tu sector no puede editar esta planilla."),
        validate: (raw: string) => {
          const v = validateMeSheetValue(resource, field, raw);
          return v.ok ? null : v.message;
        },
      };
    },
    [resource, sector, canWrite, fieldOf]
  );

  return { canEditCells: canWrite, onCellsCommit, edit, rowVersion: (r: R) => r.updatedAt };
}
