"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import type { GenusGridCellChange, GenusGridCommitResult } from "@/components/data-grid/genus-grid";
import { usePreviewSession } from "@/features/os/session/preview-context";
import { useRequiredWorkspace } from "@/features/os/workspace/workspace-provider";
import {
  WORK_ITEM_CELL_KIND,
  WORK_ITEM_SENSITIVE_FIELDS,
  isWorkItemCellField,
  validateWorkItemCellValue,
  workItemCellProtection,
  workItemReasonRequired,
  type WorkItemCellField,
} from "@/lib/planning/work-item-cell-edit";
import { patchWorkItemCellsApi } from "@/lib/planning/work-item-cells-client";
import type { WorkItem } from "@/types/operational/work-item";
import type { OperationalTableColumn } from "../components/operational-ui";

const todayIso = () => new Date().toISOString().slice(0, 10);

/**
 * Edición por celda de listas de WorkItem (Producción / Elaboración / Envasado / Codificado):
 * devuelve las props para `OperationalTable` / `ExcelOrList` y las especificaciones `edit` por columna.
 * La política (permisos, estados, protegidos) es la MISMA que aplica el servidor.
 */
export function useWorkItemCellEditing(items: WorkItem[], onChanged?: () => void | Promise<void>) {
  const workspace = useRequiredWorkspace();
  const { email, sectorId } = usePreviewSession();
  const session = useMemo(
    () => ({ email: email ?? workspace.context.email, sector: sectorId ?? workspace.context.sectorId }),
    [email, sectorId, workspace.context.email, workspace.context.sectorId]
  );
  const sector = workspace.context.sectorId;
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  // Especificación `edit` de una columna. `toItem` adapta filas que envuelven al WorkItem (p. ej. ActiveRow).
  const edit = useCallback(
    <R = WorkItem>(field: WorkItemCellField, toItem?: (row: R) => WorkItem): NonNullable<OperationalTableColumn<R>["edit"]> => ({
      kind: WORK_ITEM_CELL_KIND[field],
      sensitive: WORK_ITEM_SENSITIVE_FIELDS.has(field),
      protection: (row: R) => workItemCellProtection(toItem ? toItem(row) : (row as unknown as WorkItem), field, sector),
      validate: (raw: string) => {
        const v = validateWorkItemCellValue(field, raw);
        return v.ok ? null : v.message;
      },
    }),
    [sector]
  );

  const onCellsCommit = useCallback(
    async (changes: GenusGridCellChange[]): Promise<GenusGridCommitResult> => {
      const payload = changes.flatMap((c) =>
        isWorkItemCellField(c.columnKey)
          ? [{ id: c.rowId, field: c.columnKey, value: c.newValue, expectedVersion: Number(c.rowVersion), reason: c.reason }]
          : []
      );
      const res = await patchWorkItemCellsApi(session, payload);
      const failures = res.results.flatMap((r, i) =>
        r.ok ? [] : [{ rowId: payload[i]!.id, columnKey: payload[i]!.field, message: r.message }]
      );
      // Siempre se recarga: lo mostrado es lo que la base confirmó.
      await onChanged?.();
      if (res.ok && failures.length === 0) return { ok: true };
      return { ok: false, message: res.error ?? failures[0]?.message, failures };
    },
    [session, onChanged]
  );

  const reasonRequired = useCallback((changes: GenusGridCellChange[]): string | null => {
    const byId = new Map(itemsRef.current.map((i) => [i.id, i] as const));
    const need = changes.some((c) => {
      const item = byId.get(c.rowId);
      return item && isWorkItemCellField(c.columnKey) && workItemReasonRequired(item, c.columnKey, todayIso());
    });
    return need ? "Esta corrección requiere un motivo (queda auditado con valor anterior, nuevo y usuario)." : null;
  }, []);

  return {
    canEditCells: sector === "PRODUCCION",
    onCellsCommit,
    rowVersion: (row: WorkItem) => String(row.version ?? ""),
    reasonRequired,
    edit,
  };
}
