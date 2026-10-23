"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Package } from "lucide-react";
import { createPortal } from "react-dom";
import { fetchMeDiferenciaCandidatos, fetchMeDiferencias, InventoryClientError, postMeDiferenciaLink } from "@/features/os/operational/adapters/inventory-client";
import { computeMeDiferencia, formatMeDiferencia, meDiferenciaTone, type MeDiferencia, type MeDiferenciaRow } from "@/lib/inventory/me-diferencia";
import { normalizeMeCodigo } from "@/lib/inventory/me-codigo";

export const TONE_TEXT: Record<"red" | "green" | "neutral", string> = {
  red: "font-semibold text-red-600",
  green: "font-semibold text-emerald-600",
  neutral: "text-[var(--os-text-muted)]",
};

const norm = (s: string | null | undefined) => (s ?? "").trim().replace(/\s+/g, " ").toUpperCase();

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
  const byCodigo = useMemo(() => {
    const m = new Map<string, MeDiferenciaRow>();
    for (const r of Object.values(map)) if (r.codigo) m.set(`${r.codigo}|${norm(r.cliente)}`, r), m.has(r.codigo) || m.set(r.codigo, r);
    return m;
  }, [map]);
  /** Material de una fila de ingreso: por id si lo tiene; si no, por código (+ cliente cuando hay). Nunca por parecido de nombre. */
  const forIngreso = useCallback(
    (row: { materialId?: string | null; codigo?: string; cliente?: string }) =>
      (row.materialId ? map[row.materialId] : undefined) ?? byCodigo.get(`${normalizeMeCodigo(row.codigo)}|${norm(row.cliente)}`) ?? byCodigo.get(normalizeMeCodigo(row.codigo)),
    [map, byCodigo]
  );
  return { map, reload, forIngreso };
}

/** Diferencia de un ingreso: usa el stock ACUMULADO del material; si el ingreso es de otro producto que el material, SIN DATOS. */
export function ingresoDiferencia(row: { producto?: string; anulado?: boolean }, mat: MeDiferenciaRow | undefined, extraStock = 0): Pick<MeDiferencia, "estado" | "diferencia"> {
  if (!mat) return { estado: "SIN_DATOS", diferencia: null };
  if (row.producto?.trim() && mat.producto && norm(row.producto) !== norm(mat.producto)) return { estado: "SIN_DATOS", diferencia: null };
  if (!extraStock) return mat;
  if (mat.estado === "ELEGIR_PEDIDO") return mat;
  return computeMeDiferencia(mat.stock + extraStock, mat.pedidos.map((p) => ({ pedidoId: p.pedidoId, pedidoUnidades: p.unidades, unidadesPorProducto: p.unidadesPorProducto })));
}

export function diferenciaText(d: Pick<MeDiferencia, "estado" | "diferencia">, prevista = false) {
  // Prevista (ingreso sin confirmar): «≈» al principio, para que se lea aunque la celda quede angosta.
  return `${prevista && d.estado !== "SIN_DATOS" ? "≈ " : ""}${formatMeDiferencia(d)}`;
}
export function diferenciaClass(d: Pick<MeDiferencia, "estado">) {
  const tone = meDiferenciaTone(d.estado);
  return tone === "red" ? "genus-dif-red" : tone === "green" ? "genus-dif-green" : undefined;
}

/** Celda de DIFERENCIA con color. El vínculo con el pedido se elige con el botón «Producto» de la fila. */
export function MeDiferenciaCell({ d, prevista = false, title }: { d: Pick<MeDiferencia, "estado" | "diferencia">; prevista?: boolean; title?: string }) {
  return (
    <span className={diferenciaClass(d)} title={title} data-testid="me-diferencia" data-estado={d.estado}>
      {diferenciaText(d, prevista)}
    </span>
  );
}

/**
 * Botón por fila: elegir el PRODUCTO/pedido del cliente del material y el consumo por producto. El selector es un panel
 * chico anclado al botón (fuera de la celda: la columna de acciones es angosta y la fila de abajo lo taparía).
 */
export function MePedidoPicker({ materialId, row, onChanged }: { materialId: string | null | undefined; row: MeDiferenciaRow | undefined; onChanged: () => void }) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  useEffect(() => {
    if (!anchor) return;
    const close = (e: Event) => { if (!(e.target as HTMLElement | null)?.closest?.("[data-me-pedido-panel], [data-testid=me-diferencia-vincular]")) setAnchor(null); };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setAnchor(null);
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", esc); };
  }, [anchor]);
  if (!materialId) return null;
  const W = 260;
  return (
    <>
      <button type="button" onClick={(e) => setAnchor(anchor ? null : e.currentTarget.getBoundingClientRect())} className="inline-flex size-8 items-center justify-center rounded text-[var(--os-teal)] hover:bg-[var(--os-teal-soft)]/50" data-testid="me-diferencia-vincular" aria-label="Producto y pedido" title="Elegir el producto/pedido del cliente y el consumo por producto">
        <Package className="size-4" />
      </button>
      {anchor
        ? createPortal(
            <div data-me-pedido-panel className="fixed z-[80] rounded-lg border border-[var(--os-border)] bg-[var(--os-surface-raised,#0f1f26)] p-2 text-[var(--os-text)] shadow-xl" style={{ width: W, left: Math.max(8, Math.min(anchor.left, window.innerWidth - W - 8)), top: Math.min(anchor.bottom + 4, window.innerHeight - 190) }}>
              <LinkEditor materialId={materialId} row={row} onDone={() => { setAnchor(null); onChanged(); }} />
            </div>,
            document.body
          )
        : null}
    </>
  );
}

function LinkEditor({ materialId, row, onDone }: { materialId: string; row: MeDiferenciaRow | undefined; onDone: () => void }) {
  const [cands, setCands] = useState<Awaited<ReturnType<typeof fetchMeDiferenciaCandidatos>> | null>(null);
  const [pedidoId, setPedidoId] = useState(row?.pedidos[0]?.pedidoId ?? "");
  const [ratio, setRatio] = useState(row?.pedidos[0]?.unidadesPorProducto != null ? String(row.pedidos[0].unidadesPorProducto) : "");
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
    <span className="flex flex-col gap-2 text-sm" onClick={(e) => e.stopPropagation()}>
      <select value={pedidoId} onChange={(e) => setPedidoId(e.target.value)} className="min-h-10 w-full rounded border border-[var(--os-border)] bg-transparent px-2" data-testid="me-diferencia-pedido">
        <option value="">{cands == null ? "Cargando pedidos…" : cands.length ? "Elegí producto / pedido…" : "Sin pedidos activos del cliente"}</option>
        {cands?.map((c) => <option key={c.pedidoId} value={c.pedidoId}>{c.producto} · {c.unidades ?? "?"} u · {c.estado}</option>)}
      </select>
      <span className="inline-flex items-center gap-1">
        <input value={ratio} onChange={(e) => setRatio(e.target.value)} inputMode="decimal" placeholder="u. por producto" className="min-h-10 w-28 rounded border border-[var(--os-border)] bg-transparent px-2" data-testid="me-diferencia-ratio" />
        <button type="button" disabled={!pedidoId} className="min-h-10 rounded px-2 font-semibold text-[var(--os-teal)] hover:underline disabled:opacity-40" data-testid="me-diferencia-guardar"
          onClick={() => { const n = ratio.trim() ? Number(ratio.replace(",", ".")) : null; void run({ action: "link", materialId, pedidoId, unidadesPorProducto: n }); }}>
          Guardar
        </button>
        {row?.pedidos[0] ? <button type="button" className="min-h-10 rounded px-2 text-red-500 hover:underline" onClick={() => void run({ action: "unlink", materialId, pedidoId: row.pedidos[0]!.pedidoId })}>Quitar</button> : null}
      </span>
      {err ? <span className="text-red-500">{err}</span> : null}
    </span>
  );
}
