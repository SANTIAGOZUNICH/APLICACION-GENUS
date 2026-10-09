"use client";

import { readOnlyReason } from "@/features/os/operational/lib/readonly-reasons";
import { useCallback, useEffect, useMemo, useState } from "react";
import { TwinShell } from "@/features/os/shell/twin-shell";
import {
  fetchInventory,
  mutateInventory,
  InventoryClientError,
} from "@/features/os/operational/adapters/inventory-client";
import {
  OperationalTable,
  type OperationalTableColumn,
} from "@/features/os/operational/components/operational-ui";
import { DeleteAction } from "@/features/os/operational/components/delete-action";
import {
  BulkDeleteAction,
  type BulkDeleteSummary,
} from "@/features/os/operational/components/bulk-delete-action";
import {
  ListSelectionEnterButton,
  useListSelectionMode,
} from "../components/list-selection-mode";
import { displayCell } from "@/lib/inventory/calcs";
import {
  ME_INVENTARIO_COLUMNS,
  type MeInventarioViewRow,
} from "@/lib/inventory/types";
import { canWriteInventory } from "@/lib/inventory/rbac";
import { useMeSheetEditing } from "@/features/os/operational/hooks/use-me-sheet-cells";
import { MeStockDialog } from "@/features/os/operational/components/me-stock-dialog";
import { MeHistoryDialog } from "@/features/os/operational/components/me-history-dialog";
import { usePreviewSession, usePreviewContext } from "@/features/os/session/preview-context";
import { SortSelect } from "@/features/os/operational/components/sort-select";
import { useSortPreference } from "@/features/os/operational/lib/use-sort-preference";
import { applySort, compareNumbers, compareStrings, type SortOption } from "@/lib/sorting/sort-contract";

// Se editan los datos del material. CÓDIGO (clave) y CANTIDAD TOTAL (se calcula) NO: el stock se corrige con un
// ajuste (motivo + historial) o corrigiendo el ingreso / la salida de origen.
const ME_CELL_FIELDS: Record<string, string> = {
  CLIENTE: "cliente", INSUMO: "descripcion", UBICACIÓN: "ubicacion", UNIDAD: "unidad", "CANT. POR BULTO": "cantidadPorBulto", "STOCK MÍNIMO": "stockMinimo", "PUNTO DE REPOSICIÓN": "puntoReposicion",
};

export const ME_INVENTARIO_SORT_OPTIONS: SortOption<MeInventarioViewRow>[] = [
  { key: "codigo_asc", label: "Código A-Z", compare: (a, b) => compareStrings(a.codigo, b.codigo, "asc") },
  { key: "cliente_asc", label: "Cliente A-Z", compare: (a, b) => compareStrings(a.cliente, b.cliente, "asc") },
  { key: "insumo_asc", label: "Insumo A-Z", compare: (a, b) => compareStrings(a.insumo, b.insumo, "asc") },
  { key: "cantidad_desc", label: "Cantidad mayor a menor", compare: (a, b) => compareNumbers(a.cantidadTotal, b.cantidadTotal, "desc") },
  { key: "cantidad_asc", label: "Cantidad menor a mayor", compare: (a, b) => compareNumbers(a.cantidadTotal, b.cantidadTotal, "asc") },
];
const ME_INVENTARIO_SORT_KEYS = ME_INVENTARIO_SORT_OPTIONS.map((o) => o.key);

const DELETE_DESCRIPTION =
  "Se eliminará el material del inventario operativo. Si había ingresos asociados se anulan y el stock se recalcula. Motivo (opcional).";

/**
 * Inventario ME consolidado.
 * STOCK = INGRESOS − salidas OA (no salidas manuales).
 * Columnas visibles exactas: CLIENTE, INSUMO, BULTOS, CANTIDAD TOTAL, UBICACIÓN.
 */
export function MeInventarioView() {
  const { sectorId } = usePreviewSession();
  const { showToast } = usePreviewContext();
  const canWrite = canWriteInventory(sectorId, "me_stock");
  const [rows, setRows] = useState<MeInventarioViewRow[]>([]);
  const [banner, setBanner] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const reload = useCallback(async () => {
    const res = await fetchInventory<MeInventarioViewRow>("me_inventario" as never);
    setRows(res.data);
    setBanner(res.message ?? null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      void (async () => {
        try {
          await reload();
        } catch (e) {
          if (!cancelled) setBanner(e instanceof Error ? e.message : "Error");
        }
      })();
    });
    return () => {
      cancelled = true;
    };
  }, [reload]);

  const [sort, setSort] = useSortPreference("me-inventario", "codigo_asc", ME_INVENTARIO_SORT_KEYS);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = !q
      ? rows
      : rows.filter((r) => [r.cliente, r.insumo, r.codigo, r.ubicacion].join(" ").toLowerCase().includes(q));
    return applySort(base, ME_INVENTARIO_SORT_OPTIONS, sort);
  }, [rows, search, sort]);

  const visibleIds = useMemo(() => filtered.map((r) => r.materialId), [filtered]);
  const sel = useListSelectionMode(visibleIds);

  const deleteMaterial = useCallback(
    async (materialId: string, reason: string) => {
      await mutateInventory({
        action: "delete",
        resource: "me_stock",
        id: materialId,
        reason,
      });
      setRows((prev) => prev.filter((row) => row.materialId !== materialId));
      await reload();
    },
    [reload]
  );

  const cells = useMeSheetEditing<MeInventarioViewRow>("me_inventario", sectorId, canWrite, ME_CELL_FIELDS, reload);
  const canAdjust = canWriteInventory(sectorId, "me_ajustes");
  const [stockFor, setStockFor] = useState<{ materialId: string; codigo: string; insumo: string; stock: number } | null>(null);
  const [historyFor, setHistoryFor] = useState<{ id: string; label: string } | null>(null);
  const openStock = (row: MeInventarioViewRow) => setStockFor({ materialId: row.materialId, codigo: row.codigo, insumo: row.insumo, stock: row.cantidadTotal });

  const columns: OperationalTableColumn<MeInventarioViewRow>[] = [...ME_INVENTARIO_COLUMNS, "UNIDAD", "CANT. POR BULTO", "STOCK MÍNIMO", "PUNTO DE REPOSICIÓN"].map(
    (label) => {
      const map: Record<string, keyof MeInventarioViewRow> = {
        CÓDIGO: "codigo",
        CLIENTE: "cliente",
        INSUMO: "insumo",
        BULTOS: "bultosDisplay",
        "CANTIDAD TOTAL": "cantidadTotal",
        UBICACIÓN: "ubicacion",
        UNIDAD: "unidad",
        "CANT. POR BULTO": "cantidadPorBulto",
        "STOCK MÍNIMO": "stockMinimo",
        "PUNTO DE REPOSICIÓN": "puntoReposicion",
      };
      const key = map[label];
      const extra = ["UNIDAD", "CANT. POR BULTO", "STOCK MÍNIMO", "PUNTO DE REPOSICIÓN"].includes(label);
      return {
        key: label,
        header: label,
        // Los umbrales viven en la planilla; la lista conserva sus columnas de siempre.
        excelOnly: extra,
        text: (row: MeInventarioViewRow) => (row[key] == null ? "" : String(row[key])),
        render: (row) =>
          label === "CANTIDAD TOTAL" && row.cantidadTotal < 0 ? (
            <span className="font-semibold text-red-600">
              {`🔴 STOCK NEGATIVO: ${row.cantidadTotal.toLocaleString("es-AR")} UN.`}
            </span>
          ) : (
            displayCell(row[key])
          ),
      };
    }
  );

  return (
    <TwinShell title="Inventario ME">
      {banner && (
        <div className="mb-4 rounded border border-[var(--genus-warning)]/30 bg-[var(--genus-warning-soft)] px-3 py-2 text-sm text-[var(--genus-warning)]">
          {banner}
        </div>
      )}
      <p className="mb-3 text-xs text-[var(--os-text-muted)]">
        Stock actual = Ingresos ME − consumos de OA entregadas − salidas manuales que descuentan (devolución, descarte,
        traslado, muestra) + ajustes, agrupado por CÓDIGO. El stock no se escribe a mano: abrí «Stock» para ver los
        movimientos, corregir el de origen o registrar un ajuste con motivo. Un stock negativo se muestra tal cual.
      </p>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          className="rounded border border-[var(--os-border)] px-3 py-1.5 text-sm"
          placeholder="Buscar por cliente, insumo, código o ubicación…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <SortSelect value={sort} onChange={setSort} options={ME_INVENTARIO_SORT_OPTIONS} testId="me-inventario-sort" />
        {canWrite &&
          (!sel.active ? (
            <ListSelectionEnterButton onClick={sel.enter} />
          ) : (
            <BulkDeleteAction
              selectedCount={sel.selectedCount}
              onSelectAll={sel.selectAllVisible}
              onDeselectAll={sel.deselectAll}
              onCancel={sel.cancel}
              title="Eliminar materiales ME"
              deleteLabel="Eliminar seleccionados"
              onConfirm={async (reason) => {
                const summary: BulkDeleteSummary = {
                  requested: sel.selectedIds.size,
                  deleted: 0,
                  alreadyDeleted: 0,
                  forbidden: 0,
                  failed: 0,
                };
                const byId = new Map(filtered.map((r) => [r.materialId, r]));
                const deletedIds: string[] = [];
                for (const id of sel.selectedIds) {
                  if (!byId.has(id)) {
                    summary.alreadyDeleted += 1;
                    continue;
                  }
                  try {
                    await mutateInventory({
                      action: "delete",
                      resource: "me_stock",
                      id,
                      reason,
                    });
                    summary.deleted += 1;
                    deletedIds.push(id);
                  } catch (e) {
                    if (e instanceof InventoryClientError && e.code === "FORBIDDEN") {
                      summary.forbidden += 1;
                    } else {
                      summary.failed += 1;
                    }
                  }
                }
                sel.cancel();
                if (deletedIds.length > 0) {
                  setRows((prev) => prev.filter((row) => !deletedIds.includes(row.materialId)));
                }
                await reload();
                return summary;
              }}
              onSummary={(summary) => {
                const parts = [`${summary.deleted} eliminado(s)`];
                if (summary.alreadyDeleted) parts.push(`${summary.alreadyDeleted} ya eliminado(s)`);
                if (summary.forbidden) parts.push(`${summary.forbidden} sin permiso`);
                if (summary.failed) parts.push(`${summary.failed} error(es)`);
                showToast(parts.join(" · "), summary.deleted > 0 ? "success" : "info");
              }}
            />
          ))}
      </div>
      <OperationalTable
        tableId="me-inventario"
        canEditCells={cells.canEditCells}
        onCellsCommit={cells.onCellsCommit}
        rowVersion={cells.rowVersion}
        columns={[
          ...columns.map((col) => ({ ...col, edit: cells.edit(String(col.key)), readOnlyReason: readOnlyReason("me_inventario", String(col.key)) })),
          ...(canWrite
            ? [
                {
                  key: "acciones",
                  header: "",
                  render: (row: MeInventarioViewRow) => (
                    <span className="inline-flex items-center gap-1">
                    <button type="button" onClick={() => openStock(row)} className={`rounded px-1.5 py-0.5 text-xs font-semibold ${row.cantidadTotal < 0 ? "bg-red-500/15 text-red-500" : "text-[var(--os-teal)] hover:underline"}`} data-testid="me-stock-open" title="Movimientos y ajuste de inventario">
                      {row.cantidadTotal < 0 ? "Corregir" : "Stock"}
                    </button>
                    <button type="button" onClick={() => setHistoryFor({ id: row.materialId, label: `${row.codigo} · ${row.insumo}` })} className="rounded px-1 text-xs text-[var(--os-text-muted)] hover:underline" title="Historial de cambios del material">
                      Historial
                    </button>
                    <DeleteAction
                      entityLabel={row.insumo || row.codigo || row.materialId}
                      title="Eliminar material ME"
                      description={DELETE_DESCRIPTION}
                      onConfirm={async (reason) => {
                        try {
                          await deleteMaterial(row.materialId, reason);
                          showToast("Material eliminado", "success");
                        } catch (e) {
                          throw e instanceof InventoryClientError
                            ? e
                            : new Error("No se pudo eliminar el material.");
                        }
                      }}
                    />
                    </span>
                  ),
                } as OperationalTableColumn<MeInventarioViewRow>,
              ]
            : []),
        ]}
        rows={filtered}
        rowKey={(r) => r.materialId}
        rowClassName={(r) => (r.cantidadTotal < 0 ? "genus-row-stock-negativo" : undefined)}
        emptyMessage="Inventario ME vacío. Cargá ingresos y entregá OA para ver movimientos."
        selection={
          sel.active
            ? { active: true, isSelected: sel.isSelected, onToggle: sel.toggle }
            : undefined
        }
      />
      <MeStockDialog target={stockFor} canAdjust={canAdjust} onClose={() => setStockFor(null)} onAdjusted={() => void reload()} />
      <MeHistoryDialog target={historyFor} onClose={() => setHistoryFor(null)} />
    </TwinShell>
  );
}
