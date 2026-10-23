"use client";

import { useCallback, useEffect, useState } from "react";
import { Package } from "lucide-react";
import { createPortal } from "react-dom";
import { fetchIngresoDiferencias, fetchIngresoPedidoCandidatos, InventoryClientError, postIngresoPedidoLink, type IngresoPedidoCandidato } from "@/features/os/operational/adapters/inventory-client";
import { formatMeDiferencia, ingresoDiferenciaView, ingresoPrevisto, meDiferenciaTone, type IngresoDiferenciaRow, type IngresoDiferenciasPayload, type MeDiferencia } from "@/lib/inventory/me-diferencia";

/** DIFERENCIA de cada ingreso (por id de ingreso) calculada por el servidor contra el pedido; nunca usa el saldo de Stock ME. */
export function useIngresoDiferencias() {
  const [data, setData] = useState<IngresoDiferenciasPayload>({ ingresos: {} });
  const reload = useCallback(async () => {
    try {
      setData(await fetchIngresoDiferencias());
    } catch {
      /* sin DIFERENCIA no se rompe la planilla: la columna queda en SIN DATOS */
    }
  }, []);
  useEffect(() => {
    queueMicrotask(() => void reload());
  }, [reload]);
  return { data, reload };
}

export function ingresoDifText(row: IngresoDiferenciaRow | undefined): string {
  return row ? ingresoDiferenciaView(row).text : "SIN DATOS";
}
export function ingresoDifClass(row: IngresoDiferenciaRow | undefined): string | undefined {
  const tone = row ? meDiferenciaTone(ingresoDiferenciaView(row).estado) : "neutral";
  return tone === "red" ? "genus-dif-red" : tone === "green" ? "genus-dif-green" : undefined;
}

/** Texto/clase de una fila NUEVA sin confirmar: diferencia prevista («≈»), sin tocar nada. */
export function previstoText(d: Pick<MeDiferencia, "estado" | "diferencia">) {
  return `${["FALTAN", "SOBRAN", "JUSTO"].includes(d.estado) ? "≈ " : ""}${formatMeDiferencia(d)}`;
}
export { ingresoPrevisto };

export function MeDiferenciaCell({ row }: { row: IngresoDiferenciaRow | undefined }) {
  const v = row ? ingresoDiferenciaView(row) : null;
  const cls = ingresoDifClass(row);
  return (
    <span className={cls ?? "text-[var(--os-text-muted)]"} data-testid="me-diferencia" data-estado={v?.estado ?? "SIN_DATOS"} title={row?.snapshot ? `Resultado al registrar el ingreso (${row.snapshot.acumulado} acumulado vs ${row.snapshot.necesario} del pedido)` : undefined}>
      {ingresoDifText(row)}
    </span>
  );
}

/**
 * Botón por fila: elegir el PRODUCTO/pedido del cliente del ingreso y el consumo por producto. Panel chico anclado al botón
 * (la columna de acciones es angosta y la fila de abajo lo taparía).
 */
export function MePedidoPicker({ ingresoId, row, onChanged }: { ingresoId: string; row: IngresoDiferenciaRow | undefined; onChanged: () => void }) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  useEffect(() => {
    if (!anchor) return;
    const close = (e: Event) => { if (!(e.target as HTMLElement | null)?.closest?.("[data-me-pedido-panel], [data-testid=me-diferencia-vincular]")) setAnchor(null); };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setAnchor(null);
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", esc); };
  }, [anchor]);
  const W = 260;
  return (
    <>
      <button type="button" onClick={(e) => setAnchor(anchor ? null : e.currentTarget.getBoundingClientRect())} className="inline-flex size-8 items-center justify-center rounded text-[var(--os-teal)] hover:bg-[var(--os-teal-soft)]/50" data-testid="me-diferencia-vincular" aria-label="Producto y pedido" title="Elegir el producto/pedido del cliente y el consumo por producto">
        <Package className="size-4" />
      </button>
      {anchor
        ? createPortal(
            <div data-me-pedido-panel className="fixed z-[80] rounded-lg border border-[var(--os-border)] bg-[var(--os-surface-raised,#0f1f26)] p-2 text-[var(--os-text)] shadow-xl" style={{ width: W, left: Math.max(8, Math.min(anchor.left, window.innerWidth - W - 8)), top: Math.min(anchor.bottom + 4, window.innerHeight - 190) }}>
              <LinkEditor ingresoId={ingresoId} row={row} onDone={() => { setAnchor(null); onChanged(); }} />
            </div>,
            document.body
          )
        : null}
    </>
  );
}

function LinkEditor({ ingresoId, row, onDone }: { ingresoId: string; row: IngresoDiferenciaRow | undefined; onDone: () => void }) {
  const [cands, setCands] = useState<IngresoPedidoCandidato[] | null>(null);
  const [pedidoId, setPedidoId] = useState(row?.pedidoId ?? "");
  const [ratio, setRatio] = useState(row?.unidadesPorProducto != null ? String(row.unidadesPorProducto) : "");
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let off = false;
    fetchIngresoPedidoCandidatos(ingresoId).then((c) => !off && setCands(c)).catch((e) => !off && setErr(e instanceof Error ? e.message : "Error"));
    return () => { off = true; };
  }, [ingresoId]);
  const run = async (body: Parameters<typeof postIngresoPedidoLink>[0]) => {
    try { await postIngresoPedidoLink(body); onDone(); } catch (e) { setErr(e instanceof InventoryClientError || e instanceof Error ? e.message : "No se pudo guardar."); }
  };
  return (
    <span className="flex flex-col gap-2 text-sm" onClick={(e) => e.stopPropagation()}>
      <select value={pedidoId} onChange={(e) => setPedidoId(e.target.value)} className="min-h-10 w-full rounded border border-[var(--os-border)] bg-transparent px-2" data-testid="me-diferencia-pedido">
        <option value="">{cands == null ? "Cargando pedidos…" : cands.length ? "Elegí producto / pedido…" : "Sin pedidos activos del cliente"}</option>
        {cands?.map((c) => <option key={c.pedidoId} value={c.pedidoId}>{c.producto} · {c.unidades ?? "?"} u · {c.estado}</option>)}
      </select>
      <span className="inline-flex items-center gap-1">
        <input value={ratio} onChange={(e) => setRatio(e.target.value)} inputMode="decimal" placeholder="u. por producto" className="min-h-10 w-28 rounded border border-[var(--os-border)] bg-transparent px-2" data-testid="me-diferencia-ratio" />
        <button type="button" disabled={!pedidoId} className="min-h-10 rounded px-2 font-semibold text-[var(--os-teal)] hover:underline disabled:opacity-40" data-testid="me-diferencia-guardar"
          onClick={() => { const n = ratio.trim() ? Number(ratio.replace(",", ".")) : null; void run({ action: "link", ingresoId, pedidoId, unidadesPorProducto: n }); }}>
          Guardar
        </button>
        {row?.pedidoId ? <button type="button" className="min-h-10 rounded px-2 text-red-500 hover:underline" onClick={() => void run({ action: "unlink", ingresoId })}>Quitar</button> : null}
      </span>
      {err ? <span className="text-red-500">{err}</span> : null}
    </span>
  );
}
