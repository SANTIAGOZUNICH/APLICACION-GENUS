"use client";

import { useMemo, useState, type ClipboardEvent } from "react";
import { Download, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { TwinShell } from "@/features/os/shell/twin-shell";
import { useRequiredWorkspace } from "@/features/os/workspace/workspace-provider";
import {
  OperationalTable,
  StatusChip,
  type OperationalTableColumn,
} from "../components/operational-ui";
import {
  getAllMateriasPrimas,
  parseClipboardRows,
  removeMateriaPrima,
  resolveEstado,
  upsertMateriaPrima,
  type MateriaPrimaEstado,
  type MateriaPrimaLot,
} from "../adapters/materia-prima-repository";

const ESTADO_FILTERS: Array<{ id: MateriaPrimaEstado | "todos"; label: string }> = [
  { id: "todos", label: "Todos" },
  { id: "disponible", label: "Disponible" },
  { id: "por_vencer", label: "Por vencer" },
  { id: "vencido", label: "Vencido" },
  { id: "agotado", label: "Agotado" },
];

function toCsv(rows: MateriaPrimaLot[]): string {
  const header = ["Código", "Materia prima", "Lote", "Stock", "Unidad", "Vencimiento", "Estado"];
  const lines = rows.map((r) =>
    [r.codigo, r.nombre, r.lote, r.stock, r.unidad, r.vencimiento ?? "", resolveEstado(r)]
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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<MateriaPrimaLot>>({});
  const [deleteTarget, setDeleteTarget] = useState<MateriaPrimaLot | null>(null);
  const [pasteFeedback, setPasteFeedback] = useState<string | null>(null);

  const refresh = () => setItems(getAllMateriasPrimas());

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    const text = event.clipboardData.getData("text/plain");
    if (!text.includes("\t") && !text.includes("\n")) return;
    event.preventDefault();
    const rows = parseClipboardRows(text);
    if (rows.length === 0) {
      setPasteFeedback("No se detectaron filas válidas. Usá el formato Código, Materia prima, Lote, Stock, Unidad, Vencimiento separado por tabulaciones.");
      return;
    }
    for (const row of rows) {
      upsertMateriaPrima({ ...row, updatedBy: workspace.context.displayName });
    }
    refresh();
    setPasteFeedback(`${rows.length} fila${rows.length === 1 ? "" : "s"} cargada${rows.length === 1 ? "" : "s"} desde Excel.`);
    window.setTimeout(() => setPasteFeedback(null), 4000);
  };

  const filtered = useMemo(() => {
    return items.filter((mp) => {
      const estado = resolveEstado(mp);
      if (estadoFilter !== "todos" && estado !== estadoFilter) return false;
      if (!search.trim()) return true;
      const q = search.trim().toLowerCase();
      return (
        mp.codigo.toLowerCase().includes(q) ||
        mp.nombre.toLowerCase().includes(q) ||
        mp.lote.toLowerCase().includes(q)
      );
    });
  }, [items, search, estadoFilter]);

  const startEdit = (mp: MateriaPrimaLot) => {
    setEditingId(mp.id);
    setDraft(mp);
  };

  const saveEdit = () => {
    if (!editingId) return;
    upsertMateriaPrima({
      id: editingId,
      codigo: draft.codigo ?? "",
      nombre: draft.nombre ?? "",
      lote: draft.lote ?? "",
      stock: Number(draft.stock) || 0,
      unidad: draft.unidad ?? "kg",
      vencimiento: draft.vencimiento ?? null,
      updatedBy: workspace.context.displayName,
    });
    setEditingId(null);
    setDraft({});
    refresh();
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

  const columns: OperationalTableColumn<MateriaPrimaLot>[] = [
    {
      key: "codigo",
      header: "Código",
      render: (r) =>
        editingId === r.id ? (
          <input
            value={draft.codigo ?? ""}
            onChange={(e) => setDraft((d) => ({ ...d, codigo: e.target.value }))}
            className="w-24 rounded border border-[var(--os-border)] px-2 py-1 text-sm"
          />
        ) : (
          <span className="font-mono text-xs">{r.codigo}</span>
        ),
    },
    {
      key: "nombre",
      header: "Materia prima",
      render: (r) =>
        editingId === r.id ? (
          <input
            value={draft.nombre ?? ""}
            onChange={(e) => setDraft((d) => ({ ...d, nombre: e.target.value }))}
            className="w-40 rounded border border-[var(--os-border)] px-2 py-1 text-sm"
          />
        ) : (
          r.nombre
        ),
    },
    {
      key: "lote",
      header: "Lote",
      render: (r) =>
        editingId === r.id ? (
          <input
            value={draft.lote ?? ""}
            onChange={(e) => setDraft((d) => ({ ...d, lote: e.target.value }))}
            className="w-24 rounded border border-[var(--os-border)] px-2 py-1 text-sm"
          />
        ) : (
          <span className="font-mono text-xs">{r.lote}</span>
        ),
    },
    {
      key: "stock",
      header: "Stock",
      render: (r) =>
        editingId === r.id ? (
          <input
            type="number"
            value={draft.stock ?? 0}
            onChange={(e) => setDraft((d) => ({ ...d, stock: Number(e.target.value) }))}
            className="w-20 rounded border border-[var(--os-border)] px-2 py-1 text-sm tabular-nums"
          />
        ) : (
          <span className="tabular-nums">{r.stock}</span>
        ),
    },
    {
      key: "unidad",
      header: "Unidad",
      render: (r) =>
        editingId === r.id ? (
          <input
            value={draft.unidad ?? ""}
            onChange={(e) => setDraft((d) => ({ ...d, unidad: e.target.value }))}
            className="w-16 rounded border border-[var(--os-border)] px-2 py-1 text-sm"
          />
        ) : (
          r.unidad
        ),
    },
    {
      key: "vencimiento",
      header: "Vencimiento",
      render: (r) =>
        editingId === r.id ? (
          <input
            type="date"
            value={draft.vencimiento ?? ""}
            onChange={(e) => setDraft((d) => ({ ...d, vencimiento: e.target.value }))}
            className="rounded border border-[var(--os-border)] px-2 py-1 text-sm"
          />
        ) : (
          r.vencimiento ?? "—"
        ),
    },
    {
      key: "estado",
      header: "Estado",
      render: (r) => <StatusChip status={resolveEstado(r)} />,
    },
    {
      key: "acciones",
      header: "Acción",
      render: (r) =>
        editingId === r.id ? (
          <div className="flex gap-2">
            <Button size="sm" variant="primary" onClick={saveEdit}>
              Guardar
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setEditingId(null)}>
              Cancelar
            </Button>
          </div>
        ) : (
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
    <div className="space-y-4">
      <header className="space-y-2">
        <h2 className="text-2xl font-semibold tracking-tight">Stock de Materias Primas</h2>
        <p className="text-sm text-[var(--os-text-muted)]">
          {workspace.sectorLabel} · {workspace.context.jobTitle}
        </p>
      </header>

      <div
        onPaste={handlePaste}
        tabIndex={0}
        role="group"
        aria-label="Área para pegar filas desde Excel"
        className="rounded-[var(--os-radius-sm)] border border-dashed border-[var(--os-teal)]/50 bg-[var(--os-teal-soft)]/30 px-4 py-3 text-xs text-[var(--os-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--os-teal)]"
      >
        Hacé clic acá y pegá (Ctrl+V) filas copiadas de Excel — Código, Materia prima, Lote, Stock,
        Unidad, Vencimiento (separadas por tabulación).
        {pasteFeedback && (
          <p className="mt-1 font-medium text-[var(--os-teal)]">{pasteFeedback}</p>
        )}
      </div>

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
        <Button variant="secondary" onClick={handleExport}>
          <Download className="mr-1.5 size-4" aria-hidden="true" />
          Exportar CSV
        </Button>
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
            removeMateriaPrima(deleteTarget.id);
            refresh();
          }
        }}
      />
    </div>
    </TwinShell>
  );
}
