"use client";

import { useCallback } from "react";
import type { GenusGridCellChange, GenusGridCommitResult } from "@/components/data-grid/genus-grid";
import {
  INVENTORY_REASON_FIELDS,
  INVENTORY_SENSITIVE_FIELDS,
  inventoryCellProtection,
  inventoryFieldKind,
  isInventoryCellField,
  validateInventoryValue,
  type InventoryCellResource,
} from "@/lib/inventory/cell-edit";
import { patchInventoryCells } from "../adapters/inventory-client";

/**
 * Edición por celda para tablas de inventario. `fieldOf` traduce la clave de columna de la tabla
 * (a veces la etiqueta visible) al campo del dominio; las columnas que no estén en el mapa quedan de solo lectura.
 */
export function useInventoryCellEditing<R extends { id?: string; updatedAt: string; archived?: boolean; origen?: string }>(
  resource: InventoryCellResource,
  canWrite: boolean,
  fieldOf: Record<string, string>,
  rowId: (r: R) => string,
  reload: () => Promise<void> | void
) {
  const onCellsCommit = useCallback(
    async (changes: GenusGridCellChange[]): Promise<GenusGridCommitResult> => {
      const payload = changes.flatMap((c) => {
        const field = fieldOf[c.columnKey];
        return field ? [{ id: c.rowId, field, value: c.newValue, expectedVersion: c.rowVersion ?? "", reason: c.reason, expectedValue: c.oldValue }] : [];
      });
      const res = await patchInventoryCells(resource, payload);
      await reload(); // lo mostrado es lo que la base confirmó
      const failures = res.results.flatMap((r, i) =>
        r.ok ? [] : [{ rowId: payload[i]?.id ?? "", columnKey: payload[i]?.field ?? "", message: r.message ?? "Error" }]
      );
      if (res.ok && failures.length === 0) return { ok: true };
      return { ok: false, message: res.error ?? failures[0]?.message, failures };
    },
    [resource, fieldOf, reload]
  );

  const reasonRequired = useCallback(
    (changes: GenusGridCellChange[]) => {
      const fields = new Set(changes.map((c) => fieldOf[c.columnKey] ?? ""));
      if (fields.has("codigo")) return "Cambiar el código traspasa su saldo en el libro mayor: ¿por qué se corrige?";
      if (fields.has("stockLibroMayor")) return "Fijar el saldo del código registra un ajuste en el libro mayor: ¿por qué?";
      if ([...fields].some((f) => INVENTORY_REASON_FIELDS.has(f))) return "Corregir kilos registra un ajuste en el libro mayor: ¿por qué?";
      return null;
    },
    [fieldOf]
  );

  /** Especificación `edit` de una columna (por su clave de tabla), o undefined si no es editable. */
  const edit = useCallback(
    (columnKey: string) => {
      const field = fieldOf[columnKey];
      if (!field || !isInventoryCellField(resource, field)) return undefined;
      return {
        kind: inventoryFieldKind(field),
        sensitive: INVENTORY_SENSITIVE_FIELDS.has(field),
        protection: (r: R) => inventoryCellProtection(resource, r, field, canWrite),
        validate: (raw: string) => {
          const v = validateInventoryValue(field, raw);
          return v.ok ? null : v.message;
        },
      };
    },
    [resource, canWrite, fieldOf]
  );

  return { canEditCells: canWrite, onCellsCommit, reasonRequired, edit, rowVersion: (r: R) => r.updatedAt, rowId };
}
