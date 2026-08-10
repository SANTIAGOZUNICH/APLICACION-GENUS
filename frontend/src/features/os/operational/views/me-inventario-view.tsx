"use client";

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
import { usePreviewSession, usePreviewContext } from "@/features/os/session/preview-context";

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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.cliente, r.insumo, r.codigo, r.ubicacion].join(" ").toLowerCase().includes(q)
    );
  }, [rows, search]);

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

  const columns: OperationalTableColumn<MeInventarioViewRow>[] = ME_INVENTARIO_COLUMNS.map(
    (label) => {
      const map: Record<string, keyof MeInventarioViewRow> = {
        CÓDIGO: "codigo",
        CLIENTE: "cliente",
        INSUMO: "insumo",
        BULTOS: "bultosDisplay",
        "CANTIDAD TOTAL": "cantidadTotal",
        UBICACIÓN: "ubicacion",
      };
      const key = map[label];
      return {
        key: label,
        header: label,
        render: (row) => displayCell(row[key]),
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
        Stock actual = Ingresos ME − cantidad utilizada en OA entregadas, agrupado únicamente por
        CÓDIGO. Las salidas manuales no descuentan. Productos con el mismo nombre y distinto código
        son independientes.
      </p>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          className="rounded border border-[var(--os-border)] px-3 py-1.5 text-sm"
          placeholder="Buscar por cliente, insumo, código o ubicación…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
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
        columns={[
          ...columns,
          ...(canWrite
            ? [
                {
                  key: "acciones",
                  header: "",
                  render: (row: MeInventarioViewRow) => (
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
                  ),
                } as OperationalTableColumn<MeInventarioViewRow>,
              ]
            : []),
        ]}
        rows={filtered}
        rowKey={(r) => r.materialId}
        emptyMessage="Inventario ME vacío. Cargá ingresos y entregá OA para ver movimientos."
        selection={
          sel.active
            ? { active: true, isSelected: sel.isSelected, onToggle: sel.toggle }
            : undefined
        }
      />
    </TwinShell>
  );
}
