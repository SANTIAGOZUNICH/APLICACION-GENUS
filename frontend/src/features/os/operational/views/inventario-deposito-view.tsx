"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { TwinShell } from "@/features/os/shell/twin-shell";
import { usePreviewSession } from "@/features/os/session/preview-context";
import { fetchInventory } from "@/features/os/operational/adapters/inventory-client";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ACTOR_EMAIL_HEADER, ACTOR_SECTOR_HEADER } from "@/lib/auth/header-names";
import type { MeInventarioViewRow } from "@/lib/inventory/types";
import type { MeMovement } from "@/lib/inventory/me-stock-calc";

const REFRESH_MS = 20_000;
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const fmt = (n: number | null | undefined) => (n == null ? "—" : new Intl.NumberFormat("es-AR", { maximumFractionDigits: 3 }).format(n));

export type InventarioSortKey = "nombre_asc" | "codigo_asc" | "cantidad_desc" | "cantidad_asc";
const SORTS: Array<{ key: InventarioSortKey; label: string }> = [
  { key: "nombre_asc", label: "Nombre A-Z" },
  { key: "codigo_asc", label: "Código A-Z" },
  { key: "cantidad_desc", label: "Cantidad mayor a menor" },
  { key: "cantidad_asc", label: "Cantidad menor a mayor" },
];

/** Búsqueda por código, nombre/descripción o cliente (cada palabra por separado, sin acentos ni mayúsculas). */
export function filterInventario(rows: MeInventarioViewRow[], query: string): MeInventarioViewRow[] {
  const terms = norm(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return rows;
  return rows.filter((r) => {
    const hay = norm(`${r.codigo} ${r.insumo} ${r.cliente} ${r.producto ?? ""}`);
    return terms.every((t) => hay.includes(t));
  });
}

export function sortInventario(rows: MeInventarioViewRow[], key: InventarioSortKey): MeInventarioViewRow[] {
  const txt = (a: string, b: string) => a.localeCompare(b, "es", { sensitivity: "base", numeric: true });
  const out = [...rows];
  out.sort((a, b) => {
    if (key === "nombre_asc") return txt(a.insumo, b.insumo) || txt(a.codigo, b.codigo);
    if (key === "codigo_asc") return txt(a.codigo, b.codigo);
    return key === "cantidad_desc" ? b.cantidadTotal - a.cantidadTotal : a.cantidadTotal - b.cantidadTotal;
  });
  return out;
}

/**
 * Producción → Inventario de Depósito: consulta de SOLO LECTURA del MISMO inventario de ME que administra Depósito
 * (no hay copia: se lee `me_inventario` en cada actualización). Sin altas, ediciones, bajas, movimientos ni ajustes.
 * El servidor además rechaza cualquier escritura de Producción sobre el inventario ME.
 */
export function InventarioDepositoView() {
  const { email, sectorId } = usePreviewSession();
  const headers = useMemo<HeadersInit>(() => ({ [ACTOR_EMAIL_HEADER]: email ?? "", [ACTOR_SECTOR_HEADER]: sectorId }), [email, sectorId]);
  const [rows, setRows] = useState<MeInventarioViewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<InventarioSortKey>("nombre_asc");
  const [detail, setDetail] = useState<MeInventarioViewRow | null>(null);

  const load = useCallback(async (silent = false) => {
    try {
      const res = await fetchInventory<MeInventarioViewRow>("me_inventario" as never);
      setRows(res.data);
      setError(res.message ?? null);
    } catch (e) {
      if (!silent) setError(e instanceof Error ? e.message : "No se pudo cargar el inventario.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Se actualiza solo cuando Depósito registra entradas, salidas o ajustes: al abrir, cada 20 s (solo con la pestaña visible) y al volver a ella.
  useEffect(() => {
    const t0 = setTimeout(() => void load(), 0);
    const t = setInterval(() => document.visibilityState === "visible" && void load(true), REFRESH_MS);
    const onVis = () => document.visibilityState === "visible" && void load(true);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearTimeout(t0);
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [load]);

  const shown = useMemo(() => sortInventario(filterInventario(rows, q), sort), [rows, q, sort]);

  return (
    <TwinShell title="Inventario de Depósito">
      <header className="mb-4">
        <h2 className="text-2xl font-semibold tracking-tight">Inventario de Depósito</h2>
        <p className="text-sm text-[var(--os-text-muted)]">Materiales de empaque (ME) y stock actual · solo consulta</p>
      </header>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <input className="min-w-[16rem] flex-1 rounded border px-3 py-2 text-sm" placeholder="Buscar por código, nombre, descripción o cliente…" aria-label="Buscar materiales" value={q} onChange={(e) => setQ(e.target.value)} data-testid="invdep-search" />
        <label className="flex items-center gap-2 text-sm">
          Ordenar por
          <select className="rounded border px-2 py-2 text-sm" value={sort} onChange={(e) => setSort(e.target.value as InventarioSortKey)} data-testid="invdep-sort">
            {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </label>
        <span className="text-xs text-[var(--os-text-muted)]" data-testid="invdep-count">{shown.length}{q.trim() ? ` de ${rows.length}` : ""} material{shown.length === 1 ? "" : "es"}</span>
      </div>
      {error ? <p className="mb-3 rounded border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-900" role="alert">{error}</p> : null}
      {loading ? (
        <p className="text-sm text-[var(--os-text-muted)]">Cargando…</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="os-table w-full text-left text-sm" data-testid="invdep-table">
            <thead className="text-xs uppercase text-[var(--os-text-muted)]">
              <tr>
                <th className="p-2">Código</th>
                <th className="p-2">Nombre / descripción</th>
                <th className="p-2">Cliente / marca</th>
                <th className="p-2 text-right">Stock actual</th>
                <th className="p-2">Unidad</th>
                <th className="p-2">Ubicación</th>
                <th className="p-2" />
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 ? (
                <tr><td colSpan={7} className="p-3 text-[var(--os-text-muted)]" data-testid="invdep-empty">{rows.length === 0 ? "Todavía no hay materiales cargados." : "Ningún material coincide con la búsqueda."}</td></tr>
              ) : null}
              {shown.map((r) => (
                <tr key={r.materialId} className="border-t border-[var(--os-border)]" data-testid="invdep-row">
                  <td className="p-2 font-medium">{r.codigo || "—"}</td>
                  <td className="p-2">{r.insumo || "—"}</td>
                  <td className="p-2">{r.cliente || "—"}</td>
                  <td className={`p-2 text-right tabular-nums ${r.cantidadTotal < 0 ? "font-bold text-rose-700 dark:text-rose-300" : ""}`}>{fmt(r.cantidadTotal)}</td>
                  <td className="p-2">{r.unidad || "—"}</td>
                  <td className="p-2">{r.ubicacion || "—"}</td>
                  <td className="p-2 text-right"><button type="button" className="text-xs font-semibold underline" onClick={() => setDetail(r)} data-testid="invdep-detail">Ver detalle</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {detail ? <DetailDialog row={detail} headers={headers} onClose={() => setDetail(null)} /> : null}
    </TwinShell>
  );
}

function DetailDialog({ row, headers, onClose }: { row: MeInventarioViewRow; headers: HeadersInit; onClose: () => void }) {
  const [moves, setMoves] = useState<MeMovement[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let off = false;
    void (async () => {
      try {
        const res = await fetch(`/api/v1/inventory/me-movimientos?materialId=${encodeURIComponent(row.materialId)}`, { credentials: "include", headers, cache: "no-store" });
        const body = (await res.json()) as { movimientos?: MeMovement[]; error?: string };
        if (!res.ok) throw new Error(body.error ?? "No se pudo cargar el detalle.");
        if (!off) setMoves(body.movimientos ?? []);
      } catch (e) {
        if (!off) setError(e instanceof Error ? e.message : "Error");
      }
    })();
    return () => { off = true; };
  }, [row.materialId, headers]);
  const KIND: Record<string, string> = { INGRESO: "Ingreso", SALIDA_OA: "Salida (OA)", SALIDA_MANUAL: "Salida", AJUSTE: "Ajuste" };
  const facts: Array<[string, string]> = [
    ["Código", row.codigo || "—"],
    ["Nombre / descripción", row.insumo || "—"],
    ["Cliente / marca", row.cliente || "—"],
    ["Producto", row.producto || "—"],
    ["Stock actual", `${fmt(row.cantidadTotal)} ${row.unidad ?? ""}`.trim()],
    ["Bultos", row.bultosDisplay || "—"],
    ["Ubicación", row.ubicacion || "—"],
    ["Stock mínimo", fmt(row.stockMinimo)],
    ["Punto de reposición", fmt(row.puntoReposicion)],
  ];
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto" data-testid="invdep-dialog">
        <DialogHeader>
          <DialogTitle>{row.codigo} — {row.insumo}</DialogTitle>
          <DialogDescription>Solo consulta. Las entradas, salidas y ajustes los registra Depósito.</DialogDescription>
        </DialogHeader>
        <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          {facts.map(([k, v]) => <div key={k}><dt className="inline font-semibold">{k}: </dt><dd className="inline">{v}</dd></div>)}
        </dl>
        <h4 className="mt-3 text-sm font-semibold">Movimientos</h4>
        {error ? <p className="text-sm text-rose-800" role="alert">{error}</p> : null}
        {!moves && !error ? <p className="text-sm text-[var(--os-text-muted)]">Cargando…</p> : null}
        {moves ? (
          <table className="w-full text-left text-xs" data-testid="invdep-moves">
            <thead className="uppercase text-[var(--os-text-muted)]"><tr><th className="p-1">Fecha</th><th className="p-1">Tipo</th><th className="p-1 text-right">Cantidad</th><th className="p-1 text-right">Saldo</th><th className="p-1">Referencia</th></tr></thead>
            <tbody>
              {moves.length === 0 ? <tr><td colSpan={5} className="p-2 text-[var(--os-text-muted)]">Sin movimientos registrados.</td></tr> : null}
              {[...moves].reverse().map((m) => (
                <tr key={m.id} className={`border-t border-[var(--os-border)] ${m.anulado ? "line-through opacity-60" : ""}`}>
                  <td className="p-1">{m.fecha}</td><td className="p-1">{KIND[m.tipo] ?? m.tipo}</td>
                  <td className="p-1 text-right tabular-nums">{m.cantidad > 0 ? "+" : ""}{fmt(m.cantidad)}</td>
                  <td className="p-1 text-right tabular-nums">{fmt(m.saldo)}</td><td className="p-1">{m.referencia || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
