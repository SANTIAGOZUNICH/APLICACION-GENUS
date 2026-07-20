"use client";

import { useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import { ClipboardPaste, Download, Pencil, Plus, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TwinShell } from "@/features/os/shell/twin-shell";
import { useRequiredWorkspace } from "@/features/os/workspace/workspace-provider";
import { OperationalTable, type OperationalTableColumn } from "../components/operational-ui";
import {
  findDuplicateAsignacionLote,
  getAllAsignacionLotes,
  importAsignacionLotes,
  softDeleteAsignacionLote,
  upsertAsignacionLote,
  type AsignacionLote,
} from "../adapters/asignacion-lotes-repository";
import {
  ASIGNACION_LOTES_FIELD_ALIASES,
  buildAsignacionLoteFromMappedRow,
  validateAsignacionLoteRow,
  type AsignacionLoteMappedRow,
} from "../lib/asignacion-lotes-import";
import {
  filterAsignacionLotesBySearch,
  normalizeAsignacionSearchText,
} from "../lib/asignacion-lotes-search";
import {
  autoMapColumns,
  parseGrid,
  parseNonNegativeNumber,
  rowToObject,
  type ColumnMapping,
  type RowValidationIssue,
} from "../lib/clipboard-import";
import { formatDateDisplay, parseFlexibleDate } from "../lib/delivery-date";
import {
  canAccessAsignacionLotes,
  canMutateAsignacionLotes,
} from "../lib/asignacion-lotes-rbac";

const PAGE_SIZE = 20;

const IMPORT_FIELDS: Array<{ key: keyof AsignacionLoteMappedRow; label: string; required?: boolean }> = [
  { key: "lote", label: "Lote", required: true },
  { key: "fecha", label: "Fecha", required: true },
  { key: "producto", label: "Producto", required: true },
  { key: "codigo", label: "Código", required: true },
  { key: "marca", label: "Marca" },
  { key: "cantidades", label: "Cantidades", required: true },
  { key: "vto", label: "VTO" },
  { key: "muestras", label: "Muestras" },
  { key: "cjMuestra", label: "CJ muestra" },
  { key: "fechaAnalisis", label: "Fecha análisis" },
  { key: "observaciones", label: "Observaciones" },
];

type DateField = "fecha" | "vto" | "fechaAnalisis";
type SortKey = "fecha_desc" | "fecha_asc" | "producto_asc" | "lote_asc" | "codigo_asc";

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

interface ImportPreviewRow {
  rowNumber: number;
  mapped: Partial<AsignacionLoteMappedRow>;
  issues: RowValidationIssue[];
  lote: ReturnType<typeof buildAsignacionLoteFromMappedRow>;
}

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
    fecha: item.fecha,
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
      row.fecha,
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

function sortAsignaciones(rows: AsignacionLote[], sort: SortKey): AsignacionLote[] {
  return [...rows].sort((a, b) => {
    if (sort === "fecha_asc") return a.fecha.localeCompare(b.fecha) || a.lote.localeCompare(b.lote, "es");
    if (sort === "producto_asc") return a.producto.localeCompare(b.producto, "es") || a.fecha.localeCompare(b.fecha);
    if (sort === "lote_asc") return a.lote.localeCompare(b.lote, "es") || a.codigo.localeCompare(b.codigo, "es");
    if (sort === "codigo_asc") return a.codigo.localeCompare(b.codigo, "es") || a.lote.localeCompare(b.lote, "es");
    return b.fecha.localeCompare(a.fecha) || a.lote.localeCompare(b.lote, "es");
  });
}

function dateForField(item: AsignacionLote, field: DateField): string | null {
  return field === "fecha" ? item.fecha : item[field];
}

/** Asignación de lotes — carga local operativa para Calidad, Producción y Codificado. */
export function AsignacionLotesView() {
  const workspace = useRequiredWorkspace();
  const canAccess = canAccessAsignacionLotes(workspace.context.sectorId);
  const canMutate = canMutateAsignacionLotes(workspace.context.sectorId);
  const [items, setItems] = useState<AsignacionLote[]>(() => getAllAsignacionLotes());
  const [search, setSearch] = useState("");
  const [producto, setProducto] = useState("");
  const [codigo, setCodigo] = useState("");
  const [lote, setLote] = useState("");
  const [marca, setMarca] = useState("");
  const [month, setMonth] = useState("");
  const [year, setYear] = useState("");
  const [dateField, setDateField] = useState<DateField>("fecha");
  const [sort, setSort] = useState<SortKey>("fecha_desc");
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AsignacionLote | null>(null);
  const [form, setForm] = useState<AsignacionFormState>(() => emptyForm());
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AsignacionLote | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [customMapping, setCustomMapping] = useState<ColumnMapping>({});
  const [feedback, setFeedback] = useState<string | null>(null);

  const refresh = () => setItems(getAllAsignacionLotes());

  const grid = useMemo(() => parseGrid(importText), [importText]);
  const autoMapping = useMemo(() => autoMapColumns(grid.headers, ASIGNACION_LOTES_FIELD_ALIASES), [grid.headers]);
  const mapping = useMemo(() => ({ ...autoMapping, ...customMapping }), [autoMapping, customMapping]);
  const importPreview = useMemo<ImportPreviewRow[]>(() => {
    if (!importText.trim()) return [];
    return grid.rows.map((row, index) => {
      const rowNumber = grid.hasHeaderRow ? index + 2 : index + 1;
      const mapped = rowToObject(row, mapping) as Partial<AsignacionLoteMappedRow>;
      const issues = validateAsignacionLoteRow(mapped, rowNumber);
      if (
        mapped.lote?.trim() &&
        mapped.codigo?.trim() &&
        findDuplicateAsignacionLote(mapped.lote, mapped.codigo)
      ) {
        issues.push({
          rowIndex: rowNumber,
          field: "lote",
          message: "Duplicado por lote + código; no se importará.",
        });
      }
      return {
        rowNumber,
        mapped,
        issues,
        lote: buildAsignacionLoteFromMappedRow(mapped, workspace.context.displayName),
      };
    });
  }, [grid, importText, mapping, workspace.context.displayName]);
  const importValidRows = importPreview.filter((row) => row.issues.length === 0);
  const importIssueRows = importPreview.filter((row) => row.issues.length > 0);

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
    return sortAsignaciones(rows, sort);
  }, [items, search, producto, codigo, lote, marca, month, year, dateField, sort]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paginated = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

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

  const saveForm = (event: FormEvent) => {
    event.preventDefault();
    const cantidades = parseNonNegativeNumber(form.cantidades);
    if (!form.lote.trim() || !form.fecha.trim() || !form.producto.trim() || !form.codigo.trim()) {
      setFormError("Completá Lote, Fecha, Producto y Código.");
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

    upsertAsignacionLote({
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
    refresh();
    showFeedback(editing ? "Asignación actualizada." : "Asignación creada.");
  };

  const handleImportConfirm = () => {
    if (importValidRows.length === 0) {
      showFeedback("No hay filas válidas para importar.");
      return;
    }
    const result = importAsignacionLotes(
      importValidRows.map((row) => row.lote),
      workspace.context.displayName
    );
    refresh();
    setImportOpen(false);
    setImportText("");
    setCustomMapping({});
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
    setImportText(await file.text());
    setCustomMapping({});
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
    { key: "fecha", header: "Fecha", render: (row) => formatDateDisplay(row.fecha) },
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
    { key: "codigo", header: "Código", render: (row) => <span className="font-mono text-xs">{row.codigo}</span> },
    { key: "cantidades", header: "Cantidades", render: (row) => <span className="tabular-nums">{row.cantidades}</span> },
    { key: "vto", header: "VTO", render: (row) => formatDateDisplay(row.vto) },
    { key: "muestras", header: "Muestras", render: (row) => row.muestras || "—" },
    { key: "cjMuestra", header: "CJ muestra", render: (row) => row.cjMuestra || "—" },
    { key: "fechaAnalisis", header: "Análisis", render: (row) => formatDateDisplay(row.fechaAnalisis) },
    {
      key: "acciones",
      header: "Acción",
      render: (row) => (
        <div className="flex gap-2">
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
            className="rounded p-1.5 text-[var(--os-text-muted)] hover:bg-rose-50 hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-40"
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
          Datos locales (este navegador) — no sincroniza entre dispositivos
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
              <label className="space-y-1 text-xs font-medium">
                Orden
                <select
                  value={sort}
                  onChange={(event) => setSort(event.target.value as SortKey)}
                  className="rounded-[var(--os-radius-sm)] border border-[var(--os-border)] bg-[var(--os-surface)] px-3 py-2 text-sm"
                >
                  <option value="fecha_desc">Fecha más reciente</option>
                  <option value="fecha_asc">Fecha más antigua</option>
                  <option value="producto_asc">Producto A-Z</option>
                  <option value="lote_asc">Lote A-Z</option>
                  <option value="codigo_asc">Código A-Z</option>
                </select>
              </label>
              <Button type="button" variant="secondary" onClick={clearFilters}>
                Limpiar filtros
              </Button>
              <span className="text-sm text-[var(--os-text-muted)]">{filtered.length} resultado(s)</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="secondary" onClick={() => setImportOpen(true)} disabled={!canMutate}>
                <ClipboardPaste className="size-4" aria-hidden="true" />
                Pegar desde Excel
              </Button>
              <label className="inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-[var(--surface)] px-4 text-sm font-medium text-[var(--foreground)] hover:bg-[var(--sidebar-item-hover)]">
                <Upload className="size-4" aria-hidden="true" />
                CSV
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

        <ConfirmDialog
          open={deleteTarget !== null}
          onOpenChange={(open) => !open && setDeleteTarget(null)}
          title="Archivar asignación"
          description={`Se archivará el lote ${deleteTarget?.lote ?? ""} (${deleteTarget?.codigo ?? ""}).`}
          confirmLabel="Archivar"
          variant="destructive"
          onConfirm={() => {
            if (deleteTarget) {
              softDeleteAsignacionLote(deleteTarget.id, workspace.context.displayName);
              refresh();
              showFeedback("Asignación archivada.");
            }
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
                <Field label="Código*" value={form.codigo} onChange={(value) => setForm((f) => ({ ...f, codigo: value }))} />
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
              {formError && <p className="text-sm font-medium text-rose-700">{formError}</p>}
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

        <Dialog open={importOpen} onOpenChange={setImportOpen}>
          <DialogContent className="max-h-[92vh] max-w-6xl overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Pegar asignaciones desde Excel</DialogTitle>
              <DialogDescription>Las filas con errores o duplicadas por lote + código se excluyen.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <textarea
                value={importText}
                onChange={(event) => {
                  setImportText(event.target.value);
                  setCustomMapping({});
                }}
                placeholder="Pegá columnas como Lote, Fecha, Producto, Código, Marca, Cantidades..."
                rows={8}
                className="w-full rounded-[var(--os-radius-sm)] border border-[var(--os-border)] bg-[var(--os-surface)] px-3 py-2 font-mono text-xs"
              />

              {grid.headers.length > 0 && (
                <div className="rounded-[var(--os-radius-sm)] border border-[var(--os-border)] p-3">
                  <h3 className="mb-2 text-sm font-semibold">Mapeo de columnas</h3>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {IMPORT_FIELDS.map((field) => (
                      <label key={field.key} className="space-y-1 text-xs font-medium">
                        {field.label}{field.required ? "*" : ""}
                        <select
                          value={mapping[field.key] ?? ""}
                          onChange={(event) =>
                            setCustomMapping((current) => ({
                              ...current,
                              [field.key]: event.target.value === "" ? null : Number(event.target.value),
                            }))
                          }
                          className="w-full rounded border border-[var(--os-border)] bg-[var(--os-surface)] px-2 py-1.5"
                        >
                          <option value="">Sin mapear</option>
                          {grid.headers.map((header, index) => (
                            <option key={`${header}-${index}`} value={index}>
                              {header}
                            </option>
                          ))}
                        </select>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {importIssueRows.length > 0 && (
                <div className="rounded-[var(--os-radius-sm)] border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
                  <p className="font-semibold">Filas con errores o duplicados</p>
                  <ul className="mt-2 list-disc space-y-1 pl-5">
                    {importIssueRows.slice(0, 12).map((row) => (
                      <li key={row.rowNumber}>
                        Fila {row.rowNumber}: {row.issues.map((issue) => issue.message).join(" ")}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="overflow-x-auto rounded-[var(--os-radius-sm)] border border-[var(--os-border)]">
                <table className="w-full min-w-[760px] text-sm">
                  <thead className="bg-[var(--os-bg)] text-xs uppercase text-[var(--os-text-muted)]">
                    <tr>
                      <th className="px-3 py-2 text-left">Fila</th>
                      <th className="px-3 py-2 text-left">Lote</th>
                      <th className="px-3 py-2 text-left">Fecha</th>
                      <th className="px-3 py-2 text-left">Producto</th>
                      <th className="px-3 py-2 text-left">Código</th>
                      <th className="px-3 py-2 text-left">Cantidades</th>
                      <th className="px-3 py-2 text-left">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importPreview.slice(0, 20).map((row) => (
                      <tr key={row.rowNumber} className="border-t border-[var(--os-border-subtle)]">
                        <td className="px-3 py-2">{row.rowNumber}</td>
                        <td className="px-3 py-2 font-mono text-xs">{row.mapped.lote}</td>
                        <td className="px-3 py-2">{row.mapped.fecha}</td>
                        <td className="px-3 py-2">{row.mapped.producto}</td>
                        <td className="px-3 py-2 font-mono text-xs">{row.mapped.codigo}</td>
                        <td className="px-3 py-2 tabular-nums">{row.mapped.cantidades}</td>
                        <td className="px-3 py-2">
                          {row.issues.length === 0 ? (
                            <span className="text-[var(--os-teal)]">Lista</span>
                          ) : (
                            <span className="text-amber-700">Excluida</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-[var(--os-text-muted)]">
                {importValidRows.length} filas válidas de {importPreview.length}. Se excluyen las filas con errores.
              </p>
            </div>
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setImportOpen(false)}>
                Cancelar
              </Button>
              <Button type="button" variant="primary" onClick={handleImportConfirm}>
                Confirmar importación
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
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
