"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { TwinShell } from "@/features/os/shell/twin-shell";
import { Button } from "@/components/ui/button";
import { SchemaPendingBanner } from "@/components/ui/schema-pending-banner";
import { usePreviewSession } from "@/features/os/session/preview-context";
import {
  createProductionPedidoApi,
  deleteProductionPedidoApi,
  fetchProductionPedidosApi,
  importProductionPedidosApi,
  previewProductionPedidosPasteApi,
  updateProductionPedidoApi,
} from "@/lib/production-pedidos/client";
import { computeKg, formatKg } from "@/lib/production-pedidos/kg";
import { coercePedidoFields } from "@/lib/production-pedidos/types";
import type { ColumnAssociation } from "@/lib/production-pedidos/excel-paste";
import {
  PRODUCTION_PEDIDO_STATUSES,
  PRODUCTION_PEDIDO_STATUS_LABELS,
  type ProductionPedidoInput,
  type ProductionPedidoRecord,
} from "@/lib/production-pedidos/types";

type Draft = {
  op: string;
  fecha: string;
  nroOc: string;
  cliente: string;
  producto: string;
  s: string;
  q: string;
  ml: string;
  estado: string;
};

const emptyDraft = (): Draft => ({
  op: "",
  fecha: "",
  nroOc: "",
  cliente: "",
  producto: "",
  s: "",
  q: "",
  ml: "",
  estado: "",
});

function draftFromRecord(r: ProductionPedidoRecord): Draft {
  return {
    op: r.op ?? "",
    fecha: r.fecha ?? "",
    nroOc: r.nroOc ?? "",
    cliente: r.cliente ?? "",
    producto: r.producto ?? "",
    s: r.s ?? "",
    q: r.q == null ? "" : String(r.q),
    ml: r.ml == null ? "" : String(r.ml),
    estado: r.estado ?? "",
  };
}

function draftToInput(d: Draft): ProductionPedidoInput {
  return {
    op: d.op,
    fecha: d.fecha,
    nroOc: d.nroOc,
    cliente: d.cliente,
    producto: d.producto,
    s: d.s,
    q: d.q,
    ml: d.ml,
    estado: d.estado,
  };
}

function liveKg(d: Draft): string {
  const q = d.q.trim() === "" ? null : Number(String(d.q).replace(",", "."));
  const ml = d.ml.trim() === "" ? null : Number(String(d.ml).replace(",", "."));
  return formatKg(computeKg(Number.isFinite(q as number) ? q : null, Number.isFinite(ml as number) ? ml : null));
}

type PasteRow = {
  rowIndex: number;
  op: string | null;
  fecha: string | null;
  nroOc: string | null;
  cliente: string | null;
  producto: string | null;
  s: string | null;
  q: number | null;
  ml: number | null;
  kg: number | null;
  estado: string | null;
  errors: string[];
  warnings: string[];
  valid: boolean;
};

export function ProductionPedidosView() {
  const { email, sectorId } = usePreviewSession();
  const session = useMemo(
    () => ({ email: email ?? "", sector: sectorId }),
    [email, sectorId]
  );

  const [items, setItems] = useState<ProductionPedidoRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [schemaPending, setSchemaPending] = useState(false);
  const [opQ, setOpQ] = useState("");
  const [ocQ, setOcQ] = useState("");
  const [clienteQ, setClienteQ] = useState("");
  const [productoQ, setProductoQ] = useState("");
  const [estadoQ, setEstadoQ] = useState("");
  const [fechaFrom, setFechaFrom] = useState("");
  const [fechaTo, setFechaTo] = useState("");

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft());

  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteReason, setDeleteReason] = useState("");

  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [pasteRows, setPasteRows] = useState<PasteRow[]>([]);
  const [pasteHeader, setPasteHeader] = useState(false);
  const [pasteMode, setPasteMode] = useState<"by-header" | "by-position">("by-position");
  const [pasteAssociations, setPasteAssociations] = useState<ColumnAssociation[]>([]);
  const [pasteSummary, setPasteSummary] = useState("");
  const [pasteMissing, setPasteMissing] = useState<string[]>([]);
  const [forcePosition, setForcePosition] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);
  const [importIdempotencyKey, setImportIdempotencyKey] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const { items: list, schemaPending: pending } = await fetchProductionPedidosApi(session, {
        op: opQ,
        nroOc: ocQ,
        cliente: clienteQ,
        producto: productoQ,
        estado: estadoQ || undefined,
        fechaFrom: fechaFrom || undefined,
        fechaTo: fechaTo || undefined,
      });
      setItems(list);
      setSchemaPending(pending);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar pedidos");
    }
  }, [session, opQ, ocQ, clienteQ, productoQ, estadoQ, fechaFrom, fechaTo]);

  useEffect(() => {
    void reload();
  }, [reload]);

  function openNew() {
    setEditingId(null);
    setDraft(emptyDraft());
    setEditorOpen(true);
  }

  function openEdit(r: ProductionPedidoRecord) {
    setEditingId(r.id);
    setDraft(draftFromRecord(r));
    setEditorOpen(true);
  }

  async function saveEditor() {
    try {
      const input = draftToInput(draft);
      if (editingId) await updateProductionPedidoApi(session, editingId, input);
      else await createProductionPedidoApi(session, input);
      setEditorOpen(false);
      void reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar");
    }
  }

  async function confirmDelete() {
    if (!deleteId) return;
    try {
      await deleteProductionPedidoApi(session, deleteId, deleteReason);
      setDeleteId(null);
      setDeleteReason("");
      void reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo eliminar");
    }
  }

  async function runPastePreview(opts?: { forcePosition?: boolean }) {
    try {
      const force = opts?.forcePosition ?? forcePosition;
      const preview = await previewProductionPedidosPasteApi(session, pasteText, {
        forcePosition: force,
      });
      setPasteRows(preview.rows);
      setPasteHeader(preview.headerDetected);
      setPasteMode(preview.mode);
      setPasteAssociations(preview.associations);
      setPasteSummary(preview.summary);
      setPasteMissing(preview.missingFields);
      setForcePosition(force);
      setImportResult(null);
      setImportIdempotencyKey(
        `ped-import-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
      );
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al parsear pegado");
    }
  }

  async function confirmImport() {
    const valid = pasteRows.filter((r) => r.valid);
    if (!valid.length || importing) {
      setError("No hay filas válidas para importar");
      return;
    }
    const key =
      importIdempotencyKey ??
      `ped-import-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    setImporting(true);
    setImportResult(null);
    try {
      const result = await importProductionPedidosApi(
        session,
        valid.map((r) => ({
          op: r.op,
          fecha: r.fecha,
          nroOc: r.nroOc,
          cliente: r.cliente,
          producto: r.producto,
          s: r.s,
          q: r.q,
          ml: r.ml,
          estado: r.estado,
        })),
        key
      );
      setImportResult(
        `Insertados: ${result.inserted} · Rechazados: ${result.rejected} · Duplicados advertidos: ${result.duplicateWarnings}${
          result.idempotentReplay ? " · (reintento idempotente)" : ""
        }`
      );
      setPasteOpen(false);
      setPasteText("");
      setPasteRows([]);
      setPasteAssociations([]);
      setError(null);
      void reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo importar");
      // Conserve pasteText, pasteRows, corrections; keep modal open.
    } finally {
      setImporting(false);
    }
  }

  function updatePasteRow(idx: number, patch: Partial<PasteRow>) {
    setPasteRows((prev) =>
      prev.map((r, i) => {
        if (i !== idx) return r;
        const merged = { ...r, ...patch };
        const coerced = coercePedidoFields({
          op: merged.op,
          fecha: merged.fecha,
          nroOc: merged.nroOc,
          cliente: merged.cliente,
          producto: merged.producto,
          s: merged.s,
          q: merged.q,
          ml: merged.ml,
          estado: merged.estado,
        });
        return {
          ...merged,
          op: coerced.op,
          fecha: coerced.fecha,
          nroOc: coerced.nroOc,
          cliente: coerced.cliente,
          producto: coerced.producto,
          s: coerced.s,
          q: coerced.q,
          ml: coerced.ml,
          kg: coerced.kg,
          estado: coerced.estado,
          errors: coerced.errors,
          valid: coerced.errors.length === 0,
        };
      })
    );
  }

  const validPasteCount = pasteRows.filter((r) => r.valid).length;

  return (
    <TwinShell title="Pedidos">
      <div
        data-genus-production-pedidos
        className="os-page-pad mx-auto min-h-full w-full max-w-[var(--os-content-max,1400px)] space-y-4 overflow-x-hidden bg-transparent"
      >
        {schemaPending && <SchemaPendingBanner show />}
        {error && (
          <div role="alert" className="rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
            {error}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button type="button" className="os-btn-motion min-h-10" onClick={openNew}>
            Nuevo pedido
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="os-btn-motion min-h-10"
            onClick={() => {
              setPasteOpen(true);
              setPasteRows([]);
              setPasteText("");
              setPasteAssociations([]);
              setPasteSummary("");
              setImportResult(null);
              setForcePosition(false);
              setError(null);
            }}
          >
            Pegar desde Excel
          </Button>
        </div>

        {importResult && (
          <div className="rounded border border-[var(--os-teal)]/40 bg-[var(--os-teal)]/10 px-3 py-2 text-sm">
            {importResult}
          </div>
        )}

        <div className="grid gap-2 md:grid-cols-3 lg:grid-cols-6">
          <input
            className="min-h-10 rounded border border-[var(--os-border)] bg-transparent px-2 text-sm"
            placeholder="Buscar OP"
            value={opQ}
            onChange={(e) => setOpQ(e.target.value)}
          />
          <input
            className="min-h-10 rounded border border-[var(--os-border)] bg-transparent px-2 text-sm"
            placeholder="Buscar N.º OC"
            value={ocQ}
            onChange={(e) => setOcQ(e.target.value)}
          />
          <input
            className="min-h-10 rounded border border-[var(--os-border)] bg-transparent px-2 text-sm"
            placeholder="Buscar cliente"
            value={clienteQ}
            onChange={(e) => setClienteQ(e.target.value)}
          />
          <input
            className="min-h-10 rounded border border-[var(--os-border)] bg-transparent px-2 text-sm"
            placeholder="Buscar producto"
            value={productoQ}
            onChange={(e) => setProductoQ(e.target.value)}
          />
          <select
            className="min-h-10 rounded border border-[var(--os-border)] bg-transparent px-2 text-sm"
            value={estadoQ}
            onChange={(e) => setEstadoQ(e.target.value)}
          >
            <option value="">Todos los estados</option>
            {PRODUCTION_PEDIDO_STATUSES.map((s) => (
              <option key={s} value={s}>
                {PRODUCTION_PEDIDO_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
          <div className="flex gap-1">
            <input
              type="date"
              className="min-h-10 w-full rounded border border-[var(--os-border)] bg-transparent px-2 text-sm"
              value={fechaFrom}
              onChange={(e) => setFechaFrom(e.target.value)}
              aria-label="Fecha desde"
            />
            <input
              type="date"
              className="min-h-10 w-full rounded border border-[var(--os-border)] bg-transparent px-2 text-sm"
              value={fechaTo}
              onChange={(e) => setFechaTo(e.target.value)}
              aria-label="Fecha hasta"
            />
          </div>
        </div>

        {/* Desktop table */}
        <div className="hidden overflow-x-hidden lg:block">
          <table className="os-table w-full min-w-0 table-fixed text-left text-sm">
            <thead>
              <tr>
                {["OP", "FECHA", "N.º OC", "CLIENTE", "PRODUCTO", "S", "Q", "ML", "KG", "ESTADO", ""].map(
                  (h) => (
                    <th key={h || "actions"} className="os-table-th truncate px-2 py-2">
                      {h}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.id} className="border-t border-[var(--os-border)]/60">
                  <td className="os-table-td os-mono-id truncate px-2 py-2">{r.op}</td>
                  <td className="os-table-td truncate px-2 py-2">{r.fecha}</td>
                  <td className="os-table-td os-mono-id truncate px-2 py-2">{r.nroOc}</td>
                  <td className="os-table-td truncate px-2 py-2" title={r.cliente ?? ""}>
                    {r.cliente}
                  </td>
                  <td className="os-table-td truncate px-2 py-2" title={r.producto ?? ""}>
                    {r.producto}
                  </td>
                  <td className="os-table-td truncate px-2 py-2">{r.s}</td>
                  <td className="os-table-td truncate px-2 py-2">{r.q}</td>
                  <td className="os-table-td truncate px-2 py-2">{r.ml}</td>
                  <td className="os-table-td truncate px-2 py-2 font-semibold text-[var(--os-teal)]">
                    {r.kgDisplay}
                  </td>
                  <td className="os-table-td truncate px-2 py-2">
                    {r.estado ? PRODUCTION_PEDIDO_STATUS_LABELS[r.estado] : ""}
                  </td>
                  <td className="os-table-td px-2 py-2">
                    <div className="os-row-actions flex gap-1">
                      <button type="button" className="text-xs underline" onClick={() => openEdit(r)}>
                        Editar
                      </button>
                      <button
                        type="button"
                        className="text-xs underline text-amber-300"
                        onClick={() => {
                          setDeleteId(r.id);
                          setDeleteReason("");
                        }}
                      >
                        Eliminar
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!items.length && (
                <tr>
                  <td colSpan={11} className="px-2 py-6 text-center text-[var(--os-text-muted)]">
                    Sin pedidos
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Tablet: compact + más datos */}
        <div className="hidden space-y-2 md:block lg:hidden">
          {items.map((r) => (
            <div key={r.id} className="os-glass-panel rounded border border-[var(--os-border)] p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-semibold">
                    {r.op || "—"} · {r.producto || "Sin producto"}
                  </p>
                  <p className="truncate text-xs text-[var(--os-text-muted)]">
                    {r.cliente} · Q {r.q ?? "—"} · ML {r.ml ?? "—"} ·{" "}
                    <span className="font-semibold text-[var(--os-teal)]">KG {r.kgDisplay || "—"}</span>
                  </p>
                </div>
                <span className="shrink-0 text-xs">
                  {r.estado ? PRODUCTION_PEDIDO_STATUS_LABELS[r.estado] : ""}
                </span>
              </div>
              <button
                type="button"
                className="mt-2 text-xs underline"
                onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}
              >
                Más datos
              </button>
              {expandedId === r.id && (
                <div className="mt-2 grid grid-cols-2 gap-1 text-xs text-[var(--os-text-muted)]">
                  <span>FECHA: {r.fecha || "—"}</span>
                  <span>N.º OC: {r.nroOc || "—"}</span>
                  <span>S: {r.s || "—"}</span>
                  <span>Creado: {r.createdBy || "—"}</span>
                </div>
              )}
              <div className="mt-2 flex gap-3 text-xs">
                <button type="button" className="underline" onClick={() => openEdit(r)}>
                  Editar
                </button>
                <button
                  type="button"
                  className="underline text-amber-300"
                  onClick={() => {
                    setDeleteId(r.id);
                    setDeleteReason("");
                  }}
                >
                  Eliminar
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Mobile cards */}
        <div className="space-y-2 md:hidden">
          {items.map((r) => (
            <article key={r.id} className="os-glass-panel rounded border border-[var(--os-border)] p-3">
              <header className="mb-2 flex items-center justify-between gap-2">
                <strong className="truncate">{r.op || "Sin OP"}</strong>
                <span className="text-xs">
                  {r.estado ? PRODUCTION_PEDIDO_STATUS_LABELS[r.estado] : ""}
                </span>
              </header>
              <p className="truncate text-sm">{r.producto}</p>
              <p className="truncate text-xs text-[var(--os-text-muted)]">{r.cliente}</p>
              <p className="mt-2 text-sm">
                Q {r.q ?? "—"} · ML {r.ml ?? "—"} ·{" "}
                <span className="font-semibold text-[var(--os-teal)]">KG {r.kgDisplay || "—"}</span>
              </p>
              <div className="mt-2 flex gap-3 text-xs">
                <button type="button" className="underline" onClick={() => openEdit(r)}>
                  Editar
                </button>
                <button
                  type="button"
                  className="underline text-amber-300"
                  onClick={() => {
                    setDeleteId(r.id);
                    setDeleteReason("");
                  }}
                >
                  Eliminar
                </button>
              </div>
            </article>
          ))}
        </div>

        {editorOpen && (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-[var(--os-navy)]/50 p-4 sm:items-center">
            <div className="os-modal-in max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded border border-[var(--os-border)] bg-[var(--os-surface)] p-4">
              <h3 className="mb-3 text-lg font-semibold">{editingId ? "Editar pedido" : "Nuevo pedido"}</h3>
              <div className="grid gap-2 sm:grid-cols-2">
                {(
                  [
                    ["op", "OP"],
                    ["fecha", "FECHA"],
                    ["nroOc", "N.º OC"],
                    ["cliente", "CLIENTE"],
                    ["producto", "PRODUCTO"],
                    ["s", "S"],
                    ["q", "Q"],
                    ["ml", "ML"],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className="block text-xs">
                    <span className="mb-1 block text-[var(--os-text-muted)]">{label}</span>
                    <input
                      type={key === "fecha" ? "date" : "text"}
                      className="min-h-10 w-full rounded border border-[var(--os-border)] bg-transparent px-2 text-sm"
                      value={draft[key]}
                      onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                    />
                  </label>
                ))}
                <label className="block text-xs">
                  <span className="mb-1 block text-[var(--os-text-muted)]">KG (automático)</span>
                  <input
                    readOnly
                    className="min-h-10 w-full rounded border border-[var(--os-border)] bg-[var(--os-bg)]/40 px-2 text-sm font-semibold text-[var(--os-teal)]"
                    value={liveKg(draft)}
                  />
                </label>
                <label className="block text-xs">
                  <span className="mb-1 block text-[var(--os-text-muted)]">ESTADO</span>
                  <select
                    className="min-h-10 w-full rounded border border-[var(--os-border)] bg-transparent px-2 text-sm"
                    value={draft.estado}
                    onChange={(e) => setDraft((d) => ({ ...d, estado: e.target.value }))}
                  >
                    <option value="">—</option>
                    {PRODUCTION_PEDIDO_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {PRODUCTION_PEDIDO_STATUS_LABELS[s]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <Button type="button" variant="secondary" onClick={() => setEditorOpen(false)}>
                  Cancelar
                </Button>
                <Button type="button" onClick={() => void saveEditor()}>
                  Guardar
                </Button>
              </div>
            </div>
          </div>
        )}

        {pasteOpen && (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-[var(--os-navy)]/50 p-4 sm:items-center">
            <div className="os-modal-in flex max-h-[92dvh] w-full max-w-4xl flex-col overflow-hidden rounded border border-[var(--os-border)] bg-[var(--os-surface)] p-4">
              <h3 className="mb-2 text-lg font-semibold">Pegar desde Excel</h3>
              <p className="mb-2 text-xs text-[var(--os-text-muted)]">
                Con encabezados: cada columna se asocia por su título (el orden no importa). Sin
                encabezados: usá el orden estándar OP | FECHA | N.º OC | CLIENTE | PRODUCTO | S | Q |
                ML | ESTADO. KG siempre se recalcula.
              </p>
              <textarea
                className="min-h-28 w-full rounded border border-[var(--os-border)] bg-transparent p-2 font-mono text-xs"
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder="Pegá filas aquí…"
                disabled={importing}
              />
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={importing || !pasteText.trim()}
                  onClick={() => void runPastePreview({ forcePosition: false })}
                >
                  Vista previa
                </Button>
                {!pasteHeader && pasteRows.length > 0 && pasteMode === "by-position" && (
                  <span className="self-center text-xs text-amber-200">
                    Sin encabezados — pegado por orden estándar
                  </span>
                )}
                {pasteHeader && (
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={importing}
                    onClick={() => void runPastePreview({ forcePosition: true })}
                  >
                    Pegar por orden estándar
                  </Button>
                )}
                <Button
                  type="button"
                  disabled={importing || validPasteCount < 1}
                  onClick={() => void confirmImport()}
                >
                  {importing
                    ? "Importando…"
                    : validPasteCount > 0
                      ? `Importar ${validPasteCount} pedido${validPasteCount === 1 ? "" : "s"}`
                      : "Confirmar importación"}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={importing}
                  onClick={() => {
                    setPasteOpen(false);
                    setPasteRows([]);
                  }}
                >
                  Cancelar
                </Button>
              </div>
              {pasteSummary && (
                <p className="mt-2 text-xs text-[var(--os-teal)]">{pasteSummary}</p>
              )}
              {pasteAssociations.length > 0 && (
                <div className="mt-3 rounded border border-[var(--os-border)] p-2">
                  <p className="mb-1 text-sm font-semibold">Asociación de columnas</p>
                  <ul className="grid gap-1 text-xs sm:grid-cols-2">
                    {pasteAssociations.map((a) => (
                      <li key={`${a.sourceIndex}-${a.sourceHeader}`}>
                        <span className="text-[var(--os-text-muted)]">
                          “{a.sourceHeader || "(vacío)"}”
                        </span>{" "}
                        →{" "}
                        <span
                          className={
                            a.status === "ignored"
                              ? "text-amber-200"
                              : a.status === "conflict"
                                ? "text-amber-300"
                                : "text-[var(--os-text)]"
                          }
                        >
                          {a.status === "ignored"
                            ? "No utilizada"
                            : a.status === "conflict"
                              ? `${a.label} (conflicto)`
                              : a.label}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {pasteMissing.length > 0 && pasteHeader && (
                    <p className="mt-1 text-xs text-[var(--os-text-muted)]">
                      Columnas Genus no presentes (quedarán vacías): {pasteMissing.join(", ")}
                    </p>
                  )}
                </div>
              )}
              {pasteRows.length > 0 && (
                <div className="mt-3 min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
                  <table className="w-full table-fixed text-left text-xs">
                    <thead>
                      <tr>
                        {["#", "OP", "FECHA", "OC", "CLIENTE", "PROD", "Q", "ML", "KG", "EST", "!"].map(
                          (h) => (
                            <th key={h} className="truncate px-1 py-1">
                              {h}
                            </th>
                          )
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {pasteRows.map((r, idx) => (
                        <tr
                          key={r.rowIndex}
                          className={
                            r.errors.length
                              ? "bg-amber-500/10"
                              : r.warnings.length
                                ? "bg-[var(--os-teal)]/5"
                                : ""
                          }
                        >
                          <td className="px-1 py-1">{r.rowIndex}</td>
                          <td className="px-1 py-1">
                            <input
                              className="w-full bg-transparent"
                              value={r.op ?? ""}
                              disabled={importing}
                              onChange={(e) => updatePasteRow(idx, { op: e.target.value || null })}
                            />
                          </td>
                          <td className="px-1 py-1">
                            <input
                              className="w-full bg-transparent"
                              value={r.fecha ?? ""}
                              disabled={importing}
                              onChange={(e) => updatePasteRow(idx, { fecha: e.target.value || null })}
                            />
                          </td>
                          <td className="px-1 py-1">
                            <input
                              className="w-full bg-transparent"
                              value={r.nroOc ?? ""}
                              disabled={importing}
                              onChange={(e) => updatePasteRow(idx, { nroOc: e.target.value || null })}
                            />
                          </td>
                          <td className="truncate px-1 py-1">{r.cliente}</td>
                          <td className="truncate px-1 py-1">{r.producto}</td>
                          <td className="px-1 py-1">
                            <input
                              className="w-full bg-transparent"
                              value={r.q ?? ""}
                              disabled={importing}
                              onChange={(e) => {
                                const q =
                                  e.target.value.trim() === ""
                                    ? null
                                    : Number(e.target.value.replace(",", "."));
                                updatePasteRow(idx, {
                                  q: q != null && Number.isFinite(q) ? q : null,
                                });
                              }}
                            />
                          </td>
                          <td className="px-1 py-1">
                            <input
                              className="w-full bg-transparent"
                              value={r.ml ?? ""}
                              disabled={importing}
                              onChange={(e) => {
                                const ml =
                                  e.target.value.trim() === ""
                                    ? null
                                    : Number(e.target.value.replace(",", "."));
                                updatePasteRow(idx, {
                                  ml: ml != null && Number.isFinite(ml) ? ml : null,
                                });
                              }}
                            />
                          </td>
                          <td className="px-1 py-1 font-semibold text-[var(--os-teal)]">
                            {formatKg(r.kg)}
                          </td>
                          <td className="px-1 py-1">{r.estado}</td>
                          <td
                            className="px-1 py-1 text-amber-300"
                            title={[...r.errors, ...r.warnings].join("; ")}
                          >
                            {r.errors[0] || r.warnings[0] || ""}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {deleteId && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--os-navy)]/50 p-4">
            <div className="os-modal-in w-full max-w-md rounded border border-[var(--os-border)] bg-[var(--os-surface)] p-4">
              <h3 className="text-lg font-semibold">¿Eliminar pedido?</h3>
              <p className="mt-1 text-sm text-[var(--os-text-muted)]">
                La eliminación conserva auditoría. Indicá un motivo (mín. 3 caracteres).
              </p>
              <textarea
                className="mt-3 min-h-20 w-full rounded border border-[var(--os-border)] bg-transparent p-2 text-sm"
                value={deleteReason}
                onChange={(e) => setDeleteReason(e.target.value)}
                placeholder="Motivo"
              />
              <div className="mt-3 flex justify-end gap-2">
                <Button type="button" variant="secondary" onClick={() => setDeleteId(null)}>
                  Cancelar
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={deleteReason.trim().length < 3}
                  onClick={() => void confirmDelete()}
                >
                  Eliminar
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </TwinShell>
  );
}
