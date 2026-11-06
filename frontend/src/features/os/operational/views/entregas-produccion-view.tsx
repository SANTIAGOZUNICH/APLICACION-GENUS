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
  DESPACHO_GRID_KIND,
  despachoCellProtection,
  despachoTotal,
  formatDespachoFecha,
  isDespachoCellField,
  nextEgreso,
  validateDespachoValue,
  type DespachoCellField,
} from "@/lib/despachos/cell-edit";
import { bulkDeleteDespachosApi, createDespachosApi, fetchDespachosApi, patchDespachoCellsApi } from "@/lib/despachos/despachos-client";
import { parseBoolCell } from "@/lib/despachos/cell-edit";
import { DESPACHO_EXPORT_HEADERS, despachosToRows, filterDespachos, resumenPorPedido, type DespachoEstadoFilter, type DespachoFilters } from "@/lib/despachos/despachos-view-model";
import { canMutateDespachos } from "@/lib/despachos/despachos-rbac";
import type { CreateDespachoInput, DespachoRecord } from "@/lib/despachos/types";

const fmtInt = (n: number) => new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 }).format(n);
const fmtWhen = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso)) : "";

export const DESPACHOS_SORT_OPTIONS: SortOption<DespachoRecord>[] = [
  { key: "fecha_desc", label: "Fecha: más recientes", compare: (a, b) => compareDates(a.fecha, b.fecha, "desc") },
  { key: "fecha_asc", label: "Fecha: más antiguas", compare: (a, b) => compareDates(a.fecha, b.fecha, "asc") },
  { key: "egreso_asc", label: "Egreso N° (B001…)", compare: (a, b) => compareStrings(a.egreso, b.egreso, "asc") || compareDates(a.fecha, b.fecha, "asc") },
  { key: "egreso_desc", label: "Egreso N° (último primero)", compare: (a, b) => compareStrings(b.egreso, a.egreso, "asc") },
  { key: "cliente_asc", label: "Cliente A-Z", compare: (a, b) => compareStrings(a.cliente, b.cliente, "asc") },
  { key: "remito_asc", label: "Remito N°", compare: (a, b) => compareStrings(a.remito, b.remito, "asc") },
  { key: "producto_asc", label: "Descripción A-Z", compare: (a, b) => compareStrings(a.producto, b.producto, "asc") },
  { key: "total_desc", label: "Total mayor a menor", compare: (a, b) => compareNumbers(a.cantidadTotal, b.cantidadTotal, "desc") },
];
const SORT_KEYS = DESPACHOS_SORT_OPTIONS.map((o) => o.key);

/** Columnas editables de la planilla, en orden (TOTAL se calcula y va entre CANTIDAD y CONTROL). */
export const DESPACHO_SHEET_KEYS = ["fecha", "egreso", "cliente", "remito", "producto", "bultos", "cantidad", "control", "entregado", "comentarios"] as const satisfies readonly DespachoCellField[];
const SHEET_TITLES = ["FECHA", "EGRESO N°", "CLIENTE", "REMITO N°", "DESCRIPCIÓN", "BULTOS", "CANTIDAD", "TOTAL", "CONTROL", "ENTREGADO", "COMENTARIOS"] as const;

/** TOTAL que se ve en la planilla: BULTOS × CANTIDAD; con CANTIDAD pendiente se muestra el total anterior (datos previos) o nada si no hay dato. */
export const totalText = (r: Pick<DespachoRecord, "bultos" | "cantidad" | "cantidadTotal">): string =>
  r.cantidad == null ? (r.cantidadTotal > 0 ? String(r.cantidadTotal) : "") : String(despachoTotal(r.bultos, r.cantidad, r.cantidadTotal));

/** Valores de una fila nueva de la planilla (texto tal cual se escribió/pegó) → alta. Los números/fecha inválidos se informan, no se descartan en silencio. */
export function draftToCreateInput(draftId: string, v: Record<string, string>): { ok: true; input: CreateDespachoInput } | { ok: false; message: string } {
  const fecha = validateDespachoValue("fecha", v.fecha ?? "");
  if (!fecha.ok) return { ok: false, message: `Fecha: ${fecha.message}` };
  const bultos = validateDespachoValue("bultos", v.bultos ?? "");
  if (!bultos.ok) return { ok: false, message: `Bultos: ${bultos.message}` };
  const cant = validateDespachoValue("cantidad", v.cantidad ?? "");
  if (!cant.ok) return { ok: false, message: `Cantidad: ${cant.message}` };
  const control = parseBoolCell(v.control ?? "");
  const entregado = parseBoolCell(v.entregado ?? "");
  if (control === null) return { ok: false, message: "Control: usá TRUE/FALSE." };
  if (entregado === null) return { ok: false, message: "Entregado: usá TRUE/FALSE." };
  return {
    ok: true,
    input: {
      fecha: String(fecha.value),
      egreso: (v.egreso ?? "").trim().toUpperCase(),
      remito: (v.remito ?? "").trim(), // texto: conserva ceros iniciales
      cliente: (v.cliente ?? "").trim(),
      producto: (v.producto ?? "").trim(),
      bultos: Number(bultos.value),
      cantidad: cant.value === "" ? null : Number(cant.value),
      comentarios: (v.comentarios ?? "").trim(),
      control,
      entregado,
      idempotencyKey: `despacho-${draftId}`, // mismo id de fila nueva => reintento / doble pegado NO duplica
    },
  };
}

const isBlankDraft = (v: Record<string, string>) => DESPACHO_SHEET_KEYS.every((k) => !(v[k] ?? "").trim());

/**
 * Depósito → Entregas Producción: idéntica a la hoja «SALIDAS PROD. T 2026» (FECHA | EGRESO N° | CLIENTE | REMITO N° | DESCRIPCIÓN | BULTOS |
 * CANTIDAD | TOTAL | CONTROL | ENTREGADO | COMENTARIOS). Misma grilla que Ingresos/Salidas ME y Graneles: se escribe, pega y borra directo en las
 * celdas, con filas en blanco al final y guardado automático. Una fila = un producto; un EGRESO puede tener varias filas. TOTAL = BULTOS × CANTIDAD.
 * Operativo: no mueve stock ni MP, no emite ni modifica remitos y no se genera desde la entrega de Envasado a Producción.
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
            computed: {
              total: (v) => {
                const b = validateDespachoValue("bultos", v.bultos ?? "");
                const c = validateDespachoValue("cantidad", v.cantidad ?? "");
                return b.ok && c.ok && c.value !== "" ? String(Number(b.value) * Number(c.value)) : ""; // incompleto: no se inventa un total
              },
            },
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
  const totals = useMemo(() => ({ bultos: filtered.reduce((s, r) => s + r.bultos, 0), cant: filtered.reduce((s, r) => s + r.cantidadTotal, 0), egresos: new Set(filtered.map((r) => r.egreso).filter(Boolean)).size, sinControl: filtered.filter((r) => !r.control).length, sinEntregar: filtered.filter((r) => !r.entregado).length }), [filtered]);

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
    kind: DESPACHO_GRID_KIND[field],
    protection: (r: DespachoRecord) => despachoCellProtection(r, field, canEdit),
    validate: (raw: string) => {
      const v = validateDespachoValue(field, raw);
      return v.ok ? null : v.message;
    },
  });

  // Altas desde botones (nuevo egreso / agregar fila al egreso / duplicar): mismo servicio y misma idempotencia que las filas escritas.
  const [rowBusy, setRowBusy] = useState(false);
  const addRows = useCallback(
    async (inputs: CreateDespachoInput[], okMessage: string) => {
      if (rowBusy || inputs.length === 0) return;
      setRowBusy(true);
      try {
        const results = await createDespachosApi(session, inputs, "");
        const failed = results.flatMap((r) => (r.ok ? [] : [r.message]));
        await refresh();
        showToast(failed.length ? `${okMessage} · ${failed.length} con error: ${failed[0]}` : okMessage, failed.length ? "info" : undefined);
      } catch (e) {
        showToast(e instanceof Error ? e.message : "No se pudo agregar la fila.", "info");
      } finally {
        setRowBusy(false);
      }
    },
    [rowBusy, session, refresh, showToast]
  );
  const newKey = () => `despacho-btn-${typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
  const today = () => new Date().toISOString().slice(0, 10);
  const newEgreso = () => {
    const egreso = nextEgreso(items.map((r) => r.egreso));
    void addRows([{ fecha: today(), egreso, idempotencyKey: newKey() }], `Egreso ${egreso} creado: completá cliente, remito y los productos.`);
  };
  const selected = useMemo(() => del.selectedIds.map((id) => itemsById.get(id)).filter((r): r is DespachoRecord => Boolean(r)), [del.selectedIds, itemsById]);
  /** Otra fila del MISMO egreso (fecha, egreso, cliente y remito heredados); producto y cantidades en blanco. */
  const addToEgreso = () => {
    const base = selected[selected.length - 1];
    if (!base) return;
    void addRows([{ fecha: base.fecha, egreso: base.egreso, cliente: base.cliente, remito: base.remito, idempotencyKey: newKey() }], `Fila agregada al egreso ${base.egreso || "(sin número)"}.`);
  };
  /** Copia exacta de las filas elegidas, pero SIN las casillas ni los comentarios: lo controlado/entregado de una fila no se hereda. */
  const duplicate = () => {
    if (selected.length === 0) return;
    void addRows(
      selected.map((r) => ({ fecha: r.fecha, egreso: r.egreso, cliente: r.cliente, remito: r.remito, producto: r.producto, bultos: r.bultos, cantidad: r.cantidad, cantidadTotal: r.cantidad == null ? r.cantidadTotal : undefined, idempotencyKey: newKey() })),
      `${selected.length} fila${selected.length === 1 ? "" : "s"} duplicada${selected.length === 1 ? "" : "s"} (sin control, entregado ni comentarios).`
    );
  };

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
            Planilla «SALIDAS PROD.» · una fila = un producto; un egreso puede tener varias filas · TOTAL = BULTOS × CANTIDAD · escribí o pegá directo desde Excel / Google Sheets · no modifica stock, materias primas ni remitos
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canEdit ? (
            <>
              <Button size="sm" onClick={newEgreso} disabled={rowBusy} data-testid="despachos-nuevo-egreso">+ Nuevo egreso ({nextEgreso(items.map((r) => r.egreso))})</Button>
              <Button size="sm" variant="secondary" onClick={addToEgreso} disabled={rowBusy || selected.length === 0} title="Seleccioná una fila (casilla de la izquierda): la nueva hereda fecha, egreso, cliente y remito" data-testid="despachos-fila-egreso">+ Fila al mismo egreso</Button>
              <Button size="sm" variant="secondary" onClick={duplicate} disabled={rowBusy || selected.length === 0} data-testid="despachos-duplicar">Duplicar fila{selected.length > 1 ? "s" : ""}</Button>
            </>
          ) : null}
          <Button variant="secondary" onClick={() => void exportXlsx()} disabled={filtered.length === 0} data-testid="despachos-export">Exportar Excel</Button>
        </div>
      </header>

      {!canEdit ? (
        <p className="mb-3 rounded border border-[var(--os-border)] px-3 py-2 text-sm text-[var(--os-text-muted)]">Solo consulta: las entregas las carga Depósito.</p>
      ) : null}
      {offline ? <p className="mb-3 rounded border border-red-500/40 px-3 py-2 text-sm">Sin conexión al servidor — reintentá recargar.</p> : null}

      <div className="mb-3 flex flex-wrap items-end gap-2" data-testid="despachos-filters">
        <input value={filters.q ?? ""} onChange={setF("q")} placeholder="Buscar cliente, producto, egreso o remito…" aria-label="Buscar" className={`${inputCls} min-w-[10rem] flex-1`} />
        <label className="text-xs">Desde<input type="date" value={filters.desde ?? ""} onChange={setF("desde")} className={`${inputCls} ml-1`} data-testid="despachos-f-desde" /></label>
        <label className="text-xs">Hasta<input type="date" value={filters.hasta ?? ""} onChange={setF("hasta")} className={`${inputCls} ml-1`} data-testid="despachos-f-hasta" /></label>
        <input value={filters.cliente ?? ""} onChange={setF("cliente")} placeholder="Cliente" aria-label="Filtrar por cliente" className={`${inputCls} w-32`} data-testid="despachos-f-cliente" />
        <input value={filters.producto ?? ""} onChange={setF("producto")} placeholder="Descripción" aria-label="Filtrar por descripción" className={`${inputCls} w-32`} data-testid="despachos-f-producto" />
        <input value={filters.egreso ?? ""} onChange={setF("egreso")} placeholder="Egreso N°" aria-label="Filtrar por egreso" className={`${inputCls} w-24`} data-testid="despachos-f-egreso" />
        <input value={filters.remito ?? ""} onChange={setF("remito")} placeholder="Remito N°" aria-label="Filtrar por remito" className={`${inputCls} w-28`} data-testid="despachos-f-remito" />
        <select value={filters.estado ?? ""} onChange={(e) => setFilters((f) => ({ ...f, estado: e.target.value as DespachoEstadoFilter }))} aria-label="Filtrar por estado" className={inputCls} data-testid="despachos-f-estado">
          <option value="">Todos los estados</option>
          <option value="sin_control">Sin controlar</option>
          <option value="controlado">Controlados</option>
          <option value="sin_entregar">Sin entregar</option>
          <option value="entregado">Entregados</option>
        </select>
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
              excelCol("fecha", SHEET_TITLES[0], (r: DespachoRecord) => formatDespachoFecha(r.fecha), { edit: edit("fecha"), minWidth: 104 }),
              excelCol("egreso", SHEET_TITLES[1], (r: DespachoRecord) => r.egreso, { edit: edit("egreso"), minWidth: 96 }),
              excelCol("cliente", SHEET_TITLES[2], (r: DespachoRecord) => r.cliente, { edit: edit("cliente"), minWidth: 130 }),
              excelCol("remito", SHEET_TITLES[3], (r: DespachoRecord) => r.remito, {
                edit: edit("remito"),
                minWidth: 104,
                cellNote: (r: DespachoRecord) => (r.remitoLink ? `Remito de GENUS OS ${r.remitoLink.number} (${r.remitoLink.status === "GENERADO" ? "emitido" : r.remitoLink.status.toLowerCase()}). Esta fila no lo modifica.` : null),
              }),
              excelCol("producto", SHEET_TITLES[4], (r: DespachoRecord) => r.producto, { edit: edit("producto"), minWidth: 190 }),
              excelCol("bultos", SHEET_TITLES[5], (r: DespachoRecord) => String(r.bultos), { edit: edit("bultos"), minWidth: 84 }),
              excelCol("cantidad", SHEET_TITLES[6], (r: DespachoRecord) => (r.cantidad == null ? "" : String(r.cantidad)), {
                edit: edit("cantidad"),
                minWidth: 92,
                cellNote: (r: DespachoRecord) => (r.cantidad == null && r.cantidadTotal > 0 ? "Dato anterior sin desglose: completá CANTIDAD (unidades por bulto) para que TOTAL = BULTOS × CANTIDAD." : null),
              }),
              excelCol("total", SHEET_TITLES[7], totalText, { readOnlyReason: "TOTAL = BULTOS × CANTIDAD: se calcula solo.", pasteSkip: true, minWidth: 88, className: "font-semibold tabular-nums" }),
              excelCol("control", SHEET_TITLES[8], (r: DespachoRecord) => (r.control ? "TRUE" : "FALSE"), {
                edit: edit("control"),
                minWidth: 88,
                cellNote: (r: DespachoRecord) => (r.controlBy ? `${r.control ? "Controlado" : "Control desmarcado"} por ${r.controlBy} el ${fmtWhen(r.controlAt)}` : null),
              }),
              excelCol("entregado", SHEET_TITLES[9], (r: DespachoRecord) => (r.entregado ? "TRUE" : "FALSE"), {
                edit: edit("entregado"),
                minWidth: 96,
                cellNote: (r: DespachoRecord) => (r.entregadoBy ? `${r.entregado ? "Entregado" : "Entrega desmarcada"} por ${r.entregadoBy} el ${fmtWhen(r.entregadoAt)}` : null),
              }),
              excelCol("comentarios", SHEET_TITLES[10], (r: DespachoRecord) => r.comentarios, { edit: edit("comentarios"), minWidth: 200 }),
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
            {filtered.length} fila(s) · {totals.egresos} egreso(s) · {fmtInt(totals.bultos)} bultos · <strong>{fmtInt(totals.cant)} unidades en total</strong> · {totals.sinControl} sin controlar · {totals.sinEntregar} sin entregar
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
                    <li key={e.id}>{formatDespachoFecha(e.fecha) || "sin fecha"} · remito {e.remito || "—"} · {e.egreso ? `egreso ${e.egreso} · ` : ""}{e.producto || "—"} · {e.bultos} bultos · {e.cantidadTotal}</li>
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
