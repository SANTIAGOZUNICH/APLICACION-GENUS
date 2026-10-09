"use client";

import { useCallback, useMemo, type ReactNode } from "react";
import {
  GenusGrid,
  type GenusGridCellChange,
  type GenusGridColumn,
  type GenusGridCommitResult,
} from "@/components/data-grid/genus-grid";
import {
  ASIGNACION_CELL_KIND,
  ASIGNACION_CELL_FIELDS,
  IDENTITY_FIELDS,
  cellProtectionReason,
  isAsignacionCellField,
  validateCellValue,
  type AsignacionCellField,
} from "@/lib/asignacion-lotes/cell-edit";
import {
  AsignacionCellsApiError,
  patchAsignacionLoteCellsApi,
} from "@/lib/asignacion-lotes/asignacion-lotes-client";
import type { OrdersClientSession } from "@/lib/orders/orders-client";
import type { SectorId } from "@/types/operational/sector";
import type { AsignacionLote } from "../adapters/asignacion-lotes-repository";
import { formatDateDisplay } from "../lib/delivery-date";

const TITLES: Record<AsignacionCellField, string> = {
  lote: "Lote",
  fecha: "Fecha",
  producto: "Producto",
  codigo: "Código",
  marca: "Marca / Cliente",
  cantidades: "Cantidades",
  vto: "VTO",
  muestras: "Muestras",
  cjMuestra: "CJ muestra",
  fechaAnalisis: "Fecha análisis",
  observaciones: "Observaciones",
};

const WIDTHS: Partial<Record<AsignacionCellField, number>> = {
  lote: 110,
  fecha: 120,
  producto: 230,
  codigo: 110,
  marca: 150,
  cantidades: 110,
  vto: 120,
  muestras: 90,
  cjMuestra: 90,
  fechaAnalisis: 125,
  observaciones: 240,
};

function cellText(row: AsignacionLote, field: AsignacionCellField): string {
  const value = row[field];
  if (value === null || value === undefined) return "";
  if (ASIGNACION_CELL_KIND[field] === "date") return formatDateDisplay(String(value)).replace("—", "");
  return String(value);
}

function originLabel(row: AsignacionLote): string {
  const base = row.sourceId ? `Google${row.sourceSheetTab ? ` · ${row.sourceSheetTab}` : ""}` : "Manual";
  const edits = Object.values(row.localEdits ?? {});
  if (edits.some((e) => e.status === "CONFLICT")) return `${base} · ⚠ conflicto`;
  return edits.length > 0 ? `${base} · editado en GENUS` : base;
}

/** Adaptador de Asignación de Lotes sobre GenusGrid (ETAPA 1). */
export function AsignacionLotesGrid({
  rows,
  session,
  sector,
  canEdit,
  writableSourceIds,
  onRowsUpdated,
  onReload,
  renderRowActions,
  maxHeight,
  testId,
}: {
  rows: AsignacionLote[];
  session: OrdersClientSession;
  sector: SectorId;
  canEdit: boolean;
  /** Fuentes Google con escritura de vuelta habilitada (opción C). */
  writableSourceIds?: ReadonlySet<string>;
  /** El servidor confirmó: reemplazar estos registros en el estado/caché de la vista. */
  onRowsUpdated: (items: AsignacionLote[]) => void;
  onReload: () => void;
  renderRowActions?: (row: AsignacionLote) => ReactNode;
  maxHeight?: number;
  testId?: string;
}) {
  const columns = useMemo<GenusGridColumn<AsignacionLote>[]>(() => {
    const editable: GenusGridColumn<AsignacionLote>[] = ASIGNACION_CELL_FIELDS.map((field) => ({
      key: field,
      title: TITLES[field],
      kind: ASIGNACION_CELL_KIND[field],
      basis: WIDTHS[field],
      sensitive: IDENTITY_FIELDS.has(field),
      getValue: (row) => cellText(row, field),
      protection: (row) => cellProtectionReason(row, field, sector, writableSourceIds),
      // 0043: celda editada en GENUS (el sync no la pisa) o en conflicto con la planilla.
      cellClassName: (row) => {
        const e = row.localEdits?.[field];
        return e ? (e.status === "CONFLICT" ? "genus-cell-local-conflict" : "genus-cell-local-edit") : undefined;
      },
      validate: (raw) => {
        const result = validateCellValue(field, raw);
        return result.ok ? null : result.message;
      },
    }));
    // Columna derivada: solo lectura siempre (no es un campo del registro).
    editable.push({
      key: "origen",
      title: "Origen",
      basis: 130,
      getValue: originLabel,
      protection: () => "Columna calculada (solo lectura).",
    });
    return editable;
  }, [sector, writableSourceIds]);

  const onCommit = useCallback(
    async (changes: GenusGridCellChange[]): Promise<GenusGridCommitResult> => {
      const payload = changes.flatMap((c) =>
        isAsignacionCellField(c.columnKey)
          ? [{ id: c.rowId, field: c.columnKey, value: c.newValue, expectedVersion: c.rowVersion }]
          : []
      );
      try {
        const result = await patchAsignacionLoteCellsApi(session, payload);
        onRowsUpdated(result.items);
        return { ok: true };
      } catch (err) {
        if (err instanceof AsignacionCellsApiError) {
          // Fallo parcial: lo que sí quedó consistente en Google y Neon se refleja igual.
          if (err.items.length > 0) onRowsUpdated(err.items);
          return {
            ok: false,
            message: err.message,
            failures: err.failures.map((f) => ({ rowId: f.id, columnKey: f.field, message: f.message })),
          };
        }
        return { ok: false, message: err instanceof Error ? err.message : "No se pudo guardar." };
      }
    },
    [session, onRowsUpdated]
  );

  return (
    <GenusGrid<AsignacionLote>
      rows={rows}
      rowId={(row) => row.id}
      rowVersion={(row) => row.updatedAt}
      rowLabel={(row) => row.lote || row.id}
      columns={columns}
      onCommit={onCommit}
      canEdit={canEdit}
      onReload={onReload}
      renderRowActions={renderRowActions}
      rowActionsWidth={68}
      maxHeight={maxHeight}
      testId={testId ?? "asignacion-lotes-grid"}
      hint={
        <>
          Clic: seleccionar · doble clic / Enter / escribir: editar · arrastrar: rango · Ctrl+C / Ctrl+V (Excel y Google Sheets) ·
          Supr: limpiar · Ctrl+Z: deshacer el último guardado. Cada celda se guarda sola. Las filas de Google también se editan:
          el cambio queda en GENUS (borde verde agua) y la sincronización no lo pisa; si la planilla cambia ese dato, la celda
          se marca en ámbar para que decidas.
        </>
      }
    />
  );
}
