"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ExcelOrList, excelCol } from "../components/operational-ui";
import type { GenusGridCellChange, GenusGridCommitResult } from "@/components/data-grid/genus-grid";
import { ExcelPasteDialog } from "../components/excel-paste-dialog";
import { useDepositoDelete } from "../components/deposito-delete/use-deposito-delete";
import { SelectionCheckbox, selectedRowClassName } from "../components/list-selection-mode";
import { SortSelect } from "../components/sort-select";
import { useSortPreference } from "../lib/use-sort-preference";
import { TwinShell } from "@/features/os/shell/twin-shell";
import { usePreviewContext, usePreviewSession } from "@/features/os/session/preview-context";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { downloadXlsx, exportFileName } from "@/lib/sheet-io";
import { applySort, compareDates, compareNumbers, compareStrings, type SortOption } from "@/lib/sorting/sort-contract";
import { parseFlexibleDate } from "../lib/delivery-date";
import {
  DESPACHO_CELL_KIND,
  despachoCellProtection,
  formatDespachoFecha,
  isDespachoCellField,
  validateDespachoValue,
  type DespachoCellField,
} from "@/lib/despachos/cell-edit";
import {
  bulkDeleteDespachosApi,
  createDespachoApi,
  createDespachosApi,
  fetchDespachoHistoryApi,
  fetchDespachosApi,
  patchDespachoCellsApi,
} from "@/lib/despachos/despachos-client";
import {
  DESPACHO_EXPORT_HEADERS,
  DESPACHO_PASTE_ALIASES,
  despachosToRows,
  filterDespachos,
  resumenPorPedido,
  type DespachoFilters,
} from "@/lib/despachos/despachos-view-model";
import { canMutateDespachos } from "@/lib/despachos/despachos-rbac";
import type { DespachoAuditEntry, DespachoRecord } from "@/lib/despachos/types";

export const DESPACHOS_SORT_OPTIONS: SortOption<DespachoRecord>[] = [
  { key: "fecha_desc", label: "Fecha: más recientes", compare: (a, b) => compareDates(a.fecha, b.fecha, "desc") },
  { key: "fecha_asc", label: "Fecha: más antiguas", compare: (a, b) => compareDates(a.fecha, b.fecha, "asc") },
  { key: "cliente_asc", label: "Cliente A-Z", compare: (a, b) => compareStrings(a.cliente, b.cliente, "asc") },
  { key: "producto_asc", label: "Producto A-Z", compare: (a, b) => compareStrings(a.producto, b.producto, "asc") },
  { key: "cantidad_desc", label: "Cantidad mayor a menor", compare: (a, b) => compareNumbers(a.cantidadTotal, b.cantidadTotal, "desc") },
];
const SORT_KEYS = DESPACHOS_SORT_OPTIONS.map((o) => o.key);

const today = () => new Date().toISOString().slice(0, 10);
const mintKey = () => `despacho-${crypto.randomUUID()}`;
const EMPTY_FORM = () => ({ fecha: today(), remito: "", cliente: "", producto: "", bultos: "", cantidadTotal: "", pedidoOp: "" });

const FIELD_LABEL: Record<string, string> = {
  fecha: "Fecha", remito: "N.º de remito", cliente: "Cliente", producto: "Producto", bultos: "Bultos", cantidadTotal: "Cantidad total", pedidoOp: "Pedido / OP",
};

/**
 * Depósito → Entregas Producción: registro de cada despacho de producto terminado que sale de fábrica (completo o parcial).
 * Una fila = un producto de una entrega. Operativo: no mueve stock ni MP y no se genera desde la entrega de Envasado a Producción.
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
  const [createOpen, setCreateOpen] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const createKey = useRef<string | null>(null);
  const pasteKey = useRef<string | null>(null);
  const [historyFor, setHistoryFor] = useState<DespachoRecord | null>(null);
  const [history, setHistory] = useState<DespachoAuditEntry[] | null>(null);

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

  const edit = (field: DespachoCellField) => ({
    kind: DESPACHO_CELL_KIND[field],
    protection: (r: DespachoRecord) => despachoCellProtection(r, field, canEdit),
    validate: (raw: string) => {
      const v = validateDespachoValue(field, raw);
      return v.ok ? null : v.message;
    },
  });

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

  function openCreate() {
    createKey.current = mintKey();
    setForm(EMPTY_FORM());
    setCreateOpen(true);
  }

  async function submitCreate() {
    if (busy) return; // doble clic
    const iso = parseFlexibleDate(form.fecha);
    if (!iso) {
      showToast("Indicá una fecha válida.", "info");
      return;
    }
    const bultos = validateDespachoValue("bultos", form.bultos);
    const cant = validateDespachoValue("cantidadTotal", form.cantidadTotal);
    if (!bultos.ok || !cant.ok) {
      showToast("Bultos y cantidad total deben ser números ≥ 0.", "info");
      return;
    }
    setBusy(true);
    try {
      const r = await createDespachoApi(session, {
        fecha: iso,
        remito: form.remito,
        cliente: form.cliente,
        producto: form.producto,
        bultos: Number(bultos.value),
        cantidadTotal: Number(cant.value),
        pedidoOp: form.pedidoOp,
        idempotencyKey: createKey.current ?? mintKey(),
      });
      createKey.current = null;
      setCreateOpen(false);
      await refresh();
      showToast(r.created ? "Entrega registrada." : "Esta entrega ya estaba registrada (no se duplicó).");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "No se pudo registrar la entrega.", "info"); // la clave se conserva: reintentar no duplica
    } finally {
      setBusy(false);
    }
  }

  async function openHistory(r: DespachoRecord) {
    setHistoryFor(r);
    setHistory(null);
    try {
      setHistory(await fetchDespachoHistoryApi(session, r.id));
    } catch (err) {
      showToast(err instanceof Error ? err.message : "No se pudo cargar el historial.", "info");
      setHistory([]);
    }
  }

  async function exportXlsx() {
    await downloadXlsx(exportFileName("entregas-produccion", "xlsx"), "Entregas Producción", DESPACHO_EXPORT_HEADERS, despachosToRows(filtered));
  }

  const setF = (k: keyof DespachoFilters) => (e: React.ChangeEvent<HTMLInputElement>) => setFilters((f) => ({ ...f, [k]: e.target.value }));
  const inputCls = "rounded border px-2 py-1.5 text-sm";

  return (
    <TwinShell title="Entregas Producción">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Entregas Producción</h2>
          <p className="text-sm text-[var(--os-text-muted)]">
            Despachos de producto terminado que salen de fábrica · una fila = un producto de una entrega · no modifica stock ni materias primas
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canEdit ? (
            <>
              <Button onClick={openCreate} data-testid="despachos-create">+ Agregar entrega</Button>
              <Button variant="secondary" onClick={() => setPasteOpen(true)} data-testid="despachos-paste">Pegar desde Excel</Button>
            </>
          ) : null}
          <Button variant="secondary" onClick={() => void exportXlsx()} disabled={filtered.length === 0} data-testid="despachos-export">Exportar Excel</Button>
        </div>
      </header>

      {!canEdit ? (
        <p className="mb-3 rounded border border-[var(--os-border)] px-3 py-2 text-sm text-[var(--os-text-muted)]">Solo consulta: las entregas las carga Depósito.</p>
      ) : null}
      <div className="mb-3 rounded-[var(--os-radius-sm)] border border-[var(--os-teal)]/40 bg-[var(--os-teal-soft)]/30 px-4 py-2 text-sm">
        {offline ? "Sin conexión al servidor — reintentá recargar." : "Sincronizado con servidor."}
      </div>

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
      ) : filtered.length === 0 ? (
        <p className="text-sm text-[var(--os-text-muted)]" data-testid="despachos-empty">
          {items.length === 0 ? "Todavía no hay entregas registradas." : "Ninguna entrega coincide con los filtros."}
        </p>
      ) : (
        <>
          <ExcelOrList
            tableId="despachos"
            rows={filtered}
            rowKey={(r) => r.id}
            rowCheck={del.rowCheck}
            canEditCells={canEdit}
            onCellsCommit={commitCells}
            rowVersion={(r) => itemsById.get(r.id)?.updatedAt ?? r.updatedAt}
            columns={[
              excelCol("fecha", "Fecha", (r: DespachoRecord) => formatDespachoFecha(r.fecha), { edit: edit("fecha") }),
              excelCol("remito", "N.º de remito", (r: DespachoRecord) => r.remito, { edit: edit("remito") }),
              excelCol("cliente", "Cliente", (r: DespachoRecord) => r.cliente, { edit: edit("cliente") }),
              excelCol("producto", "Producto", (r: DespachoRecord) => r.producto, { edit: edit("producto") }),
              excelCol("bultos", "Bultos", (r: DespachoRecord) => String(r.bultos), { edit: edit("bultos") }),
              excelCol("cantidadTotal", "Cantidad total", (r: DespachoRecord) => String(r.cantidadTotal), { edit: edit("cantidadTotal") }),
              excelCol("pedidoOp", "Pedido / OP (opcional)", (r: DespachoRecord) => r.pedidoOp, { edit: edit("pedidoOp") }),
              {
                key: "acciones",
                header: "Historial",
                action: true,
                text: () => "",
                render: (r: DespachoRecord) => <Button size="sm" variant="secondary" onClick={() => void openHistory(r)}>Historial</Button>,
              },
            ]}
          >
            <table className="os-table w-full text-sm" data-testid="despachos-table">
              <thead>
                <tr className="text-left text-xs uppercase text-[var(--os-text-muted)]">
                  {del.rowCheck ? <th className="w-8 py-2"><SelectionCheckbox checked={del.rowCheck.allChecked} onChange={del.rowCheck.onToggleAll} label="Seleccionar todas las filas visibles" /></th> : null}
                  <th className="py-2">Fecha</th><th className="py-2">N.º de remito</th><th className="py-2">Cliente</th><th className="py-2">Producto</th>
                  <th className="py-2">Bultos</th><th className="py-2">Cantidad total</th><th className="py-2">Pedido / OP</th><th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id} className={`border-t border-[var(--os-border)] ${selectedRowClassName(Boolean(del.rowCheck?.checked.has(r.id)))}`}>
                    {del.rowCheck ? <td className="py-2"><SelectionCheckbox checked={del.rowCheck.checked.has(r.id)} onChange={() => del.rowCheck?.onToggle(r.id)} label={`Seleccionar ${r.remito || r.id}`} /></td> : null}
                    <td className="py-2">{formatDespachoFecha(r.fecha)}</td>
                    <td className="py-2">{r.remito || "—"}</td>
                    <td className="py-2">{r.cliente || "—"}</td>
                    <td className="py-2">{r.producto || "—"}</td>
                    <td className="py-2 tabular-nums">{r.bultos}</td>
                    <td className="py-2 tabular-nums">{r.cantidadTotal}</td>
                    <td className="py-2">{r.pedidoOp || "—"}</td>
                    <td className="py-2"><Button size="sm" variant="secondary" onClick={() => void openHistory(r)}>Historial</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ExcelOrList>
          <p className="mt-2 text-xs text-[var(--os-text-muted)]" data-testid="despachos-totals">
            {filtered.length} entrega(s) · {totals.bultos} bultos · {totals.cant} en total
          </p>
        </>
      )}

      {pedidos.length > 0 ? (
        <section className="mt-5" data-testid="despachos-pedidos">
          <h3 className="mb-1 text-sm font-semibold">Entregas parciales por pedido / OP</h3>
          <p className="mb-2 text-xs text-[var(--os-text-muted)]">Cada despacho se suma al pedido; ninguno reemplaza a otro.</p>
          <div className="space-y-2">
            {pedidos.map((p) => (
              <details key={p.pedidoOp} className="rounded border border-[var(--os-border)] px-3 py-2 text-sm">
                <summary className="cursor-pointer">
                  <strong>{p.pedidoOp}</strong> · {p.entregas.length} entrega(s) · {p.bultos} bultos · {p.cantidadTotal} en total
                </summary>
                <ul className="mt-1 space-y-0.5 text-xs">
                  {p.entregas.map((e) => (
                    <li key={e.id}>{formatDespachoFecha(e.fecha)} · remito {e.remito || "—"} · {e.producto || "—"} · {e.bultos} bultos · {e.cantidadTotal}</li>
                  ))}
                </ul>
              </details>
            ))}
          </div>
        </section>
      ) : null}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Agregar entrega</DialogTitle></DialogHeader>
          <div className="grid gap-2 text-sm">
            {(
              [
                ["fecha", "Fecha", "date"],
                ["remito", "N.º de remito", "text"],
                ["cliente", "Cliente", "text"],
                ["producto", "Producto", "text"],
                ["bultos", "Bultos", "text"],
                ["cantidadTotal", "Cantidad total", "text"],
                ["pedidoOp", "Pedido / OP (opcional)", "text"],
              ] as const
            ).map(([key, label, type]) => (
              <label key={key} className="block">
                {label}
                <input className="mt-1 w-full rounded border px-3 py-2" type={type} inputMode={key === "bultos" || key === "cantidadTotal" ? "decimal" : undefined} value={form[key]} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))} data-testid={`despachos-form-${key}`} />
              </label>
            ))}
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setCreateOpen(false)} disabled={busy}>Cancelar</Button>
            <Button onClick={() => void submitCreate()} disabled={busy} data-testid="despachos-save">Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ExcelPasteDialog
        open={pasteOpen}
        onOpenChange={setPasteOpen}
        fields={[
          { key: "fecha", label: "FECHA" },
          { key: "remito", label: "N.º DE REMITO" },
          { key: "cliente", label: "CLIENTE" },
          { key: "producto", label: "PRODUCTO" },
          { key: "bultos", label: "BULTOS" },
          { key: "cantidadTotal", label: "CANTIDAD TOTAL" },
          { key: "pedidoOp", label: "PEDIDO / OP" },
        ]}
        fieldAliases={DESPACHO_PASTE_ALIASES}
        onToast={(m) => showToast(m)}
        onConfirm={async (mappedRows) => {
          const key = (pasteKey.current ??= mintKey());
          const records = mappedRows.map((m) => ({
            fecha: parseFlexibleDate(m.fecha ?? "") ?? "",
            remito: m.remito ?? "",
            cliente: m.cliente ?? "",
            producto: m.producto ?? "",
            bultos: validateDespachoValue("bultos", m.bultos ?? "").ok ? Number((validateDespachoValue("bultos", m.bultos ?? "") as { value: number }).value) : NaN,
            cantidadTotal: validateDespachoValue("cantidadTotal", m.cantidadTotal ?? "").ok ? Number((validateDespachoValue("cantidadTotal", m.cantidadTotal ?? "") as { value: number }).value) : NaN,
            pedidoOp: m.pedidoOp ?? "",
          }));
          const results = await createDespachosApi(session, records, key);
          pasteKey.current = null;
          const ok = results.filter((r) => r.ok && r.created).length;
          const dup = results.filter((r) => r.ok && !r.created).length;
          const bad = results.filter((r) => !r.ok).length;
          showToast(`${ok} entrega(s) importada(s)${dup ? ` · ${dup} ya existían` : ""}${bad ? ` · ${bad} con errores (fecha o números inválidos)` : ""}`);
          await refresh();
        }}
      />

      <Dialog open={Boolean(historyFor)} onOpenChange={(o) => !o && setHistoryFor(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Historial de la entrega</DialogTitle></DialogHeader>
          {historyFor ? (
            <p className="text-xs text-[var(--os-text-muted)]">
              Creada por {historyFor.createdBy} el {new Date(historyFor.createdAt).toLocaleString("es-AR")}
              {historyFor.updatedBy ? ` · Última modificación: ${historyFor.updatedBy}, ${new Date(historyFor.updatedAt).toLocaleString("es-AR")}` : ""}
            </p>
          ) : null}
          {history === null ? (
            <p className="text-sm">Cargando…</p>
          ) : history.length === 0 ? (
            <p className="text-sm">Sin movimientos registrados.</p>
          ) : (
            <ul className="max-h-72 space-y-1 overflow-auto text-xs" data-testid="despachos-history">
              {history.map((h) => (
                <li key={h.id} className="rounded border border-[var(--os-border)] px-2 py-1">
                  {new Date(h.createdAt).toLocaleString("es-AR")} · {h.actorName} ·{" "}
                  {h.action === "create" ? "alta" : h.action === "delete" ? "eliminación" : `${FIELD_LABEL[h.field ?? ""] ?? h.field}: «${h.beforeValue ?? ""}» → «${h.afterValue ?? ""}»`}
                </li>
              ))}
            </ul>
          )}
          <DialogFooter><Button variant="secondary" onClick={() => setHistoryFor(null)}>Cerrar</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </TwinShell>
  );
}
