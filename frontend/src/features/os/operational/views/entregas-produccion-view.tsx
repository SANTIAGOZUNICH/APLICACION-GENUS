"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OperationalTable, excelCol } from "../components/operational-ui";
import type { GenusGridCellChange, GenusGridCommitResult, GenusGridDraftRows, GenusGridRowDelete } from "@/components/data-grid/genus-grid";
import { useDepositoDelete } from "../components/deposito-delete/use-deposito-delete";
import { SortSelect } from "../components/sort-select";
import { useSortPreference } from "../lib/use-sort-preference";
import { TwinShell } from "@/features/os/shell/twin-shell";
import { usePreviewContext, usePreviewSession } from "@/features/os/session/preview-context";
import { Button } from "@/components/ui/button";
import { downloadXlsx, exportFileName } from "@/lib/sheet-io";
import { applySort, compareDates, compareNumbers, compareStrings, type SortOption } from "@/lib/sorting/sort-contract";
import {
  DESPACHO_CELL_KIND,
  despachoCellProtection,
  formatDespachoFecha,
  isDespachoCellField,
  validateDespachoValue,
  type DespachoCellField,
} from "@/lib/despachos/cell-edit";
import { bulkDeleteDespachosApi, createDespachosApi, fetchDespachosApi, patchDespachoCellsApi } from "@/lib/despachos/despachos-client";
import { DESPACHO_EXPORT_HEADERS, despachosToRows, filterDespachos, resumenPorPedido, type DespachoFilters } from "@/lib/despachos/despachos-view-model";
import { canMutateDespachos } from "@/lib/despachos/despachos-rbac";
import type { CreateDespachoInput, DespachoRecord } from "@/lib/despachos/types";

export const DESPACHOS_SORT_OPTIONS: SortOption<DespachoRecord>[] = [
  { key: "fecha_desc", label: "Fecha: más recientes", compare: (a, b) => compareDates(a.fecha, b.fecha, "desc") },
  { key: "fecha_asc", label: "Fecha: más antiguas", compare: (a, b) => compareDates(a.fecha, b.fecha, "asc") },
  { key: "cliente_asc", label: "Cliente A-Z", compare: (a, b) => compareStrings(a.cliente, b.cliente, "asc") },
  { key: "producto_asc", label: "Producto A-Z", compare: (a, b) => compareStrings(a.producto, b.producto, "asc") },
  { key: "cantidad_desc", label: "Cantidad mayor a menor", compare: (a, b) => compareNumbers(a.cantidadTotal, b.cantidadTotal, "desc") },
];
const SORT_KEYS = DESPACHOS_SORT_OPTIONS.map((o) => o.key);

/** Columnas de la planilla, en este orden. */
export const DESPACHO_SHEET_KEYS = ["fecha", "remito", "cliente", "producto", "bultos", "cantidadTotal"] as const satisfies readonly DespachoCellField[];

/** Valores de una fila nueva de la planilla (texto tal cual se escribió/pegó) → alta. Los números/fecha inválidos se informan, no se descartan en silencio. */
export function draftToCreateInput(draftId: string, v: Record<string, string>): { ok: true; input: CreateDespachoInput } | { ok: false; message: string } {
  const fecha = validateDespachoValue("fecha", v.fecha ?? "");
  if (!fecha.ok) return { ok: false, message: `Fecha: ${fecha.message}` };
  const bultos = validateDespachoValue("bultos", v.bultos ?? "");
  if (!bultos.ok) return { ok: false, message: `Bultos: ${bultos.message}` };
  const cant = validateDespachoValue("cantidadTotal", v.cantidadTotal ?? "");
  if (!cant.ok) return { ok: false, message: `Cantidad total: ${cant.message}` };
  return {
    ok: true,
    input: {
      fecha: String(fecha.value),
      remito: (v.remito ?? "").trim(), // texto: conserva ceros iniciales
      cliente: (v.cliente ?? "").trim(),
      producto: (v.producto ?? "").trim(),
      bultos: Number(bultos.value),
      cantidadTotal: Number(cant.value),
      idempotencyKey: `despacho-${draftId}`, // mismo id de fila nueva => reintento / doble pegado NO duplica
    },
  };
}

const isBlankDraft = (v: Record<string, string>) => DESPACHO_SHEET_KEYS.every((k) => !(v[k] ?? "").trim());

/**
 * Depósito → Entregas Producción: planilla tipo Excel (misma grilla que Ingresos/Salidas ME y Graneles): se escribe, pega y borra
 * directo en las celdas, con filas en blanco al final y guardado automático. Una fila = un producto de una entrega.
 * Operativo: no mueve stock ni MP y no se genera desde la entrega de Envasado a Producción.
 */
export function EntregasProduccionView() {
  const { sectorId, email } = usePreviewSession();
  const { showToast } = usePreviewContext();
  const session = useMemo(() => ({ email, sector: sectorId }), [email, sectorId]);
  const canEdit = canMutateDespachos(sectorId);

  const [items, setItems] = useState<DespachoRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [filters, setFilters] = useState<DespachoFilters>({});

  const refresh = useCallback(async () => {
    try {
      setItems(await fetchDespachosApi(session));
      setOffline(false);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "No se pudo cargar Entregas Producción.", "info");
      setOffline(true);
    } finally {
      setLoading(false);
    }
  }, [session, showToast]);

  useEffect(() => {
    const t = setTimeout(() => void refresh(), 0);
    return () => clearTimeout(t);
  }, [refresh]);

  // Edición directa de celdas: guarda solo y vuelve a leer lo que la base confirmó.
  const commitCells = useCallback(
    async (changes: GenusGridCellChange[]): Promise<GenusGridCommitResult> => {
      const payload = changes.flatMap((c) =>
        isDespachoCellField(c.columnKey) ? [{ id: c.rowId, field: c.columnKey, value: c.newValue, expectedVersion: c.rowVersion ?? "" }] : []
      );
      const res = await patchDespachoCellsApi(session, payload);
      await refresh();
      const failures = res.results.flatMap((r, i) => (r.ok ? [] : [{ rowId: payload[i]?.id ?? "", columnKey: payload[i]?.field ?? "", message: r.message ?? "Error" }]));
      if (res.ok && failures.length === 0) return { ok: true };
      return { ok: false, message: res.error ?? failures[0]?.message, failures };
    },
    [session, refresh]
  );

  // Altas de filas nuevas (escritas o pegadas): se agrupan en UN envío para que pegar cientos de filas sea rápido.
  const pending = useRef<Array<{ input: CreateDespachoInput; resolve: (r: { ok: boolean; message?: string }) => void }>>([]);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flush = useCallback(async () => {
    flushTimer.current = null;
    const batch = pending.current.splice(0);
    for (let i = 0; i < batch.length; i += 200) {
      const chunk = batch.slice(i, i + 200);
      try {
        const results = await createDespachosApi(session, chunk.map((c) => c.input), "");
        chunk.forEach((c, k) => {
          const r = results[k];
          c.resolve(r?.ok ? { ok: true } : { ok: false, message: r && !r.ok ? r.message : "No se pudo guardar la fila." });
        });
      } catch (err) {
        chunk.forEach((c) => c.resolve({ ok: false, message: err instanceof Error ? err.message : "No se pudo guardar." }));
      }
    }
    await refresh();
  }, [session, refresh]);

  const draftRows = useMemo<GenusGridDraftRows | undefined>(
    () =>
      canEdit
        ? {
            createKeys: [...DESPACHO_SHEET_KEYS],
            requiredKeys: [], // se permiten filas incompletas: se completan después
            storageKey: `genus-draft:${email ?? "anon"}:entregas-produccion`,
            minBlank: 10,
            validate: (v) => {
              const r = draftToCreateInput("validate", v);
              return r.ok ? null : r.message;
            },
            onCreate: (draftId, v) => {
              if (isBlankDraft(v)) return Promise.resolve({ ok: true }); // se borró todo lo escrito: no hay nada que guardar
              const r = draftToCreateInput(draftId, v);
              if (!r.ok) return Promise.resolve({ ok: false, message: r.message });
              return new Promise((resolve) => {
                pending.current.push({ input: r.input, resolve });
                if (!flushTimer.current) flushTimer.current = setTimeout(() => void flush(), 250);
              });
            },
          }
        : undefined,
    [canEdit, email, flush]
  );

  const [sort, setSort] = useSortPreference("deposito-despachos", "fecha_desc", SORT_KEYS);
  const filtered = useMemo(() => applySort(filterDespachos(items, filters), DESPACHOS_SORT_OPTIONS, sort), [items, filters, sort]);
  const itemsById = useMemo(() => new Map(items.map((r) => [r.id, r] as const)), [items]);
  const pedidos = useMemo(() => resumenPorPedido(filtered), [filtered]);
  const totals = useMemo(() => ({ bultos: filtered.reduce((s, r) => s + r.bultos, 0), cant: filtered.reduce((s, r) => s + r.cantidadTotal, 0) }), [filtered]);

  const del = useDepositoDelete({
    canWrite: canEdit,
    visibleIds: useMemo(() => filtered.map((r) => r.id), [filtered]),
    tableCount: items.length,
    noun: "entregas",
    deleteIds: (ids) => bulkDeleteDespachosApi(session, { ids }),
    deleteAll: () => bulkDeleteDespachosApi(session, { all: true }),
    afterDelete: refresh,
    onMessage: (m) => showToast(m),
  });

  // Eliminar filas desde la planilla (selección de filas completas): sin motivo, con auditoría en el servidor.
  const rowDelete = useMemo<GenusGridRowDelete | undefined>(
    () =>
      canEdit
        ? {
            check: () => null,
            onDelete: async (ids) => {
              try {
                const res = await bulkDeleteDespachosApi(session, { ids });
                await refresh();
                const n = res.deleted.length;
                return { ok: n > 0, message: `${n} fila${n === 1 ? "" : "s"} eliminada${n === 1 ? "" : "s"}${res.failed.length ? ` · ${res.failed.length} con error: ${res.failed[0]!.message}` : ""}.` };
              } catch (e) {
                await refresh();
                return { ok: false, message: e instanceof Error ? e.message : "No se pudo eliminar." };
              }
            },
          }
        : undefined,
    [canEdit, session, refresh]
  );

  const edit = (field: DespachoCellField) => ({
    kind: DESPACHO_CELL_KIND[field],
    protection: (r: DespachoRecord) => despachoCellProtection(r, field, canEdit),
    validate: (raw: string) => {
      const v = validateDespachoValue(field, raw);
      return v.ok ? null : v.message;
    },
  });

  async function exportXlsx() {
    await downloadXlsx(exportFileName("entregas-produccion", "xlsx"), "Entregas Producción", DESPACHO_EXPORT_HEADERS, despachosToRows(filtered));
  }

  const setF = (k: keyof DespachoFilters) => (e: React.ChangeEvent<HTMLInputElement>) => setFilters((f) => ({ ...f, [k]: e.target.value }));
  const inputCls = "rounded border px-2 py-1.5 text-sm";

  return (
    <TwinShell title="Entregas Producción">
      <header className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Entregas Producción</h2>
          <p className="text-sm text-[var(--os-text-muted)]">
            Despachos de producto terminado · una fila = un producto de una entrega · escribí o pegá directo en la planilla · no modifica stock ni materias primas
          </p>
        </div>
        <Button variant="secondary" onClick={() => void exportXlsx()} disabled={filtered.length === 0} data-testid="despachos-export">Exportar Excel</Button>
      </header>

      {!canEdit ? (
        <p className="mb-3 rounded border border-[var(--os-border)] px-3 py-2 text-sm text-[var(--os-text-muted)]">Solo consulta: las entregas las carga Depósito.</p>
      ) : null}
      {offline ? <p className="mb-3 rounded border border-red-500/40 px-3 py-2 text-sm">Sin conexión al servidor — reintentá recargar.</p> : null}

      <div className="mb-3 flex flex-wrap items-end gap-2" data-testid="despachos-filters">
        <input value={filters.q ?? ""} onChange={setF("q")} placeholder="Buscar…" aria-label="Buscar" className={`${inputCls} min-w-[10rem] flex-1`} />
        <label className="text-xs">Desde<input type="date" value={filters.desde ?? ""} onChange={setF("desde")} className={`${inputCls} ml-1`} data-testid="despachos-f-desde" /></label>
        <label className="text-xs">Hasta<input type="date" value={filters.hasta ?? ""} onChange={setF("hasta")} className={`${inputCls} ml-1`} data-testid="despachos-f-hasta" /></label>
        <input value={filters.cliente ?? ""} onChange={setF("cliente")} placeholder="Cliente" aria-label="Filtrar por cliente" className={`${inputCls} w-32`} data-testid="despachos-f-cliente" />
        <input value={filters.producto ?? ""} onChange={setF("producto")} placeholder="Producto" aria-label="Filtrar por producto" className={`${inputCls} w-32`} data-testid="despachos-f-producto" />
        <input value={filters.remito ?? ""} onChange={setF("remito")} placeholder="N.º remito" aria-label="Filtrar por remito" className={`${inputCls} w-28`} data-testid="despachos-f-remito" />
        {Object.values(filters).some(Boolean) ? <Button size="sm" variant="secondary" onClick={() => setFilters({})}>Limpiar</Button> : null}
        <SortSelect value={sort} onChange={setSort} options={DESPACHOS_SORT_OPTIONS} testId="despachos-sort" />
      </div>

      {del.bar}

      {loading ? (
        <p className="text-sm text-[var(--os-text-muted)]">Cargando…</p>
      ) : (
        <>
          <OperationalTable<DespachoRecord>
            tableId="entregas-produccion"
            columns={[
              excelCol("fecha", "FECHA", (r: DespachoRecord) => formatDespachoFecha(r.fecha), { edit: edit("fecha") }),
              excelCol("remito", "N.º REMITO", (r: DespachoRecord) => r.remito, { edit: edit("remito") }),
              excelCol("cliente", "CLIENTE", (r: DespachoRecord) => r.cliente, { edit: edit("cliente") }),
              excelCol("producto", "PRODUCTO", (r: DespachoRecord) => r.producto, { edit: edit("producto") }),
              excelCol("bultos", "BULTOS", (r: DespachoRecord) => String(r.bultos), { edit: edit("bultos") }),
              excelCol("cantidadTotal", "CANTIDAD TOTAL", (r: DespachoRecord) => String(r.cantidadTotal), { edit: edit("cantidadTotal") }),
            ]}
            rows={filtered}
            rowKey={(r) => r.id}
            continuous
            draftRows={draftRows}
            rowDelete={rowDelete}
            rowCheck={del.rowCheck}
            canEditCells={canEdit}
            onCellsCommit={commitCells}
            rowVersion={(r) => itemsById.get(r.id)?.updatedAt ?? r.updatedAt}
            emptyMessage={items.length === 0 ? "Todavía no hay entregas registradas." : "Ninguna entrega coincide con los filtros."}
          />
          <p className="mt-2 text-xs text-[var(--os-text-muted)]" data-testid="despachos-totals">
            {filtered.length} entrega(s) · {totals.bultos} bultos · {totals.cant} en total
          </p>
        </>
      )}

      {pedidos.length > 0 ? (
        <section className="mt-5" data-testid="despachos-pedidos">
          <h3 className="mb-1 text-sm font-semibold">Entregas parciales por pedido / OP</h3>
          <div className="space-y-2">
            {pedidos.map((p) => (
              <details key={p.pedidoOp} className="rounded border border-[var(--os-border)] px-3 py-2 text-sm">
                <summary className="cursor-pointer">
                  <strong>{p.pedidoOp}</strong> · {p.entregas.length} entrega(s) · {p.bultos} bultos · {p.cantidadTotal} en total
                </summary>
                <ul className="mt-1 space-y-0.5 text-xs">
                  {p.entregas.map((e) => (
                    <li key={e.id}>{formatDespachoFecha(e.fecha) || "sin fecha"} · remito {e.remito || "—"} · {e.producto || "—"} · {e.bultos} bultos · {e.cantidadTotal}</li>
                  ))}
                </ul>
              </details>
            ))}
          </div>
        </section>
      ) : null}
    </TwinShell>
  );
}
