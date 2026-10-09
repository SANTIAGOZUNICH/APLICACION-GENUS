"use client";

/**
 * Edición tipo planilla de Materias Primas (Ingresos, Compras): la MISMA política que aplica el servidor
 * (`mp-sheet-edit.ts`). Cada guardado va a PATCH /api/v1/inventory/cells (una transacción con versión por fila y
 * auditoría) y después se recarga: lo que se ve es lo que la base confirmó (incluido el stock que movió una corrección).
 */
import { useCallback } from "react";
import type { GenusGridCellChange, GenusGridCommitResult } from "@/components/data-grid/genus-grid";
import {
  MP_INGRESO_STOCK_FIELDS,
  isMpSheetField,
  mpSheetFieldKind,
  mpSheetNeedsReason,
  mpSheetProtection,
  validateMpSheetValue,
  type MpSheetResource,
} from "@/lib/inventory/mp-sheet-edit";
import type { SectorId } from "@/types/operational/sector";
import { patchInventoryCells } from "../adapters/inventory-client";

export function useMpSheetEditing<R extends { id?: string; updatedAt: string; status?: string; estado?: string }>(
  resource: MpSheetResource,
  sector: SectorId | null | undefined,
  canWrite: boolean,
  /** clave de columna de la tabla → campo del dominio (las que no estén quedan de solo lectura). */
  fieldOf: Record<string, string>,
  rows: R[],
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
      const failures = res.results.flatMap((r, i) =>
        r.ok
          ? []
          : [
              {
                rowId: payload[i]?.id ?? "",
                columnKey: Object.keys(fieldOf).find((k) => fieldOf[k] === payload[i]?.field) ?? "",
                message: r.message ?? "Error",
              },
            ]
      );
      if (res.ok && failures.length === 0) return { ok: true };
      return { ok: false, message: res.error ?? failures[0]?.message, failures };
    },
    [resource, fieldOf, reload]
  );

  /** Corregir código/bultos/cantidad/lote de un ingreso CONFIRMADO mueve el stock: pide motivo (queda auditado). */
  const reasonRequired = useCallback(
    (changes: GenusGridCellChange[]) => {
      const byId = new Map(rows.map((r) => [String(r.id), r] as const));
      return changes.some((c) => {
        const row = byId.get(c.rowId);
        const field = fieldOf[c.columnKey];
        return Boolean(row && field && mpSheetNeedsReason(resource, row, field));
      })
        ? "Estás corrigiendo un ingreso CONFIRMADO: el stock del lote y del libro mayor se ajusta por la diferencia. Indicá el motivo."
        : null;
    },
    [resource, rows, fieldOf]
  );

  const edit = useCallback(
    (columnKey: string) => {
      const field = fieldOf[columnKey];
      if (!field || !isMpSheetField(resource, field)) return undefined;
      return {
        kind: mpSheetFieldKind(field),
        sensitive: resource === "mp_ingresos" && MP_INGRESO_STOCK_FIELDS.has(field),
        protection: (r: R) => (canWrite ? mpSheetProtection(resource, r, field, sector) : "Tu sector no puede editar esta planilla."),
        validate: (raw: string) => {
          const v = validateMpSheetValue(resource, field, raw);
          return v.ok ? null : v.message;
        },
      };
    },
    [resource, sector, canWrite, fieldOf]
  );

  return { canEditCells: canWrite, onCellsCommit, reasonRequired, edit, rowVersion: (r: R) => r.updatedAt };
}
