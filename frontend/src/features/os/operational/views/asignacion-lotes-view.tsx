"use client";

import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import { ClipboardPaste, Download, Pencil, Plus, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ExcelImportPreviewDialog,
  type ExcelImportFieldDef,
} from "../components/excel-import-preview-dialog";
import { LifecycleConfirmDialog } from "../components/lifecycle-confirm-dialog";
import { syntheticLifecycleItem } from "../components/lifecycle-synthetic";
import {
  bulkDeleteConfirmMessage,
  ListSelectionEnterButton,
  ListSelectionToolbar,
  useListSelectionMode,
} from "../components/list-selection-mode";
import { usePreviewSession } from "@/features/os/session/preview-context";
import { TwinShell } from "@/features/os/shell/twin-shell";
import { useRequiredWorkspace } from "@/features/os/workspace/workspace-provider";
import {
  deleteAsignacionLoteApi,
  fetchAsignacionLotesApi,
  importAsignacionLotesApi,
  upsertAsignacionLoteApi,
} from "@/lib/asignacion-lotes/asignacion-lotes-client";
import { OperationalTable, type OperationalTableColumn } from "../components/operational-ui";
import { SortSelect } from "../components/sort-select";
import { useSortPreference } from "../lib/use-sort-preference";
import {
  applySort,
  compareDates,
  compareNumbers,
  compareStrings,
  compareVtoNearest,
  type SortOption,
} from "@/lib/sorting/sort-contract";
import {
  findDuplicateAsignacionLote,
  getAllAsignacionLotes,
  replaceAsignacionLotesCache,
  type AsignacionLote,
  type AsignacionLoteUpsertInput,
} from "../adapters/asignacion-lotes-repository";
import {
  ASIGNACION_LOTES_FIELD_ALIASES,
  buildAsignacionLoteFromMappedRow,
  formatAsignacionCodigoPreview,
  validateAsignacionLoteRow,
  type AsignacionLoteMappedRow,
} from "../lib/asignacion-lotes-import";
import {
  filterAsignacionLotesBySearch,
  normalizeAsignacionSearchText,
} from "../lib/asignacion-lotes-search";
import { parseNonNegativeNumber } from "../lib/clipboard-import";
import { formatDateDisplay, parseFlexibleDate } from "../lib/delivery-date";
import {
  canAccessAsignacionLotes,
  canMutateAsignacionLotes,
} from "../lib/asignacion-lotes-rbac";

const PAGE_SIZE = 20;

const IMPORT_FIELDS: ExcelImportFieldDef[] = [
  { key: "lote", label: "Lote", required: true, mobilePrimary: true },
  { key: "fecha", label: "Fecha", required: true },
  { key: "producto", label: "Producto", required: true, mobilePrimary: true },
  {
    key: "codigo",
    label: "Código",
    mobilePrimary: true,
    formatDisplay: (value) => formatAsignacionCodigoPreview(value),
  },
  { key: "marca", label: "Marca" },
  { key: "cantidades", label: "Cantidades", required: true, mobilePrimary: true },
  { key: "vto", label: "VTO" },
  { key: "muestras", label: "Muestras" },
  { key: "cjMuestra", label: "CJ muestra" },
  { key: "fechaAnalisis", label: "Fecha análisis" },
  { key: "observaciones", label: "Observaciones" },
  { key: "cliente", label: "Cliente" },
];

type DateField = "fecha" | "vto" | "fechaAnalisis";

type AsignacionFormState = {
  lote: string;
  fecha: string;
  producto: string;
  codigo: string;
  marca: string;
  cantidades: string;
  vto: string;
  muestras: string;
  cjMuestra: string;
  fechaAnalisis: string;
  observaciones: string;
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function emptyForm(): AsignacionFormState {
  return {
    lote: "",
    fecha: today(),
    producto: "",
    codigo: "",
    marca: "",
    cantidades: "",
    vto: "",
    muestras: "",
    cjMuestra: "",
    fechaAnalisis: "",
    observaciones: "",
  };
}

function formFromAsignacion(item: AsignacionLote): AsignacionFormState {
  return {
    lote: item.lote,
    fecha: item.fecha ?? "",
    producto: item.producto,
    codigo: item.codigo,
    marca: item.marca,
    cantidades: String(item.cantidades),
    vto: item.vto ?? "",
    muestras: item.muestras,
    cjMuestra: item.cjMuestra,
    fechaAnalisis: item.fechaAnalisis ?? "",
    observaciones: item.observaciones,
  };
}

function toCsv(rows: AsignacionLote[]): string {
  const header = [
    "Lote",
    "Fecha",
    "Producto",
    "Código",
    "Marca",
    "Cantidades",
    "VTO",
    "Muestras",
    "CJ muestra",
    "Fecha análisis",
    "Observaciones",
  ];
  const lines = rows.map((row) =>
    [
      row.lote,
      row.fecha ?? "",
      row.producto,
      row.codigo,
      row.marca,
      row.cantidades,
      row.vto ?? "",
      row.muestras,
      row.cjMuestra,
      row.fechaAnalisis ?? "",
      row.observaciones,
    ]
      .map((value) => `"${String(value).replace(/"/g, '""')}"`)
      .join(",")
  );
  return [header.join(","), ...lines].join("\n");
}

export const ASIGNACION_LOTES_SORT_OPTIONS: SortOption<AsignacionLote>[] = [
  {
    key: "fecha_desc",
    label: "Fecha más reciente",
    compare: (a, b) => compareDates(a.fecha, b.fecha, "desc") || compareStrings(a.lote, b.lote, "asc"),
  },
  {
    key: "fecha_asc",
    label: "Fecha más antigua",
    compare: (a, b) => compareDates(a.fecha, b.fecha, "asc") || compareStrings(a.lote, b.lote, "asc"),
  },
  {
    key: "producto_asc",
    label: "Producto A-Z",
    compare: (a, b) => compareStrings(a.producto, b.producto, "asc") || compareDates(a.fecha, b.fecha, "desc"),
  },
  {
    key: "producto_desc",
    label: "Producto Z-A",
    compare: (a, b) => compareStrings(a.producto, b.producto, "desc"),
  },
  {
    key: "lote_asc",
    label: "Lote A-Z",
    compare: (a, b) => compareStrings(a.lote, b.lote, "asc") || compareStrings(a.codigo, b.codigo, "asc"),
  },
  {
    key: "codigo_asc",
    label: "Código A-Z",
    compare: (a, b) => compareStrings(a.codigo, b.codigo, "asc") || compareStrings(a.lote, b.lote, "asc"),
  },
  {
    key: "cantidad_desc",
    label: "Cantidad mayor a menor",
    compare: (a, b) => compareNumbers(a.cantidades, b.cantidades, "desc"),
  },
  {
    key: "cantidad_asc",
    label: "Cantidad menor a mayor",
    compare: (a, b) => compareNumbers(a.cantidades, b.cantidades, "asc"),
  },
  {
    key: "vto_asc",
    label: "VTO más próximo",
    compare: (a, b) => compareVtoNearest(a.vto, b.vto),
  },
];
const ASIGNACION_LOTES_SORT_KEYS = ASIGNACION_LOTES_SORT_OPTIONS.map((o) => o.key);

function dateForField(item: AsignacionLote, field: DateField): string | null {
  return field === "fecha" ? item.fecha : item[field];
}

/** Asignación de lotes — API autorizada con caché local offline. */
export function AsignacionLotesView() {
  const workspace = useRequiredWorkspace();
  const { email, sectorId } = usePreviewSession();
  const session = useMemo(
    () => ({ email: email ?? workspace.context.email, sector: sectorId ?? workspace.context.sectorId }),
    [email, sectorId, workspace.context.email, workspace.context.sectorId]
  );
  const canAccess = canAccessAsignacionLotes(workspace.context.sectorId);
  const canMutate = canMutateAsignacionLotes(workspace.context.sectorId);
  const [items, setItems] = useState<AsignacionLote[]>(() => getAllAsignacionLotes());
  const [offlineCache, setOfflineCache] = useState(false);
  const [search, setSearch] = useState("");
  const [producto, setProducto] = useState("");
  const [codigo, setCodigo] = useState("");
  const [lote, setLote] = useState("");
  const [marca, setMarca] = useState("");
  const [month, setMonth] = useState("");
  const [year, setYear] = useState("");
  const [dateField, setDateField] = useState<DateField>("fecha");
  const [sort, setSort] = useSortPreference("asignacion-lotes", "fecha_desc", ASIGNACION_LOTES_SORT_KEYS);
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AsignacionLote | null>(null);
  const [form, setForm] = useState<AsignacionFormState>(() => emptyForm());
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AsignacionLote | null>(null);
  const [bulkPending, setBulkPending] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [seedImportText, setSeedImportText] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const { items: allItems } = await fetchAsignacionLotesApi(session);
      replaceAsignacionLotesCache(allItems);
      setItems(getAllAsignacionLotes());
      setOfflineCache(false);
    } catch {
      setItems(getAllAsignacionLotes());
      setOfflineCache(true);
    }
  }, [session]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const filtered = useMemo(() => {
    let rows = filterAsignacionLotesBySearch(items, search);
    const productQ = normalizeAsignacionSearchText(producto);
    const codigoQ = normalizeAsignacionSearchText(codigo);
    const loteQ = normalizeAsignacionSearchText(lote);
    const marcaQ = normalizeAsignacionSearchText(marca);
    rows = rows.filter((item) => {
      if (productQ && !normalizeAsignacionSearchText(item.producto).includes(productQ)) return false;
      if (codigoQ && !normalizeAsignacionSearchText(item.codigo).includes(codigoQ)) return false;
      if (loteQ && !normalizeAsignacionSearchText(item.lote).includes(loteQ)) return false;
      if (marcaQ && !normalizeAsignacionSearchText(item.marca).includes(marcaQ)) return false;
      const selectedDate = dateForField(item, dateField);
      if (month && selectedDate?.slice(5, 7) !== month) return false;
      if (year && selectedDate?.slice(0, 4) !== year) return false;
      return true;
    });
    return applySort(rows, ASIGNACION_LOTES_SORT_OPTIONS, sort);
  }, [items, search, producto, codigo, lote, marca, month, year, dateField, sort]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paginated = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const visibleIds = useMemo(() => paginated.map((r) => r.id), [paginated]);
  const sel = useListSelectionMode(visibleIds);

  const showFeedback = (message: string) => {
    setFeedback(message);
    window.setTimeout(() => setFeedback(null), 4500);
  };

  const clearFilters = () => {
    setSearch("");
    setProducto("");
    setCodigo("");
    setLote("");
    setMarca("");
    setMonth("");
    setYear("");
    setDateField("fecha");
    setSort("fecha_desc");
    setPage(1);
  };

  const startCreate = () => {
    setEditing(null);
    setForm(emptyForm());
    setFormError(null);
    setFormOpen(true);
  };

  const startEdit = (item: AsignacionLote) => {
    setEditing(item);
    setForm(formFromAsignacion(item));
    setFormError(null);
    setFormOpen(true);
  };

  const saveForm = async (event: FormEvent) => {
    event.preventDefault();
    const cantidades = parseNonNegativeNumber(form.cantidades);
    if (!form.lote.trim() || !form.fecha.trim() || !form.producto.trim()) {
      setFormError("Completá Lote, Fecha y Producto.");
      return;
    }
    if (!parseFlexibleDate(form.fecha)) {
      setFormError("Fecha inválida.");
      return;
    }
    if (cantidades === null) {
      setFormError("Cantidades debe ser un número mayor o igual a 0.");
      return;
    }
    const duplicate = findDuplicateAsignacionLote(form.lote, form.codigo, { excludeId: editing?.id });
    if (duplicate) {
      setFormError(`Ya existe el lote ${duplicate.lote} para el código ${duplicate.codigo}.`);
      return;
    }

    try {
      await upsertAsignacionLoteApi(session, {
        id: editing?.id,
        lote: form.lote,
        fecha: parseFlexibleDate(form.fecha) ?? form.fecha,
        producto: form.producto,
        codigo: form.codigo,
        marca: form.marca,
        cantidades,
        vto: form.vto ? parseFlexibleDate(form.vto) : null,
        muestras: form.muestras,
        cjMuestra: form.cjMuestra,
        fechaAnalisis: form.fechaAnalisis ? parseFlexibleDate(form.fechaAnalisis) : null,
        observaciones: form.observaciones,
        updatedBy: workspace.context.displayName,
        createdBy: workspace.context.displayName,
      });
      setFormOpen(false);
      setEditing(null);
      await refresh();
      showFeedback(editing ? "Asignación actualizada." : "Asignación creada.");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "No se pudo guardar.");
    }
  };

  const handleImportConfirm = async ({
    rows,
  }: {
    rows: Array<{ payload?: unknown }>;
  }) => {
    const payloads = rows
      .map((row) => row.payload as AsignacionLoteUpsertInput | undefined)
      .filter((row): row is AsignacionLoteUpsertInput => Boolean(row));
    if (payloads.length === 0) {
      throw new Error("No hay filas válidas para importar.");
    }
    const result = await importAsignacionLotesApi(session, payloads);
    await refresh();
    showFeedback(
      `Importación lista: ${result.imported} cargadas, ${result.skipped} omitidas, ${result.duplicates} duplicadas, ${result.errors.length} errores.`
    );
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    const lowerName = file.name.toLowerCase();
    if (lowerName.endsWith(".xlsx")) {
      showFeedback("Para .xlsx preferimos CSV o pegar desde Excel en esta versión local.");
      return;
    }
    if (!lowerName.endsWith(".csv") && file.type !== "text/csv") {
      showFeedback("Solo se importa CSV como texto. También podés pegar desde Excel.");
      return;
    }
    setSeedImportText(await file.text());
    setImportOpen(true);
  };

  const handleExport = () => {
    const blob = new Blob([toCsv(filtered)], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `asignacion-lotes-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const columns: OperationalTableColumn<AsignacionLote>[] = [
    { key: "lote", header: "Lote", render: (row) => <span className="font-mono text-xs">{row.lote}</span> },
    {
      key: "fecha",
      header: "Fecha",
      hideOnMobile: "xl",
      render: (row) => formatDateDisplay(row.fecha),
    },
    {
      key: "producto",
      header: "Producto",
      render: (row) => (
        <div>
          <p className="font-medium text-[var(--os-text)]">{row.producto}</p>
          {row.marca && <p className="text-xs text-[var(--os-text-muted)]">{row.marca}</p>}
        </div>
      ),
    },
    {
      key: "codigo",
      header: "Código",
      hideOnMobile: "xl",
      render: (row) => (
        <span className="font-mono text-xs">{formatAsignacionCodigoPreview(row.codigo)}</span>
      ),
    },
    {
      key: "cantidades",
      header: "Cantidades",
      hideOnMobile: "xl",
      render: (row) => <span className="tabular-nums">{row.cantidades}</span>,
    },
    {
      key: "vto",
      header: "VTO",
      hideOnMobile: "xl",
      render: (row) => formatDateDisplay(row.vto),
    },
    {
      key: "muestras",
      header: "Muestras",
      hideOnMobile: "xl",
      render: (row) => row.muestras || "—",
    },
    {
      key: "cjMuestra",
      header: "CJ muestra",
      hideOnMobile: "xl",
      render: (row) => row.cjMuestra || "—",
    },
    {
      key: "fechaAnalisis",
      header: "Análisis",
      hideOnMobile: "xl",
      render: (row) => formatDateDisplay(row.fechaAnalisis),
    },
    {
      key: "acciones",
      header: "Acción",
      className: "whitespace-nowrap",
      render: (row) => (
        <div className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            disabled={!canMutate}
            onClick={() => startEdit(row)}
            aria-label={`Editar ${row.lote}`}
            className="rounded p-1.5 text-[var(--os-text-muted)] hover:bg-[var(--os-bg)] hover:text-[var(--os-text)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Pencil className="size-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            disabled={!canMutate}
            onClick={() => setDeleteTarget(row)}
            aria-label={`Eliminar ${row.lote}`}
            className="rounded p-1.5 text-[var(--os-text-muted)] hover:bg-[var(--genus-error-soft)] hover:text-[var(--genus-error)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Trash2 className="size-4" aria-hidden="true" />
          </button>
        </div>
      ),
    },
  ];

  if (!canAccess) {
    return (
      <TwinShell title="Asignación de lotes">
        <div className="rounded-[var(--os-radius)] border border-[var(--os-border)] bg-[var(--os-surface)] p-6">
          <h2 className="text-2xl font-semibold tracking-tight">Asignación de lotes</h2>
          <p className="mt-2 text-sm text-[var(--os-text-muted)]">
            Este módulo está habilitado solo para Calidad, Producción y Codificado.
          </p>
        </div>
      </TwinShell>
    );
  }

  return (
    <TwinShell title="Asignación de lotes">
      <div className="space-y-5">
        <header className="space-y-2">
          <h2 className="text-2xl font-semibold tracking-tight">Asignación de lotes</h2>
          <p className="text-sm text-[var(--os-text-muted)]">
            Carga local por lote + código. Buscá productos como Creamy, filtrá por fechas y exportá CSV.
          </p>
        </header>

        <div className="rounded-[var(--os-radius-sm)] border border-[var(--os-teal)]/40 bg-[var(--os-teal-soft)]/30 px-4 py-3 text-sm text-[var(--os-text)]">
          {offlineCache
            ? "Sin conexión al servidor — mostrando caché local de este navegador"
            : "Sincronizado con servidor — caché local como respaldo offline"}
        </div>

        {feedback && (
          <p className="rounded-[var(--os-radius-sm)] border border-[var(--os-teal)]/30 bg-[var(--os-teal-soft)]/40 px-4 py-2 text-sm font-medium text-[var(--os-teal)]">
            {feedback}
          </p>
        )}

        <section className="space-y-3 rounded-[var(--os-radius)] border border-[var(--os-border)] bg-[var(--os-surface)] p-4">
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-4">
            <FilterInput label="Buscar" value={search} onChange={setSearch} placeholder="Creamy, lote, código..." />
            <FilterInput label="Producto" value={producto} onChange={setProducto} />
            <FilterInput label="Código" value={codigo} onChange={setCodigo} />
            <FilterInput label="Lote" value={lote} onChange={setLote} />
            <FilterInput label="Marca" value={marca} onChange={setMarca} />
            <label className="space-y-1 text-xs font-medium">
              Campo fecha
              <select
                value={dateField}
                onChange={(event) => setDateField(event.target.value as DateField)}
                className="w-full rounded-[var(--os-radius-sm)] border border-[var(--os-border)] bg-[var(--os-surface)] px-3 py-2 text-sm"
              >
                <option value="fecha">Fecha</option>
                <option value="vto">VTO</option>
                <option value="fechaAnalisis">Fecha análisis</option>
              </select>
            </label>
            <label className="space-y-1 text-xs font-medium">
              Mes
              <select
                value={month}
                onChange={(event) => setMonth(event.target.value)}
                className="w-full rounded-[var(--os-radius-sm)] border border-[var(--os-border)] bg-[var(--os-surface)] px-3 py-2 text-sm"
              >
                <option value="">Todos</option>
                {Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, "0")).map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
            <FilterInput label="Año" value={year} onChange={setYear} placeholder="2026" />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <SortSelect
                value={sort}
                onChange={setSort}
                options={ASIGNACION_LOTES_SORT_OPTIONS}
                label="Orden"
                testId="asignacion-lotes-sort"
              />
              <Button type="button" variant="secondary" onClick={clearFilters}>
                Limpiar filtros
              </Button>
              <span className="text-sm text-[var(--os-text-muted)]">{filtered.length} resultado(s)</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {canMutate &&
                (!sel.active ? (
                  <ListSelectionEnterButton onClick={sel.enter} />
                ) : (
                  <ListSelectionToolbar
                    selectedCount={sel.selectedCount}
                    onSelectAll={sel.selectAllVisible}
                    onDeselectAll={sel.deselectAll}
                    onDelete={() => setBulkPending(true)}
                    onCancel={sel.cancel}
                    busy={bulkBusy}
                    deleteLabel="Eliminar seleccionados"
                  />
                ))}
              <Button type="button" variant="secondary" onClick={() => setImportOpen(true)} disabled={!canMutate}>
                <ClipboardPaste className="size-4" aria-hidden="true" />
                Pegar desde Excel
              </Button>
              <label className="inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-[var(--surface)] px-4 text-sm font-medium text-[var(--foreground)] hover:bg-[var(--sidebar-item-hover)]">
                <Upload className="size-4" aria-hidden="true" />
                Importar CSV
                <input className="sr-only" type="file" accept=".csv,text/csv,.xlsx" onChange={handleFileChange} disabled={!canMutate} />
              </label>
              <Button type="button" variant="primary" onClick={startCreate} disabled={!canMutate}>
                <Plus className="size-4" aria-hidden="true" />
                Nuevo lote
              </Button>
              <Button type="button" variant="secondary" onClick={handleExport}>
                <Download className="size-4" aria-hidden="true" />
                Exportar CSV
              </Button>
            </div>
          </div>
        </section>

        <OperationalTable
          columns={columns}
          rows={paginated}
          rowKey={(row) => row.id}
          emptyMessage="Sin asignaciones para los filtros actuales."
          selection={
            sel.active
              ? { active: true, isSelected: sel.isSelected, onToggle: sel.toggle }
              : undefined
          }
        />

        <div className="flex items-center justify-between text-sm text-[var(--os-text-muted)]">
          <span>
            Página {currentPage} de {totalPages} · {PAGE_SIZE} por página
          </span>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" size="sm" disabled={currentPage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              Anterior
            </Button>
            <Button type="button" variant="secondary" size="sm" disabled={currentPage >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
              Siguiente
            </Button>
          </div>
        </div>

        <LifecycleConfirmDialog
          pending={
            deleteTarget
              ? syntheticLifecycleItem(
                  "eliminar",
                  "Eliminar asignación",
                  `Se eliminará permanentemente el lote ${deleteTarget.lote} (${deleteTarget.codigo}).`
                )
              : null
          }
          entityLabel={`${deleteTarget?.lote ?? ""} · ${deleteTarget?.producto ?? ""}`}
          onClose={() => setDeleteTarget(null)}
          onConfirm={async (reason) => {
            if (!deleteTarget) return;
            const id = deleteTarget.id;
            try {
              await deleteAsignacionLoteApi(session, id, reason);
              setDeleteTarget(null);
              setItems((prev) => prev.filter((row) => row.id !== id));
              await refresh();
              showFeedback("Asignación eliminada.");
            } catch (err) {
              showFeedback(err instanceof Error ? err.message : "No se pudo eliminar.");
              throw err;
            }
          }}
        />

        <LifecycleConfirmDialog
          pending={
            bulkPending
              ? syntheticLifecycleItem(
                  "eliminar",
                  "Eliminar asignaciones",
                  bulkDeleteConfirmMessage(sel.selectedCount)
                )
              : null
          }
          entityLabel={`${sel.selectedCount} asignación(es)`}
          onClose={() => setBulkPending(false)}
          onConfirm={async (reason) => {
            setBulkBusy(true);
            let ok = 0;
            let failed = 0;
            const deletedIds: string[] = [];
            const byId = new Map(paginated.map((r) => [r.id, r]));
            for (const id of sel.selectedIds) {
              const row = byId.get(id);
              if (!row) continue;
              try {
                await deleteAsignacionLoteApi(session, id, reason);
                ok += 1;
                deletedIds.push(id);
              } catch {
                failed += 1;
              }
            }
            setBulkPending(false);
            sel.cancel();
            if (deletedIds.length > 0) {
              setItems((prev) => prev.filter((row) => !deletedIds.includes(row.id)));
            }
            await refresh();
            setBulkBusy(false);
            const parts = [`${ok} eliminada(s)`];
            if (failed) parts.push(`${failed} error(es)`);
            showFeedback(parts.join(" · "));
          }}
        />

        <Dialog open={formOpen} onOpenChange={setFormOpen}>
          <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editing ? "Editar asignación" : "Nuevo lote"}</DialogTitle>
              <DialogDescription>El duplicado lote + código se bloquea para evitar doble carga.</DialogDescription>
            </DialogHeader>
            <form onSubmit={saveForm} className="space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Field label="Lote*" value={form.lote} onChange={(value) => setForm((f) => ({ ...f, lote: value }))} />
                <Field label="Fecha*" type="date" value={form.fecha} onChange={(value) => setForm((f) => ({ ...f, fecha: value }))} />
                <Field label="Producto*" value={form.producto} onChange={(value) => setForm((f) => ({ ...f, producto: value }))} />
                <Field label="Código" value={form.codigo} onChange={(value) => setForm((f) => ({ ...f, codigo: value }))} />
                <Field label="Marca" value={form.marca} onChange={(value) => setForm((f) => ({ ...f, marca: value }))} />
                <Field label="Cantidades*" type="number" min="0" step="any" value={form.cantidades} onChange={(value) => setForm((f) => ({ ...f, cantidades: value }))} />
                <Field label="VTO" type="date" value={form.vto} onChange={(value) => setForm((f) => ({ ...f, vto: value }))} />
                <Field label="Muestras" value={form.muestras} onChange={(value) => setForm((f) => ({ ...f, muestras: value }))} />
                <Field label="CJ muestra" value={form.cjMuestra} onChange={(value) => setForm((f) => ({ ...f, cjMuestra: value }))} />
                <Field label="Fecha análisis" type="date" value={form.fechaAnalisis} onChange={(value) => setForm((f) => ({ ...f, fechaAnalisis: value }))} />
                <label className="space-y-1.5 text-sm font-medium sm:col-span-2">
                  Observaciones
                  <textarea
                    value={form.observaciones}
                    onChange={(event) => setForm((f) => ({ ...f, observaciones: event.target.value }))}
                    rows={3}
                    className="w-full rounded-[var(--os-radius-sm)] border border-[var(--os-border)] bg-[var(--os-surface)] px-3 py-2 text-sm"
                  />
                </label>
              </div>
              {formError && <p className="text-sm font-medium text-[var(--genus-error)]">{formError}</p>}
              <DialogFooter>
                <Button type="button" variant="secondary" onClick={() => setFormOpen(false)}>
                  Cancelar
                </Button>
                <Button type="submit" variant="primary">
                  Guardar
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        <ExcelImportPreviewDialog
          open={importOpen}
          onOpenChange={(open) => {
            setImportOpen(open);
            if (!open) setSeedImportText("");
          }}
          title="Pegar asignaciones desde Excel"
          description="Las filas con errores o duplicadas por lote + código se excluyen."
          fields={IMPORT_FIELDS}
          fieldAliases={ASIGNACION_LOTES_FIELD_ALIASES}
          analyzeMode="live"
          allowColumnRemap
          initialText={seedImportText}
          idempotencyPrefix="asignacion-lotes-import"
          placeholder="Pegá columnas como Lote, Fecha, Producto, Código, Marca, Cantidades..."
          validateMappedRow={(mapped, { rowNumber }) => {
            const row = mapped as Partial<AsignacionLoteMappedRow>;
            const issues = validateAsignacionLoteRow(row, rowNumber);
            if (row.lote?.trim() && findDuplicateAsignacionLote(row.lote, row.codigo ?? "")) {
              issues.push({
                rowIndex: rowNumber,
                field: "lote",
                message: "Duplicado por lote + código; no se importará.",
              });
            }
            return {
              issues,
              payload: buildAsignacionLoteFromMappedRow(row, workspace.context.displayName),
            };
          }}
          onConfirm={handleImportConfirm}
          onToast={(message) => showFeedback(message)}
        />
      </div>
    </TwinShell>
  );
}

function FilterInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="space-y-1 text-xs font-medium">
      {label}
      <input
        type="search"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-[var(--os-radius-sm)] border border-[var(--os-border)] bg-[var(--os-surface)] px-3 py-2 text-sm"
      />
    </label>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  min,
  step,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  min?: string;
  step?: string;
}) {
  return (
    <label className="space-y-1.5 text-sm font-medium">
      {label}
      <input
        type={type}
        min={min}
        step={step}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-[var(--os-radius-sm)] border border-[var(--os-border)] bg-[var(--os-surface)] px-3 py-2 text-sm"
      />
    </label>
  );
}
