"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { TwinShell } from "@/features/os/shell/twin-shell";
import { fetchInventory } from "@/features/os/operational/adapters/inventory-client";
import {
  OperationalTable,
  type OperationalTableColumn,
} from "@/features/os/operational/components/operational-ui";
import { displayCell } from "@/lib/inventory/calcs";
import {
  ME_INVENTARIO_COLUMNS,
  type MeInventarioViewRow,
} from "@/lib/inventory/types";

/**
 * Inventario ME consolidado.
 * STOCK = INGRESOS − salidas OA (no salidas manuales).
 * Columnas visibles exactas: CLIENTE, INSUMO, BULTOS, CANTIDAD TOTAL, UBICACIÓN.
 */
export function MeInventarioView() {
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

  const columns: OperationalTableColumn<MeInventarioViewRow>[] = ME_INVENTARIO_COLUMNS.map(
    (label) => {
      const map: Record<string, keyof MeInventarioViewRow> = {
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
        <div className="mb-4 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm">
          {banner}
        </div>
      )}
      <p className="mb-3 text-xs text-[var(--os-text-muted)]">
        Stock actual = Ingresos ME − cantidad utilizada en OA entregadas. Las salidas manuales no
        descuentan. El código se usa internamente para conciliar (búsqueda incluida).
      </p>
      <input
        className="mb-3 rounded border px-3 py-1.5 text-sm"
        placeholder="Buscar por cliente, insumo, código o ubicación…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <OperationalTable
        columns={columns}
        rows={filtered}
        rowKey={(r) => r.materialId}
        emptyMessage="Inventario ME vacío. Cargá ingresos y entregá OA para ver movimientos."
      />
    </TwinShell>
  );
}
