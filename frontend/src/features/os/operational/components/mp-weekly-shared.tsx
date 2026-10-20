"use client";

/** Piezas compartidas del Control semanal de MP (vista por producto y consolidado). */
import { useState } from "react";
import type { WeeklyRow } from "@/lib/mp-control/weekly-availability-service";

export const GESTION_LABEL: Record<string, string> = {
  "": "— Sin decisión —",
  pendiente: "Pendiente",
  comprar: "Comprar",
  compra_solicitada: "Compra solicitada",
  no_comprar: "No comprar",
  sustituir: "Sustituir",
  aporta_cliente: "Aporta el cliente",
  resuelto: "Resuelto",
};
export const fmtWhen = (iso: string | null) => (iso ? new Date(iso).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" }) : "");

/** Observación general por MP y semana: se guarda al salir del campo o con «Guardar»; crece según el texto. */
export function NoteCell({ row, canEdit, onSave }: { row: Pick<WeeklyRow, "state" | "key">; canEdit: boolean; onSave: (row: never, text: string) => Promise<void> }) {
  const saved = row.state.observacion;
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const value = draft ?? saved;
  const dirty = draft !== null && draft !== saved;
  async function commit() {
    if (!dirty || saving) return;
    setSaving(true);
    try {
      await onSave(row as never, draft!);
      setDraft(null);
    } finally {
      setSaving(false);
    }
  }
  return (
    <div onClick={(e) => e.stopPropagation()} data-testid="mpw-note">
      {canEdit ? (
        <>
          <textarea
            value={value}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => void commit()}
            rows={Math.min(8, Math.max(2, Math.ceil(value.length / 28) + (value.match(/\n/g)?.length ?? 0)))}
            placeholder="Observación (compras, sustitución…)"
            className="w-full resize-y rounded border border-[var(--os-border)] bg-transparent px-1.5 py-1 text-xs leading-snug"
            data-testid="mpw-note-input"
          />
          {dirty ? (
            <button type="button" className="mt-1 min-h-9 rounded border border-[var(--os-teal)] px-3 text-[11px] text-[var(--os-teal)]" onMouseDown={(e) => e.preventDefault()} onClick={() => void commit()} data-testid="mpw-note-save">
              {saving ? "Guardando…" : "Guardar"}
            </button>
          ) : null}
        </>
      ) : (
        <p className="whitespace-pre-wrap break-words text-xs">{saved || "—"}</p>
      )}
      {saved && row.state.observacionBy ? <p className="mt-0.5 text-[10px] text-[var(--os-text-muted)]" data-testid="mpw-note-meta">{row.state.observacionBy} · {fmtWhen(row.state.observacionAt)}</p> : null}
    </div>
  );
}

export function GestionSelect({ row, canEdit, onSave }: { row: Pick<WeeklyRow, "state" | "key">; canEdit: boolean; onSave: (row: never, gestion: string) => Promise<void> }) {
  return (
    <div onClick={(e) => e.stopPropagation()}>
      {canEdit ? (
        <select value={row.state.gestion} onChange={(e) => void onSave(row as never, e.target.value)} className="min-h-10 w-full rounded border border-[var(--os-border)] bg-[var(--os-surface)] px-1 text-xs" data-testid="mpw-gestion">
          {Object.entries(GESTION_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      ) : (
        <span className="text-xs">{GESTION_LABEL[row.state.gestion] ?? "—"}</span>
      )}
      {row.state.gestion && row.state.gestionBy ? <p className="mt-0.5 text-[10px] text-[var(--os-text-muted)]">{row.state.gestionBy} · {fmtWhen(row.state.gestionAt)}</p> : null}
    </div>
  );
}
