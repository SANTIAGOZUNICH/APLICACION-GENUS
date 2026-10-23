"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchMeDiferenciaCandidatos, fetchMeDiferencias, InventoryClientError, postMeDiferenciaLink } from "@/features/os/operational/adapters/inventory-client";
import { computeMeDiferencia, formatMeDiferencia, meDiferenciaTone, type MeDiferencia, type MeDiferenciaRow } from "@/lib/inventory/me-diferencia";

const TONE: Record<"red" | "green" | "neutral", string> = {
  red: "font-semibold text-red-600",
  green: "font-semibold text-emerald-600",
  neutral: "text-[var(--os-text-muted)]",
};

/** DIFERENCIA por material (id) ya calculada por el servidor con el mismo stock que STOCK ME. */
export function useMeDiferencias() {
  const [map, setMap] = useState<Record<string, MeDiferenciaRow>>({});
  const reload = useCallback(async () => {
    try {
      setMap(await fetchMeDiferencias());
    } catch {
      /* sin DIFERENCIA no se rompe la planilla: la columna queda en SIN DATOS */
    }
  }, []);
  useEffect(() => {
    queueMicrotask(() => void reload());
  }, [reload]);
  return { map, reload };
}

/**
 * DIFERENCIA de un material. `extraStock` = ingreso todavía sin confirmar (borrador): se muestra la diferencia PREVISTA sin
 * tocar el stock. El editor de vínculo (pedido + consumo por producto) solo aparece para quien puede escribir ME.
 */
export function MeDiferenciaCell({ materialId, row, canLink, extraStock = 0, onChanged }: { materialId: string | null | undefined; row: MeDiferenciaRow | undefined; canLink: boolean; extraStock?: number; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const prevista = extraStock !== 0;
  const d: Pick<MeDiferencia, "estado" | "diferencia"> = row
    ? prevista
      ? computeMeDiferencia(row.stock + extraStock, row.pedidos.map((p) => ({ pedidoId: p.pedidoId, pedidoUnidades: p.unidades, unidadesPorProducto: p.unidadesPorProducto })))
      : row
    : { estado: "SIN_DATOS", diferencia: null };
  const text = formatMeDiferencia(d);
  return (
    <span className="inline-flex flex-col items-start gap-0.5" data-testid="me-diferencia" data-estado={d.estado}>
      <span className="inline-flex items-center gap-1">
        <span className={TONE[meDiferenciaTone(d.estado)]} title={row?.pedidos.map((p) => `${p.producto} · pedido ${p.unidades ?? "?"} u × ${p.unidadesPorProducto ?? "?"}`).join("\n")}>
          {text}
          {prevista ? " (prevista)" : ""}
        </span>
        {canLink && materialId ? (
          <button type="button" onClick={() => setOpen((v) => !v)} className="rounded px-1 text-xs text-[var(--os-teal)] hover:underline" data-testid="me-diferencia-vincular" title="Vincular con el pedido y definir consumo por producto">
            {open ? "×" : "Pedido"}
          </button>
        ) : null}
      </span>
      {open && materialId ? <LinkEditor materialId={materialId} row={row} onDone={() => { setOpen(false); onChanged(); }} /> : null}
    </span>
  );
}

function LinkEditor({ materialId, row, onDone }: { materialId: string; row: MeDiferenciaRow | undefined; onDone: () => void }) {
  const [cands, setCands] = useState<Awaited<ReturnType<typeof fetchMeDiferenciaCandidatos>> | null>(null);
  const [pedidoId, setPedidoId] = useState("");
  const [ratio, setRatio] = useState("");
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let off = false;
    fetchMeDiferenciaCandidatos(materialId).then((c) => !off && setCands(c)).catch((e) => !off && setErr(e instanceof Error ? e.message : "Error"));
    return () => { off = true; };
  }, [materialId]);
  const run = async (body: Parameters<typeof postMeDiferenciaLink>[0]) => {
    try { await postMeDiferenciaLink(body); onDone(); } catch (e) { setErr(e instanceof InventoryClientError || e instanceof Error ? e.message : "No se pudo guardar."); }
  };
  return (
    <span className="flex flex-col gap-1 text-xs" onClick={(e) => e.stopPropagation()}>
      {row?.pedidos.map((p) => (
        <span key={p.pedidoId} className="inline-flex items-center gap-1 text-[var(--os-text-muted)]">
          {p.producto} · {p.unidades ?? "?"} u × {p.unidadesPorProducto ?? "sin configurar"}
          <button type="button" className="text-red-500 hover:underline" onClick={() => void run({ action: "unlink", materialId, pedidoId: p.pedidoId })}>Quitar</button>
        </span>
      ))}
      <select value={pedidoId} onChange={(e) => setPedidoId(e.target.value)} className="rounded border border-[var(--os-border)] bg-transparent px-1 py-0.5" data-testid="me-diferencia-pedido">
        <option value="">{cands == null ? "Cargando pedidos…" : cands.length ? "Elegí el pedido activo…" : "Sin pedidos activos del cliente"}</option>
        {cands?.map((c) => <option key={c.pedidoId} value={c.pedidoId}>{c.producto} · {c.unidades ?? "?"} u · {c.estado}</option>)}
      </select>
      <span className="inline-flex items-center gap-1">
        <input value={ratio} onChange={(e) => setRatio(e.target.value)} inputMode="decimal" placeholder="u. por producto" className="w-24 rounded border border-[var(--os-border)] bg-transparent px-1 py-0.5" data-testid="me-diferencia-ratio" />
        <button type="button" disabled={!pedidoId} className="text-[var(--os-teal)] hover:underline disabled:opacity-40" data-testid="me-diferencia-guardar"
          onClick={() => { const n = ratio.trim() ? Number(ratio.replace(",", ".")) : null; void run({ action: "link", materialId, pedidoId, unidadesPorProducto: n }); }}>
          Guardar
        </button>
      </span>
      {err ? <span className="text-red-500">{err}</span> : null}
    </span>
  );
}
