"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { TwinShell } from "@/features/os/shell/twin-shell";
import { usePreviewSession } from "@/features/os/session/preview-context";
import { ACTOR_EMAIL_HEADER, ACTOR_SECTOR_HEADER } from "@/lib/auth/header-names";
import type { PedidoDepositoRow } from "@/lib/production-pedidos/service";

const REFRESH_MS = 20_000;
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** Búsqueda por producto o cliente (cada palabra por separado, sin acentos ni mayúsculas). */
export function filterPedidosDeposito(rows: PedidoDepositoRow[], query: string): PedidoDepositoRow[] {
  const terms = norm(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return rows;
  return rows.filter((r) => {
    const hay = norm(`${r.producto} ${r.cliente}`);
    return terms.every((t) => hay.includes(t));
  });
}

/**
 * Depósito → Pedidos: consulta de SOLO LECTURA de los pedidos de Producción (misma fuente). Producto | Cliente | Cantidad total
 * (la cantidad pedida, un renglón por producto). Sin edición, sin formularios, sin acciones: hacer clic en una fila no hace nada.
 */
export function PedidosDepositoView() {
  const { email, sectorId } = usePreviewSession();
  const headers = useMemo<HeadersInit>(() => ({ [ACTOR_EMAIL_HEADER]: email ?? "", [ACTOR_SECTOR_HEADER]: sectorId }), [email, sectorId]);
  const [rows, setRows] = useState<PedidoDepositoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const load = useCallback(
    async (silent = false) => {
      try {
        const res = await fetch("/api/v1/production-pedidos/deposito", { credentials: "include", headers, cache: "no-store" });
        const body = (await res.json()) as { items?: PedidoDepositoRow[]; error?: string };
        if (!res.ok) throw new Error(body.error ?? "No se pudieron cargar los pedidos.");
        setRows(body.items ?? []);
        setError(null);
      } catch (e) {
        if (!silent) setError(e instanceof Error ? e.message : "Error");
      } finally {
        setLoading(false);
      }
    },
    [headers]
  );

  // Se actualiza solo cuando Producción registra o modifica un pedido: al abrir, cada 20 s y al volver a la pestaña.
  useEffect(() => {
    const t0 = setTimeout(() => void load(), 0);
    const t = setInterval(() => void load(true), REFRESH_MS);
    const onVis = () => document.visibilityState === "visible" && void load(true);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearTimeout(t0);
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [load]);

  const shown = useMemo(() => filterPedidosDeposito(rows, q), [rows, q]);

  return (
    <TwinShell title="Pedidos">
      <header className="mb-4">
        <h2 className="text-2xl font-semibold tracking-tight">Pedidos</h2>
        <p className="text-sm text-[var(--os-text-muted)]">Pedidos registrados por Producción · solo consulta</p>
      </header>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <input
          className="min-w-[16rem] flex-1 rounded border px-3 py-2 text-sm"
          placeholder="Buscar por producto o cliente…"
          aria-label="Buscar por producto o cliente"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          data-testid="pedidos-dep-search"
        />
        <span className="text-xs text-[var(--os-text-muted)]" data-testid="pedidos-dep-count">
          {shown.length}{q.trim() ? ` de ${rows.length}` : ""} producto{shown.length === 1 ? "" : "s"}
        </span>
      </div>
      {error ? <p className="mb-3 rounded border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-900" role="alert">{error}</p> : null}
      {loading ? (
        <p className="text-sm text-[var(--os-text-muted)]">Cargando…</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="os-table w-full text-left text-sm" data-testid="pedidos-dep-table">
            <thead className="text-xs uppercase text-[var(--os-text-muted)]">
              <tr>
                <th className="p-2">Producto</th>
                <th className="p-2">Cliente</th>
                <th className="p-2 text-right">Cantidad total</th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 ? (
                <tr>
                  <td colSpan={3} className="p-3 text-[var(--os-text-muted)]" data-testid="pedidos-dep-empty">
                    {rows.length === 0 ? "Todavía no hay pedidos registrados." : "Ningún pedido coincide con la búsqueda."}
                  </td>
                </tr>
              ) : null}
              {shown.map((r) => (
                <tr key={r.id} className="border-t border-[var(--os-border)]" data-testid="pedidos-dep-row">
                  <td className="p-2">{r.producto || "—"}</td>
                  <td className="p-2">{r.cliente || "—"}</td>
                  <td className="p-2 text-right tabular-nums">{r.cantidadTotal == null ? "—" : r.cantidadTotal.toLocaleString("es-AR")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </TwinShell>
  );
}
