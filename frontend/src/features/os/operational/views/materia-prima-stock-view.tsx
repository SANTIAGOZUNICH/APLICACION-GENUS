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
import {
  OperationalTable,
  StatusChip,
  type OperationalTableColumn,
} from "../components/operational-ui";
import {
  findDuplicate,
  getAllMateriasPrimas,
  importMateriasPrimas,
  removeMateriaPrima,
  resolveEstado,
  upsertMateriaPrima,
  type MateriaPrimaEstado,
  type MateriaPrimaLot,
} from "../adapters/materia-prima-repository";
import {
  MP_FIELD_ALIASES,
  buildMpFromMappedRow,
  validateMpRow,
  type MateriaPrimaMappedRow,
} from "../lib/materia-prima-import";
import {
  autoMapColumns,
  parseGrid,
  parseNonNegativeNumber,
  rowToObject,
  type ColumnMapping,
  type RowValidationIssue,
} from "../lib/clipboard-import";
import { formatDateDisplay, parseFlexibleDate } from "../lib/delivery-date";

const ESTADO_FILTERS: Array<{ id: MateriaPrimaEstado | "todos"; label: string }> = [
  { id: "todos", label: "Todos" },
  { id: "disponible", label: "Disponible" },
  { id: "por_vencer", label: "Por vencer" },
  { id: "vencido", label: "Vencido" },
  { id: "agotado", label: "Agotado" },
];

const MP_IMPORT_FIELDS: Array<{ key: keyof MateriaPrimaMappedRow; label: string; required?: boolean }> = [
  { key: "codigo", label: "Código", required: true },
  { key: "nombre", label: "Nombre", required: true },
  { key: "lote", label: "Lote", required: true },
  { key: "proveedor", label: "Proveedor" },
  { key: "cantidad", label: "Cantidad", required: true },
  { key: "unidad", label: "Unidad", required: true },
  { key: "fechaIngreso", label: "Fecha ingreso" },
  { key: "vencimiento", label: "Fecha vencimiento" },
  { key: "ubicacion", label: "Ubicación" },
  { key: "estadoManual", label: "Estado" },
  { key: "observaciones", label: "Observaciones" },
];

type MpFormState = {
  codigo: string;
  nombre: string;
  lote: string;
  proveedor: string;
  cantidad: string;
  unidad: string;
  fechaIngreso: string;
  vencimiento: string;
  ubicacion: string;
  estadoManual: "" | MateriaPrimaEstado;
  observaciones: string;
};

interface ImportPreviewRow {
  rowNumber: number;
  source: string[];
  mapped: Partial<MateriaPrimaMappedRow>;
  issues: RowValidationIssue[];
  mp: ReturnType<typeof buildMpFromMappedRow>;
}

function emptyForm(): MpFormState {
  return {
    codigo: "",
    nombre: "",
    lote: "",
    proveedor: "",
    cantidad: "",
    unidad: "kg",
    fechaIngreso: new Date().toISOString().slice(0, 10),
    vencimiento: "",
    ubicacion: "",
    estadoManual: "",
    observaciones: "",
  };
}

function formFromMateriaPrima(mp: MateriaPrimaLot): MpFormState {
  return {
    codigo: mp.codigo,
    nombre: mp.nombre,
    lote: mp.lote,
    proveedor: mp.proveedor,
    cantidad: String(mp.stock),
    unidad: mp.unidad,
    fechaIngreso: mp.fechaIngreso ?? "",
    vencimiento: mp.vencimiento ?? "",
    ubicacion: mp.ubicacion,
    estadoManual: mp.estadoManual ?? "",
    observaciones: mp.observaciones,
  };
}

function toCsv(rows: MateriaPrimaLot[]): string {
  const header = [
    "Código",
    "Materia prima",
    "Lote",
    "Proveedor",
    "Cantidad",
    "Unidad",
    "Fecha ingreso",
    "Vencimiento",
    "Ubicación",
    "Estado",
    "Observaciones",
  ];
  const lines = rows.map((r) =>
    [
      r.codigo,
      r.nombre,
      r.lote,
      r.proveedor,
      r.stock,
      r.unidad,
      r.fechaIngreso ?? "",
      r.vencimiento ?? "",
      r.ubicacion,
      resolveEstado(r),
      r.observaciones,
    ]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(",")
  );
  return [header.join(","), ...lines].join("\n");
}

/** Stock de Materias Primas — pegado múltiple desde Excel, búsqueda, edición y exportación. */
export function MateriaPrimaStockView() {
  const workspace = useRequiredWorkspace();
  const [items, setItems] = useState<MateriaPrimaLot[]>(() => getAllMateriasPrimas());
  const [search, setSearch] = useState("");
  const [estadoFilter, setEstadoFilter] = useState<MateriaPrimaEstado | "todos">("todos");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<MateriaPrimaLot | null>(null);
  const [form, setForm] = useState<MpFormState>(() => emptyForm());
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MateriaPrimaLot | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [customMapping, setCustomMapping] = useState<ColumnMapping>({});
  const [feedback, setFeedback] = useState<string | null>(null);

  const refresh = () => setItems(getAllMateriasPrimas());

  const grid = useMemo(() => parseGrid(importText), [importText]);
  const autoMapping = useMemo(() => autoMapColumns(grid.headers, MP_FIELD_ALIASES), [grid.headers]);
  const mapping = useMemo(() => ({ ...autoMapping, ...customMapping }), [autoMapping, customMapping]);
  const importPreview = useMemo<ImportPreviewRow[]>(() => {
    if (!importText.trim()) return [];
    return grid.rows.map((row, index) => {
      const rowNumber = grid.hasHeaderRow ? index + 2 : index + 1;
      const mapped = rowToObject(row, mapping) as Partial<MateriaPrimaMappedRow>;
      const issues = validateMpRow(mapped, rowNumber);
      return {
        rowNumber,
        source: row,
        mapped,
        issues,
        mp: buildMpFromMappedRow(mapped),
      };
    });
  }, [grid, importText, mapping]);
  const importValidRows = importPreview.filter((row) => row.issues.length === 0);
  const importIssueRows = importPreview.filter((row) => row.issues.length > 0);

  const filtered = useMemo(() => {
    return items.filter((mp) => {
      const estado = resolveEstado(mp);
      if (estadoFilter !== "todos" && estado !== estadoFilter) return false;
      if (!search.trim()) return true;
      const q = search.trim().toLowerCase();
      return (
        mp.codigo.toLowerCase().includes(q) ||
        mp.nombre.toLowerCase().includes(q) ||
        mp.lote.toLowerCase().includes(q) ||
        mp.proveedor.toLowerCase().includes(q) ||
        mp.ubicacion.toLowerCase().includes(q)
      );
    });
  }, [items, search, estadoFilter]);

  const showFeedback = (message: string) => {
    setFeedback(message);
    window.setTimeout(() => setFeedback(null), 4500);
  };

  const startCreate = () => {
    setEditing(null);
    setForm(emptyForm());
    setFormError(null);
    setFormOpen(true);
  };

  const startEdit = (mp: MateriaPrimaLot) => {
    setEditing(mp);
    setForm(formFromMateriaPrima(mp));
    setFormError(null);
    setFormOpen(true);
  };

  const saveForm = (event: FormEvent) => {
    event.preventDefault();
    const cantidad = parseNonNegativeNumber(form.cantidad);
    if (!form.codigo.trim() || !form.nombre.trim() || !form.lote.trim()) {
      setFormError("Completá Código, Nombre y Lote.");
      return;
    }
    if (cantidad === null) {
      setFormError("Cantidad debe ser un número mayor o igual a 0.");
      return;
    }
    if (!form.unidad.trim()) {
      setFormError("Unidad es obligatoria.");
      return;
    }
    const duplicate = findDuplicate(form.codigo, form.lote, { excludeId: editing?.id });
    if (duplicate) {
      setFormError(`Ya existe ${duplicate.codigo} con lote ${duplicate.lote}. Editá ese registro o cambiá el lote.`);
      return;
    }

    upsertMateriaPrima({
      id: editing?.id,
      codigo: form.codigo,
      nombre: form.nombre,
      lote: form.lote,
      proveedor: form.proveedor,
      stock: cantidad,
      cantidad,
      unidad: form.unidad,
      fechaIngreso: form.fechaIngreso ? parseFlexibleDate(form.fechaIngreso) : null,
      vencimiento: form.vencimiento ? parseFlexibleDate(form.vencimiento) : null,
      ubicacion: form.ubicacion,
      estadoManual: form.estadoManual || null,
      observaciones: form.observaciones,
      updatedBy: workspace.context.displayName,
      createdBy: workspace.context.displayName,
    });
    setFormOpen(false);
    setEditing(null);
    refresh();
    showFeedback(editing ? "Materia prima actualizada." : "Materia prima creada.");
  };

  const handleExport = () => {
    const csv = toCsv(filtered);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `stock-materias-primas-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportConfirm = () => {
    if (importValidRows.length === 0) {
      showFeedback("No hay filas válidas para importar.");
      return;
    }
    const result = importMateriasPrimas(
      importValidRows.map((row) => row.mp),
      workspace.context.displayName
    );
    refresh();
    setImportOpen(false);
    setImportText("");
    setCustomMapping({});
    showFeedback(
      `Importación lista: ${result.imported} nuevas, ${result.updated} actualizadas, ${result.duplicates} duplicadas, ${result.errors.length} errores.`
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

  const columns: OperationalTableColumn<MateriaPrimaLot>[] = [
    {
      key: "codigo",
      header: "Código",
      render: (r) => <span className="font-mono text-xs">{r.codigo}</span>,
    },
    {
      key: "nombre",
      header: "Materia prima",
      render: (r) => (
        <div>
          <p className="font-medium text-[var(--os-text)]">{r.nombre}</p>
          {r.proveedor && <p className="text-xs text-[var(--os-text-muted)]">{r.proveedor}</p>}
        </div>
      ),
    },
    {
      key: "lote",
      header: "Lote",
      render: (r) => <span className="font-mono text-xs">{r.lote}</span>,
    },
    {
      key: "stock",
      header: "Cantidad",
      render: (r) => <span className="tabular-nums">{r.stock}</span>,
    },
    {
      key: "unidad",
      header: "Unidad",
      render: (r) => r.unidad,
    },
    {
      key: "ingreso",
      header: "Ingreso",
      render: (r) => formatDateDisplay(r.fechaIngreso),
    },
    {
      key: "vencimiento",
      header: "Vencimiento",
      render: (r) => formatDateDisplay(r.vencimiento),
    },
    {
      key: "ubicacion",
      header: "Ubicación",
      render: (r) => r.ubicacion || "—",
    },
    {
      key: "estado",
      header: "Estado",
      render: (r) => <StatusChip status={resolveEstado(r)} />,
    },
    {
      key: "acciones",
      header: "Acción",
      render: (r) => (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => startEdit(r)}
            aria-label={`Editar ${r.nombre}`}
            className="rounded p-1.5 text-[var(--os-text-muted)] hover:bg-[var(--os-bg)] hover:text-[var(--os-text)]"
          >
            <Pencil className="size-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => setDeleteTarget(r)}
            aria-label={`Eliminar ${r.nombre}`}
            className="rounded p-1.5 text-[var(--os-text-muted)] hover:bg-rose-50 hover:text-rose-700"
          >
            <Trash2 className="size-4" aria-hidden="true" />
          </button>
        </div>
      ),
    },
  ];

  return (
    <TwinShell title="Stock de Materias Primas">
    <div className="space-y-5">
      <header className="space-y-2">
        <h2 className="text-2xl font-semibold tracking-tight">Stock de Materias Primas</h2>
        <p className="text-sm text-[var(--os-text-muted)]">
          {workspace.sectorLabel} · {workspace.context.jobTitle}
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

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por código, nombre o lote…"
            aria-label="Buscar materia prima"
            className="w-64 max-w-full rounded-[var(--os-radius-sm)] border border-[var(--os-border)] bg-[var(--os-surface)] px-3 py-2 text-sm"
          />
          <select
            value={estadoFilter}
            onChange={(e) => setEstadoFilter(e.target.value as MateriaPrimaEstado | "todos")}
            aria-label="Filtrar por disponibilidad"
            className="rounded-[var(--os-radius-sm)] border border-[var(--os-border)] bg-[var(--os-surface)] px-3 py-2 text-sm"
          >
            {ESTADO_FILTERS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={() => setImportOpen(true)}>
            <ClipboardPaste className="size-4" aria-hidden="true" />
            Pegar desde Excel
          </Button>
          <label className="inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-[var(--surface)] px-4 text-sm font-medium text-[var(--foreground)] hover:bg-[var(--sidebar-item-hover)]">
            <Upload className="size-4" aria-hidden="true" />
            CSV
            <input className="sr-only" type="file" accept=".csv,text/csv,.xlsx" onChange={handleFileChange} />
          </label>
          <Button variant="primary" onClick={startCreate}>
            <Plus className="size-4" aria-hidden="true" />
            Nueva materia prima
          </Button>
          <Button variant="secondary" onClick={handleExport}>
            <Download className="size-4" aria-hidden="true" />
            Exportar CSV
          </Button>
        </div>
      </div>

      <OperationalTable
        columns={columns}
        rows={filtered}
        rowKey={(r) => r.id}
        emptyMessage="Sin materias primas cargadas todavía. Pegá filas desde Excel para empezar."
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Eliminar materia prima"
        description={`Se eliminará ${deleteTarget?.nombre ?? ""} (lote ${deleteTarget?.lote ?? ""}) del stock. Esta acción no se puede deshacer.`}
        confirmLabel="Eliminar"
        variant="destructive"
        onConfirm={() => {
          if (deleteTarget) {
            removeMateriaPrima(deleteTarget.id, workspace.context.displayName);
            refresh();
            showFeedback("Materia prima archivada.");
          }
        }}
      />

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar materia prima" : "Nueva materia prima"}</DialogTitle>
            <DialogDescription>
              Cargá los datos del lote. El estado queda automático salvo que elijas una anulación manual.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={saveForm} className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Código*" value={form.codigo} onChange={(value) => setForm((f) => ({ ...f, codigo: value }))} />
              <Field label="Nombre*" value={form.nombre} onChange={(value) => setForm((f) => ({ ...f, nombre: value }))} />
              <Field label="Lote*" value={form.lote} onChange={(value) => setForm((f) => ({ ...f, lote: value }))} />
              <Field label="Proveedor" value={form.proveedor} onChange={(value) => setForm((f) => ({ ...f, proveedor: value }))} />
              <Field label="Cantidad*" type="number" min="0" step="any" value={form.cantidad} onChange={(value) => setForm((f) => ({ ...f, cantidad: value }))} />
              <Field label="Unidad*" value={form.unidad} onChange={(value) => setForm((f) => ({ ...f, unidad: value }))} />
              <Field label="Fecha ingreso" type="date" value={form.fechaIngreso} onChange={(value) => setForm((f) => ({ ...f, fechaIngreso: value }))} />
              <Field label="Fecha vencimiento" type="date" value={form.vencimiento} onChange={(value) => setForm((f) => ({ ...f, vencimiento: value }))} />
              <Field label="Ubicación" value={form.ubicacion} onChange={(value) => setForm((f) => ({ ...f, ubicacion: value }))} />
              <label className="space-y-1.5 text-sm font-medium">
                Estado
                <select
                  value={form.estadoManual}
                  onChange={(event) =>
                    setForm((f) => ({ ...f, estadoManual: event.target.value as "" | MateriaPrimaEstado }))
                  }
                  className="w-full rounded-[var(--os-radius-sm)] border border-[var(--os-border)] bg-[var(--os-surface)] px-3 py-2 text-sm"
                >
                  <option value="">Auto</option>
                  <option value="disponible">Disponible</option>
                  <option value="por_vencer">Por vencer</option>
                  <option value="vencido">Vencido</option>
                  <option value="agotado">Agotado</option>
                </select>
              </label>
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
            <DialogTitle>Pegar desde Excel</DialogTitle>
            <DialogDescription>
              Pegá una tabla copiada desde Excel/Sheets o cargá un CSV. Revisá el mapeo antes de confirmar.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <textarea
              value={importText}
              onChange={(event) => {
                setImportText(event.target.value);
                setCustomMapping({});
              }}
              placeholder="Pegá acá columnas como Código, Nombre, Lote, Proveedor, Cantidad, Unidad..."
              rows={8}
              className="w-full rounded-[var(--os-radius-sm)] border border-[var(--os-border)] bg-[var(--os-surface)] px-3 py-2 font-mono text-xs"
            />

            {grid.headers.length > 0 && (
              <div className="rounded-[var(--os-radius-sm)] border border-[var(--os-border)] p-3">
                <h3 className="mb-2 text-sm font-semibold">Mapeo de columnas</h3>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {MP_IMPORT_FIELDS.map((field) => (
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
                <p className="font-semibold">Filas con errores (se excluyen al importar)</p>
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
              <table className="w-full min-w-[720px] text-sm">
                <thead className="bg-[var(--os-bg)] text-xs uppercase text-[var(--os-text-muted)]">
                  <tr>
                    <th className="px-3 py-2 text-left">Fila</th>
                    <th className="px-3 py-2 text-left">Código</th>
                    <th className="px-3 py-2 text-left">Nombre</th>
                    <th className="px-3 py-2 text-left">Lote</th>
                    <th className="px-3 py-2 text-left">Cantidad</th>
                    <th className="px-3 py-2 text-left">Unidad</th>
                    <th className="px-3 py-2 text-left">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {importPreview.slice(0, 20).map((row) => (
                    <tr key={row.rowNumber} className="border-t border-[var(--os-border-subtle)]">
                      <td className="px-3 py-2">{row.rowNumber}</td>
                      <td className="px-3 py-2 font-mono text-xs">{row.mapped.codigo}</td>
                      <td className="px-3 py-2">{row.mapped.nombre}</td>
                      <td className="px-3 py-2 font-mono text-xs">{row.mapped.lote}</td>
                      <td className="px-3 py-2 tabular-nums">{row.mapped.cantidad}</td>
                      <td className="px-3 py-2">{row.mapped.unidad}</td>
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