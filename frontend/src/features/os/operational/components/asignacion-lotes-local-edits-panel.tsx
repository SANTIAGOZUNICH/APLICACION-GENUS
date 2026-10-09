"use client";

/**
 * 0043 — Ediciones de GENUS sobre lotes sincronizados desde Google Sheets.
 * Muestra primero los CONFLICTOS (la planilla cambió un dato que GENUS había corregido, o la fila ya no está en la
 * planilla) con la decisión explícita, y después las ediciones vigentes (con «volver al valor de la planilla»).
 * Nunca se elige en silencio: cada decisión queda auditada y respeta la versión del registro.
 */
import { useMemo, useState } from "react";
import { AlertTriangle, Check, RotateCcw } from "lucide-react";
import { resolveAsignacionLocalEditApi } from "@/lib/asignacion-lotes/asignacion-lotes-client";
import type { AsignacionLote } from "@/lib/asignacion-lotes/types";
import type { OrdersClientSession } from "@/lib/orders/orders-client";

const FIELD_LABEL: Record<string, string> = {
  lote: "Lote", fecha: "Fecha", producto: "Producto", codigo: "Código", marca: "Marca / cliente", cantidades: "Cantidades", vto: "Vencimiento",
  muestras: "Muestras", cjMuestra: "Cj. muestra", fechaAnalisis: "Fecha de análisis", observaciones: "Observaciones", __row__: "Fila",
};
type Action = "KEEP_GENUS" | "USE_SHEET" | "REVERT_TO_SHEET" | "ARCHIVE";

export function AsignacionLotesLocalEditsPanel({ rows, session, canEdit, onResolved }: { rows: AsignacionLote[]; session: OrdersClientSession; canEdit: boolean; onResolved: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const entries = useMemo(
    () =>
      rows.flatMap((r) => Object.entries(r.localEdits ?? {}).map(([field, e]) => ({ row: r, field, e }))).sort((a, b) => Number(b.e.status === "CONFLICT") - Number(a.e.status === "CONFLICT")),
    [rows]
  );
  const conflicts = entries.filter((x) => x.e.status === "CONFLICT");
  if (entries.length === 0) return null;

  const act = async (row: AsignacionLote, editId: string, action: Action) => {
    setBusy(editId + action);
    setError(null);
    try {
      await resolveAsignacionLocalEditApi(session, { editId, action, expectedVersion: row.updatedAt });
      onResolved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar la decisión.");
    } finally {
      setBusy(null);
    }
  };
  const shown = open || conflicts.length > 0 ? entries : [];
  return (
    <section className={`rounded-[var(--os-radius)] border px-3 py-2 text-sm ${conflicts.length ? "border-amber-400/50 bg-amber-400/10" : "border-[var(--os-border)] bg-[var(--os-surface)]"}`} data-testid="lotes-local-edits-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 font-semibold">
          {conflicts.length > 0 && <AlertTriangle className="size-4 text-amber-400" aria-hidden="true" />}
          {conflicts.length > 0 ? `${conflicts.length} conflicto(s) con la planilla · ` : ""}
          {entries.length - conflicts.length} dato(s) editado(s) en GENUS sobre filas de Google
        </p>
        {conflicts.length === 0 && (
          <button type="button" className="text-xs font-semibold text-[var(--os-teal)] hover:underline" onClick={() => setOpen((o) => !o)} data-testid="lotes-local-edits-toggle">
            {open ? "Ocultar" : "Ver detalle"}
          </button>
        )}
      </div>
      <p className="mt-0.5 text-xs text-[var(--os-text-muted)]">
        Estos cambios viven en GENUS: la sincronización con Google Sheets no los pisa. La planilla original no se modifica.
      </p>
      {error && <p className="mt-1 text-xs text-red-400" role="alert">{error}</p>}
      {shown.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {shown.map(({ row, field, e }) => (
            <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--os-border)] bg-[var(--os-bg)] px-2 py-1.5" data-testid="lotes-local-edit" data-status={e.status} data-field={field}>
              <span className="min-w-0">
                <b>{row.lote}</b> · {row.producto} · <span className="text-[var(--os-text-muted)]">{FIELD_LABEL[field] ?? field}</span>
                {field === "__row__" ? (
                  <span className="ml-1 text-amber-300"> — {e.conflictSheetValue}</span>
                ) : e.status === "CONFLICT" ? (
                  <span className="ml-1">
                    — GENUS: <b>{e.localValue || "—"}</b> · planilla ahora: <b className="text-amber-300">{e.conflictSheetValue || "—"}</b>
                  </span>
                ) : (
                  <span className="ml-1 text-[var(--os-text-muted)]">
                    — GENUS: <b className="text-[var(--os-text)]">{e.localValue || "—"}</b> (planilla: {e.sheetValue || "—"}) · {e.editedBy}
                  </span>
                )}
              </span>
              {canEdit && (
                <span className="flex flex-wrap gap-1">
                  {field === "__row__" ? (
                    <>
                      <Btn onClick={() => act(row, e.id, "KEEP_GENUS")} busy={busy === e.id + "KEEP_GENUS"} testId="local-edit-keep">Conservar en GENUS</Btn>
                      <Btn onClick={() => act(row, e.id, "ARCHIVE")} busy={busy === e.id + "ARCHIVE"} testId="local-edit-archive" muted>Archivar</Btn>
                    </>
                  ) : e.status === "CONFLICT" ? (
                    <>
                      <Btn onClick={() => act(row, e.id, "KEEP_GENUS")} busy={busy === e.id + "KEEP_GENUS"} testId="local-edit-keep"><Check className="size-3" aria-hidden="true" /> Mantener GENUS</Btn>
                      <Btn onClick={() => act(row, e.id, "USE_SHEET")} busy={busy === e.id + "USE_SHEET"} testId="local-edit-use-sheet" muted>Usar planilla</Btn>
                    </>
                  ) : (
                    <Btn onClick={() => act(row, e.id, "REVERT_TO_SHEET")} busy={busy === e.id + "REVERT_TO_SHEET"} testId="local-edit-revert" muted><RotateCcw className="size-3" aria-hidden="true" /> Volver a la planilla</Btn>
                  )}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Btn({ children, onClick, busy, muted, testId }: { children: React.ReactNode; onClick: () => void; busy: boolean; muted?: boolean; testId: string }) {
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onClick}
      data-testid={testId}
      className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold disabled:opacity-50 ${muted ? "border border-[var(--os-border)] text-[var(--os-text)] hover:bg-[var(--os-surface)]" : "bg-[var(--os-teal)] text-[#04201e]"}`}
    >
      {busy ? "Guardando…" : children}
    </button>
  );
}
