"use client";

import { useState } from "react";
import { usePreviewSession } from "@/features/os/session/preview-context";
import { fmtQty, postCodedProgress, type CodificadoTransferView } from "./codificado-transfer-client";

const Row = ({ label, value, strong, testid }: { label: string; value: string; strong?: boolean; testid?: string }) => (
  <div className="flex items-baseline justify-between gap-3">
    <dt className="text-[var(--os-text-muted)]">{label}</dt>
    <dd className={`tabular-nums ${strong ? "font-semibold" : ""}`} data-testid={testid}>{value}</dd>
  </div>
);

function Entregas({ view }: { view: CodificadoTransferView }) {
  if (!view.transfers.length) return <p className="text-xs text-[var(--os-text-muted)]">Todavía no hubo entregas a Codificado.</p>;
  return (
    <ul className="space-y-1 text-xs" data-testid="cod-transfer-list">
      {view.transfers.map((t) => (
        <li key={t.id} className="flex flex-wrap justify-between gap-2 rounded border border-[var(--os-border)] px-2 py-1" data-testid="cod-transfer-row">
          <span>#{t.seq} · <strong>{fmtQty(t.quantity)}</strong> un. · acumulado {fmtQty(t.cumulative)}</span>
          <span className="text-[var(--os-text-muted)]">{new Date(t.deliveredAt).toLocaleString("es-AR")} · {t.deliveredByName ?? t.deliveredBy}{t.lote ? ` · Lote ${t.lote}` : ""}</span>
        </li>
      ))}
    </ul>
  );
}

/** Envasado: cantidades del trabajo respecto de Codificado (asignada, terminada, entregada a Codificado, pendiente de entrega). */
export function EnvasadoCodificadoSummary({ view }: { view: CodificadoTransferView }) {
  const s = view.summary;
  return (
    <section className="space-y-2 rounded border border-[var(--os-border)] p-3 text-sm" data-testid="envasado-cod-summary" aria-label="Entregas a Codificado">
      <h4 className="text-xs font-semibold uppercase text-[var(--os-text-muted)]">Entregas a Codificado</h4>
      <dl className="space-y-0.5">
        <Row label="Cantidad asignada" value={fmtQty(s.assigned)} testid="env-assigned" />
        <Row label="Cantidad terminada" value={fmtQty(s.produced)} testid="env-produced" />
        <Row label="Entregada a Codificado" value={fmtQty(s.transferred)} strong testid="env-transferred" />
        <Row label="Pendiente de entrega" value={fmtQty(s.pendingToTransfer)} strong testid="env-pending" />
      </dl>
      <Entregas view={view} />
    </section>
  );
}

/**
 * Codificado: lo recibido desde Envasado y su avance. Codificado registra cuántas unidades ya codificó (nunca más que las recibidas);
 * Producción y Dirección lo consultan sin poder modificarlo.
 */
export function CodificadoReceivedPanel({ view, onChanged }: { view: CodificadoTransferView; onChanged: (v: CodificadoTransferView) => void }) {
  const { email, sectorId } = usePreviewSession();
  const canWork = String(sectorId).toUpperCase() === "CODIFICADO";
  const s = view.summary;
  const [coded, setCoded] = useState(String(s.coded));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setBusy(true);
    setError(null);
    try {
      const n = Number(coded.replace(",", "."));
      onChanged(await postCodedProgress({ email, sector: sectorId }, view.childId ?? "", n));
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-2 rounded border border-[var(--os-border)] p-3 text-sm" data-testid="cod-received-panel" aria-label="Recibido desde Envasado">
      <h4 className="text-xs font-semibold uppercase text-[var(--os-text-muted)]">Recibido desde Envasado · {view.originSector === "ENVASADO_PREMIUM" ? "Envasado Premium" : "Envasado Masivo"}</h4>
      <dl className="space-y-0.5">
        <Row label="Cantidad total recibida" value={fmtQty(s.received)} strong testid="cod-received" />
        <Row label="Cantidad codificada" value={fmtQty(s.coded)} testid="cod-coded" />
        <Row label="Pendiente de codificar" value={fmtQty(s.pendingToCode)} strong testid="cod-pending-code" />
        <Row label="Todavía no recibida" value={fmtQty(s.notYetReceived)} testid="cod-not-received" />
      </dl>
      {canWork ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs">
            Unidades codificadas (total)
            <input className="mt-1 block w-32 rounded border border-[var(--os-border)] px-2 py-1 text-right tabular-nums" inputMode="numeric" value={coded} onChange={(e) => setCoded(e.target.value)} data-testid="cod-coded-input" />
          </label>
          <button type="button" className="rounded border border-[var(--os-border)] px-3 py-1.5 text-sm font-medium disabled:opacity-60" disabled={busy} onClick={() => void save()} data-testid="cod-coded-save">Guardar avance de codificado</button>
        </div>
      ) : null}
      {error ? <p role="alert" className="text-xs text-[var(--genus-error,#b91c1c)]">{error}</p> : null}
      <Entregas view={view} />
    </section>
  );
}
