"use client";

import { readOnlyReason } from "@/features/os/operational/lib/readonly-reasons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ClipboardPaste, History, Pencil, Plus, Trash2 } from "lucide-react";
import { MeHistoryDialog } from "@/features/os/operational/components/me-history-dialog";
import { useMeSheetEditing } from "@/features/os/operational/hooks/use-me-sheet-cells";
import { Button } from "@/components/ui/button";
import { TwinShell } from "@/features/os/shell/twin-shell";
import { LifecycleConfirmDialog } from "@/features/os/operational/components/lifecycle-confirm-dialog";
import { syntheticLifecycleItem } from "@/features/os/operational/components/lifecycle-synthetic";
import {
  fetchInventory,
  bulkDeleteInventory,
  mutateInventory,
  InventoryClientError,
} from "@/features/os/operational/adapters/inventory-client";
import { ExcelPasteDialog } from "@/features/os/operational/components/excel-paste-dialog";
import { OperationalTable, type OperationalTableColumn } from "@/features/os/operational/components/operational-ui";
import {
} from "../components/list-selection-mode";
import { displayCell, multiplyTotal, parseOptionalNumber } from "@/lib/inventory/calcs";
import { ME_INGRESO_COLUMNS, type MeIngresoRow } from "@/lib/inventory/types";
import { ME_INGRESO_DRAFT_CREATE_KEYS, ME_INGRESO_DRAFT_REQUIRED_KEYS, meIngresoPayloadFromDraft } from "@/lib/inventory/me-draft-rows";
import type { GenusGridDraftRows } from "@/components/data-grid/genus-grid";
import { canWriteInventory } from "@/lib/inventory/rbac";
import { validateMeSheetValue } from "@/lib/inventory/me-sheet-edit";
import { MeDiferenciaCell, MePedidoPicker, ingresoDifClass, ingresoDifText, ingresoPrevisto, previstoText, useIngresoDiferencias } from "@/features/os/operational/components/me-diferencia-cell";
import { IngresoRemitoFotosButton, useIngresoAdjuntoCounts } from "@/features/os/operational/components/ingreso-remito-fotos";
import { canManageAdjuntos, canViewAdjuntos } from "@/lib/inventory/ingreso-adjuntos-rules";
import { IngresoConRemitoButtons } from "@/features/os/operational/components/ingreso-con-remito";
import { usePreviewSession, usePreviewContext } from "@/features/os/session/preview-context";
import { SortSelect } from "@/features/os/operational/components/sort-select";
import { useDepositoDelete } from "@/features/os/operational/components/deposito-delete/use-deposito-delete";
import { useMeRowDelete, useSheetRowOps } from "@/features/os/operational/lib/use-sheet-row-ops";
import { useSortPreference } from "@/features/os/operational/lib/use-sort-preference";
import { applySort, compareDates, compareNumbers, compareStrings, type SortOption } from "@/lib/sorting/sort-contract";

/** Orden de la hoja (carga): la API trae las filas por `load_seq`; este comparador no reordena nada. Ordenar por una columna es voluntario. */
export const ME_ORDEN_HOJA_KEY = "orden_hoja";
export const ME_INGRESO_SORT_OPTIONS: SortOption<MeIngresoRow>[] = [
  { key: ME_ORDEN_HOJA_KEY, label: "Orden de la hoja (manual)", compare: () => 0 },
  { key: "fecha_desc", label: "Más recientes", compare: (a, b) => compareDates(a.fecha, b.fecha, "desc") },
  { key: "fecha_asc", label: "Más antiguos", compare: (a, b) => compareDates(a.fecha, b.fecha, "asc") },
  { key: "codigo_asc", label: "Código A-Z", compare: (a, b) => compareStrings(a.codigo, b.codigo, "asc") },
  { key: "proveedor_asc", label: "Proveedor A-Z", compare: (a, b) => compareStrings(a.proveedor, b.proveedor, "asc") },
  { key: "total_desc", label: "Total mayor a menor", compare: (a, b) => compareNumbers(a.total, b.total, "desc") },
  { key: "total_asc", label: "Total menor a mayor", compare: (a, b) => compareNumbers(a.total, b.total, "asc") },
];
const ME_INGRESO_SORT_KEYS = ME_INGRESO_SORT_OPTIONS.map((o) => o.key);

const ALIASES: Record<string, string[]> = {
  fecha: ["fecha"],
  ingresoNro: ["ingreso n", "ingreso nº", "ingreso nro", "ingreso"],
  proveedor: ["proveedor"],
  cliente: ["cliente"],
  remitoNro: ["remito", "remito n", "remito nº"],
  codigo: ["codigo", "código"],
  descripcionInsumo: ["descripcion", "descripción", "descripcion insumo", "descripción insumo"],
  bultos: ["bultos"],
  cantidad: ["cantidad"],
  total: ["total"],
  ubicacion: ["ubicacion", "ubicación"],
};

type FormState = {
  id?: string;
  fecha: string;
  ingresoNro: string;
  proveedor: string;
  cliente: string;
  remitoNro: string;
  codigo: string;
  descripcionInsumo: string;
  bultos: string;
  cantidad: string;
  ubicacion: string;
};

function emptyForm(): FormState {
  return {
    fecha: new Date().toISOString().slice(0, 10),
    ingresoNro: "",
    proveedor: "",
    cliente: "",
    remitoNro: "",
    codigo: "",
    descripcionInsumo: "",
    bultos: "",
    cantidad: "",
    ubicacion: "",
  };
}

/** Columna de la planilla → campo del ingreso (TOTAL corrige la cantidad por bulto: total ÷ bultos). */
const ME_INGRESO_SHEET_FIELD_OF: Record<string, string> = {
  FECHA: "fecha", "INGRESO Nº": "ingresoNro", PROVEEDOR: "proveedor", CLIENTE: "cliente", PRODUCTO: "producto", "REMITO Nº": "remitoNro", CÓDIGO: "codigo",
  "DESCRIPCIÓN INSUMO": "descripcionInsumo", BULTOS: "bultos", CANTIDAD: "cantidad", TOTAL: "total", UBICACIÓN: "ubicacion",
};

export function MeIngresosView() {
  const { sectorId, email } = usePreviewSession();
  const { showToast } = usePreviewContext();
  const canWrite = canWriteInventory(sectorId, "me_ingresos");
  // Fotos del remito por ingreso (tabla aparte: editar el ingreso no las pierde).
  const fotos = useIngresoAdjuntoCounts("ME", canViewAdjuntos(sectorId, "ME"));
  const canManageFotos = canManageAdjuntos(sectorId, "ME");
  const [rows, setRows] = useState<MeIngresoRow[]>([]);
  const dif = useIngresoDiferencias();
  const difRef = useRef(dif);
  difRef.current = dif;
  const [persistence, setPersistence] = useState(true);
  const [banner, setBanner] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState<FormState | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; label: string } | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);

  const reload = useCallback(async () => {
    const res = await fetchInventory<MeIngresoRow>("me_ingresos");
    setRows(res.data);
    setPersistence(res.persistence);
    setBanner(res.message ?? null);
    void dif.reload();
  }, []);
  const [historyFor, setHistoryFor] = useState<{ id: string; label: string } | null>(null);
  const sheet = useMeSheetEditing<MeIngresoRow>("me_ingresos", sectorId, canWrite, ME_INGRESO_SHEET_FIELD_OF, reload);
  // Filas en blanco al final de la planilla: se escribe directo y el ingreso se registra al completarse (suma al stock del código).
  const draftRows = useMemo<GenusGridDraftRows | undefined>(
    () =>
      canWrite
        ? {
            createKeys: ME_INGRESO_DRAFT_CREATE_KEYS,
            requiredKeys: ME_INGRESO_DRAFT_REQUIRED_KEYS,
            storageKey: `genus-draft:${email ?? "anon"}:me-ingresos`,
            // Fila nueva sin confirmar: diferencia PREVISTA = acumulado del pedido + este ingreso (no cuenta hasta registrarse).
            computed: {
              DIFERENCIA: (v) => {
                // Se calcula con lo escrito aunque falten datos del ingreso (p. ej. la fecha): no hace falta que esté completo.
                const num = (field: "cantidad" | "bultos" | "total", col: string) => {
                  const r = validateMeSheetValue("me_ingresos", field, v[col] ?? "");
                  return r.ok && typeof r.value === "number" ? r.value : null;
                };
                const cantidad = num("cantidad", "CANTIDAD");
                const bultos = v.BULTOS?.trim() ? num("bultos", "BULTOS") : 1;
                const total = v.TOTAL?.trim() ? num("total", "TOTAL") : cantidad != null && bultos != null ? cantidad * bultos : null;
                const codigo = (v["CÓDIGO"] ?? "").trim();
                const ctx = difRef.current.data.previsto;
                if (!codigo || !ctx || !total || !(total > 0)) return "";
                return previstoText(ingresoPrevisto(ctx, { codigo, cliente: (v.CLIENTE ?? "").trim(), producto: (v.PRODUCTO ?? "").trim(), total }));
              },
            },
            validate: (v) => {
              const r = meIngresoPayloadFromDraft("validate", v);
              return r.ok ? null : r.message;
            },
            onCreate: async (id, v) => {
              const r = meIngresoPayloadFromDraft(id, v);
              if (!r.ok) return { ok: false, message: r.message };
              try {
                await mutateInventory({ action: "upsert", resource: "me_ingresos", payload: r.payload });
                await reload();
                return { ok: true, message: "Ingreso registrado: ya suma al stock del material." };
              } catch (e) {
                return { ok: false, message: e instanceof InventoryClientError ? e.message : "No se pudo registrar el ingreso." };
              }
            },
          }
        : undefined,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canWrite, email]
  );

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      void (async () => {
        try {
          const res = await fetchInventory<MeIngresoRow>("me_ingresos");
          if (cancelled) return;
          setRows(res.data);
          setPersistence(res.persistence);
          setBanner(res.message ?? null);
        } catch (e) {
          if (!cancelled) setBanner(e instanceof Error ? e.message : "Error");
        }
      })();
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const [sort, setSort] = useSortPreference("me-ingresos-v2", "orden_hoja", ME_INGRESO_SORT_KEYS);
  const rowOps = useSheetRowOps("me_ingresos", reload, sort === "orden_hoja", canWrite);
  const rowDelete = useMeRowDelete("me_ingresos", reload, canWrite);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = rows.filter((r) => {
      if (r.anulado) return false;
      if (!q) return true;
      return [r.ingresoNro, r.proveedor, r.cliente, r.remitoNro, r.codigo, r.descripcionInsumo]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
    return applySort(base, ME_INGRESO_SORT_OPTIONS, sort);
  }, [rows, search, sort]);

  const visibleIds = useMemo(() => filtered.map((r) => r.id), [filtered]);
  const del = useDepositoDelete({
    canWrite,
    visibleIds,
    tableCount: rows.filter((r) => !r.anulado).length,
    noun: "ingresos",
    deleteIds: (ids) => bulkDeleteInventory("me_ingresos", { ids }),
    deleteAll: () => bulkDeleteInventory("me_ingresos", { all: true }),
    afterDelete: reload,
    onMessage: (m) => showToast(m),
    historyResource: "me_ingresos",
  });

  const ME_INGRESO_PRIMARY = new Set(["CÓDIGO", "DESCRIPCIÓN INSUMO", "PRODUCTO"]);
  const columns: OperationalTableColumn<MeIngresoRow>[] = ME_INGRESO_COLUMNS.map((label) => {
    const keyMap: Record<string, keyof MeIngresoRow> = {
      FECHA: "fecha",
      "INGRESO Nº": "ingresoNro",
      PROVEEDOR: "proveedor",
      CLIENTE: "cliente",
      PRODUCTO: "producto",
      "REMITO Nº": "remitoNro",
      CÓDIGO: "codigo",
      "DESCRIPCIÓN INSUMO": "descripcionInsumo",
      BULTOS: "bultos",
      CANTIDAD: "cantidad",
      TOTAL: "total",
      UBICACIÓN: "ubicacion",
    };
    const key = keyMap[label];
    return {
      key: label,
      header: label,
      hideOnMobile: ME_INGRESO_PRIMARY.has(label) ? false : ("xl" as const),
      render: (row) => displayCell(row[key]),
      text: (row) => (row[key] == null ? "" : String(row[key])),
      // Planilla editable (Depósito): todas las columnas se corrigen en la celda (TOTAL corrige la cantidad por bulto).
      edit: sheet.edit(label),
      readOnlyReason: readOnlyReason("me_ingresos", label),
    };
  });

  // DIFERENCIA = total acumulado ingresado para ese pedido y material − lo que pide el pedido. NO usa el saldo de Stock ME.
  columns.push({
    key: "DIFERENCIA",
    header: "DIFERENCIA",
    minWidth: 168,
    hideOnMobile: false,
    text: (row) => (row.anulado ? "" : ingresoDifText(dif.data.ingresos[row.id])),
    cellClassName: (row) => (row.anulado ? undefined : ingresoDifClass(dif.data.ingresos[row.id])),
    render: (row) => (row.anulado ? "—" : <MeDiferenciaCell row={dif.data.ingresos[row.id]} />),
  } as OperationalTableColumn<MeIngresoRow>);
  // Junto a la cantidad (después de TOTAL): al final de la fila quedaba fuera de pantalla en tablet.
  columns.splice(columns.findIndex((c) => c.key === "TOTAL") + 1, 0, columns.pop()!);

  async function saveForm() {
    if (!form || !canWrite) return;
    if (!form.codigo.trim()) {
      setBanner("El código es obligatorio. Cada producto se identifica solo por su código.");
      return;
    }
    try {
      const saved = await mutateInventory<{
        stockSummary?: {
          codigo: string;
          ingresoRegistrado: number;
          consumoAcumulado: number;
          stockActual: number;
          negativo: boolean;
          ingresoTardio: boolean;
        };
      }>({
        action: "upsert",
        resource: "me_ingresos",
        payload: {
          id: form.id,
          fecha: form.fecha,
          ingresoNro: form.ingresoNro,
          proveedor: form.proveedor,
          cliente: form.cliente,
          remitoNro: form.remitoNro,
          codigo: form.codigo,
          descripcionInsumo: form.descripcionInsumo,
          bultos: parseOptionalNumber(form.bultos),
          cantidad: parseOptionalNumber(form.cantidad),
          ubicacion: form.ubicacion,
        },
      });
      setForm(null);
      await reload();
      const s = saved.data?.stockSummary;
      if (s) {
        const fmt = (n: number) => n.toLocaleString("es-AR");
        const lines = [`INGRESO REGISTRADO +${fmt(s.ingresoRegistrado)} un.`];
        if (s.consumoAcumulado > 0) {
          lines.push(
            `${s.negativo ? "Consumo acumulado" : "Consumo registrado previamente"}: -${fmt(s.consumoAcumulado)} un.`
          );
        }
        lines.push(
          s.negativo
            ? `🔴 STOCK ACTUAL: ${fmt(s.stockActual)} un. Revisar movimientos pendientes de carga.`
            : `Stock actual: ${fmt(s.stockActual)} un.`
        );
        setBanner(lines.join(" · "));
      }
    } catch (e) {
      setBanner(e instanceof InventoryClientError ? e.message : "No se pudo guardar");
    }
  }

  const liveTotal = form
    ? multiplyTotal(parseOptionalNumber(form.bultos), parseOptionalNumber(form.cantidad))
    : null;

  return (
    <TwinShell title="INGRESOS DE MATERIAL DE EMPAQUE">
      {banner && (
        <div className="mb-4 rounded border border-[var(--genus-warning)]/30 bg-[var(--genus-warning-soft)] px-3 py-2 text-sm text-[var(--genus-warning)]">
          {banner}
          {!persistence && " · Tablas vacías; sin simulación de persistencia."}
        </div>
      )}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <IngresoConRemitoButtons module="ME" canWrite={canWrite} onChanged={() => { void reload(); fotos.reload(); }} />
        {canWrite && (
          <>
            <Button type="button" variant="secondary" onClick={() => setForm(emptyForm())}>
              <Plus className="mr-1 size-4" /> Nuevo ingreso
            </Button>
            <Button type="button" variant="secondary" onClick={() => setPasteOpen(true)}>
              <ClipboardPaste className="mr-1 size-4" /> Pegar desde Excel
            </Button>
          </>
        )}
        <input
          className="rounded border border-[var(--os-border)] px-3 py-1.5 text-sm"
          placeholder="Buscar…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
          }}
        />
        <SortSelect
          value={sort}
          onChange={(key) => {
            setSort(key);
          }}
          options={ME_INGRESO_SORT_OPTIONS}
          testId="me-ingresos-sort"
        />
      </div>

      {del.bar}

      <OperationalTable
        columns={[
          ...columns,
          {
            key: "remitoFotos",
            header: "Remito",
            // En la planilla va junto a las acciones de la fila (siempre visible, también en celular).
            action: true,
            render: (row: MeIngresoRow) => (
              <IngresoRemitoFotosButton
                module="ME"
                ingresoId={row.id}
                label={`Ingreso ${row.ingresoNro || "s/n"} · Remito ${row.remitoNro || "s/n"} · ${row.proveedor || row.descripcionInsumo || ""}`}
                canManage={canManageFotos && !row.anulado}
                onChanged={fotos.reload}
              />
            ),
          },
          ...(canWrite
            ? [
                {
                  key: "acciones",
                  header: "",
                  render: (row: MeIngresoRow) => (
                    <div className="flex flex-wrap gap-1">
                      {!row.anulado && (
                        <>
                      <MePedidoPicker ingresoId={row.id} row={dif.data.ingresos[row.id]} onChanged={() => void dif.reload()} />
                      <button
                        type="button"
                        aria-label="Editar"
                        className="inline-flex size-8 items-center justify-center"
                        onClick={() =>
                          setForm({
                            id: row.id,
                            fecha: row.fecha,
                            ingresoNro: row.ingresoNro,
                            proveedor: row.proveedor,
                            cliente: row.cliente,
                            remitoNro: row.remitoNro,
                            codigo: row.codigo,
                            descripcionInsumo: row.descripcionInsumo,
                            bultos: row.bultos == null ? "" : String(row.bultos),
                            cantidad: row.cantidad == null ? "" : String(row.cantidad),
                            ubicacion: row.ubicacion,
                          })
                        }
                      >
                        <Pencil className="size-4" />
                      </button>
                      <button
                        type="button"
                        aria-label="Duplicar"
                        onClick={() =>
                          setForm({
                            ...emptyForm(),
                            fecha: row.fecha,
                            ingresoNro: row.ingresoNro,
                            proveedor: row.proveedor,
                            cliente: row.cliente,
                            remitoNro: row.remitoNro,
                            codigo: row.codigo,
                            descripcionInsumo: row.descripcionInsumo,
                            bultos: row.bultos == null ? "" : String(row.bultos),
                            cantidad: row.cantidad == null ? "" : String(row.cantidad),
                            ubicacion: row.ubicacion,
                          })
                        }
                      >
                        <Plus className="size-4" />
                      </button>
                      <button type="button" aria-label="Historial" title="Historial de cambios" onClick={() => setHistoryFor({ id: row.id, label: `Ingreso ${row.ingresoNro} · ${row.codigo}` })} data-testid="me-history-open">
                        <History className="size-4" />
                      </button>
                      <button
                        type="button"
                        aria-label="Eliminar"
                        title="Eliminar"
                        onClick={() =>
                          setPendingDelete({
                            id: row.id,
                            label: row.descripcionInsumo || row.codigo || row.id,
                          })
                        }
                      >
                        <Trash2 className="size-4 text-red-700" />
                      </button>
                        </>
                      )}
                    </div>
                  ),
                } as OperationalTableColumn<MeIngresoRow>,
              ]
            : []),
        ]}
        rows={filtered}
        continuous
        draftRows={draftRows}
        rowOps={rowOps}
        rowDelete={rowDelete}
        rowKey={(r) => r.id}
        tableId="me-ingresos"
        canEditCells={sheet.canEditCells}
        onCellsCommit={sheet.onCellsCommit}
        rowVersion={sheet.rowVersion}
        emptyMessage="Sin ingresos ME. Las tablas comienzan vacías (sin datos históricos)."
        rowCheck={del.rowCheck}
      />

      {form && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded bg-[var(--os-surface)] p-5 shadow">
            <h3 className="mb-3 text-lg font-semibold">
              {form.id ? "Editar ingreso ME" : "Nuevo ingreso ME"}
            </h3>
            <p className="mb-3 text-xs text-[var(--os-text-muted)]">
              Se permiten borradores incompletos. TOTAL = BULTOS × CANTIDAD (solo lectura).
            </p>
            <div className="grid grid-cols-2 gap-3 text-sm">
              {(
                [
                  ["fecha", "FECHA"],
                  ["ingresoNro", "INGRESO Nº"],
                  ["proveedor", "PROVEEDOR"],
                  ["cliente", "CLIENTE"],
                  ["remitoNro", "REMITO Nº"],
                  ["codigo", "CÓDIGO"],
                  ["descripcionInsumo", "DESCRIPCIÓN INSUMO"],
                  ["bultos", "BULTOS"],
                  ["cantidad", "CANTIDAD"],
                  ["ubicacion", "UBICACIÓN"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="flex flex-col gap-1">
                  <span>{label}</span>
                  <input
                    className="rounded border border-[var(--os-border)] px-2 py-1"
                    value={form[key]}
                    onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                  />
                </label>
              ))}
              <label className="flex flex-col gap-1">
                <span>TOTAL (auto)</span>
                <input
                  className="rounded border border-[var(--os-border)] bg-[var(--os-bg)] px-2 py-1"
                  readOnly
                  value={liveTotal == null ? "" : String(liveTotal)}
                />
              </label>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setForm(null)}>
                Cancelar
              </Button>
              <Button type="button" onClick={() => void saveForm()}>
                Guardar
              </Button>
            </div>
          </div>
        </div>
      )}

      <LifecycleConfirmDialog
        pending={
          pendingDelete
            ? syntheticLifecycleItem(
                "eliminar",
                "Eliminar ingreso ME",
                "Se revertirá el impacto en stock y el registro dejará de mostrarse en la lista activa."
              )
            : null
        }
        entityLabel={pendingDelete?.label}
        onClose={() => setPendingDelete(null)}
        onConfirm={async (reason) => {
          if (!pendingDelete) return;
          const id = pendingDelete.id;
          await mutateInventory({
            action: "delete",
            resource: "me_ingresos",
            id,
            reason,
          });
          setRows((prev) => prev.filter((row) => row.id !== id));
          await reload();
        }}
      />

      <ExcelPasteDialog
        open={pasteOpen}
        onOpenChange={setPasteOpen}
        fields={[
          { key: "fecha", label: "FECHA" },
          { key: "ingresoNro", label: "INGRESO Nº" },
          { key: "proveedor", label: "PROVEEDOR" },
          { key: "cliente", label: "CLIENTE" },
          { key: "remitoNro", label: "REMITO Nº" },
          { key: "codigo", label: "CÓDIGO" },
          { key: "descripcionInsumo", label: "DESCRIPCIÓN INSUMO" },
          { key: "bultos", label: "BULTOS" },
          { key: "cantidad", label: "CANTIDAD" },
          { key: "total", label: "TOTAL", calculated: true },
          { key: "ubicacion", label: "UBICACIÓN" },
        ]}
        fieldAliases={ALIASES}
        ignoreKeys={["total"]}
        onToast={(message) => showToast(message)}
        onConfirm={async (mappedRows) => {
          let ok = 0;
          let skipped = 0;
          for (const m of mappedRows) {
            if (!(m.codigo ?? "").trim()) {
              skipped += 1;
              continue;
            }
            await mutateInventory({
              action: "upsert",
              resource: "me_ingresos",
              payload: {
                fecha: m.fecha ?? "",
                ingresoNro: m.ingresoNro ?? "",
                proveedor: m.proveedor ?? "",
                cliente: m.cliente ?? "",
                remitoNro: m.remitoNro ?? "",
                codigo: m.codigo ?? "",
                descripcionInsumo: m.descripcionInsumo ?? "",
                bultos: parseOptionalNumber(m.bultos),
                cantidad: parseOptionalNumber(m.cantidad),
                ubicacion: m.ubicacion ?? "",
              },
            });
            ok += 1;
          }
          if (skipped) {
            showToast(
              `${ok} importado(s) · ${skipped} omitido(s) sin código (el código es obligatorio)`
            );
          }
          await reload();
        }}
      />
      <MeHistoryDialog target={historyFor} onClose={() => setHistoryFor(null)} />
    </TwinShell>
  );
}
