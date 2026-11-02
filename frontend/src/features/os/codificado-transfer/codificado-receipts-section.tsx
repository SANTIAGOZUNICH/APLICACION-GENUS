"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ACTOR_EMAIL_HEADER, ACTOR_SECTOR_HEADER } from "@/lib/auth/header-names";
import { usePreviewSession } from "@/features/os/session/preview-context";
import { fmtQty } from "./codificado-transfer-client";

export type CodificadoReceipt = {
  id: string;
  seq: number;
  quantity: number;
  cumulative: number;
  originSector: string;
  lote: string | null;
  deliveredBy: string;
  deliveredByName: string | null;
  deliveredAt: string;
  workItemId: string;
  codificadoItemId: string;
  client: string;
  product: string;
};

/** Entregas recibidas desde Envasado (se refresca al abrir, cada 20 s y con `refresh()`): alimenta la bandeja de Codificado. */
export function useCodificadoReceipts() {
  const { email, sectorId } = usePreviewSession();
  const [items, setItems] = useState<CodificadoReceipt[]>([]);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/codificado-transfers?limit=100", { credentials: "include", cache: "no-store", headers: { [ACTOR_EMAIL_HEADER]: email ?? "", [ACTOR_SECTOR_HEADER]: sectorId } });
      const body = (await res.json().catch(() => ({}))) as { items?: CodificadoReceipt[]; error?: string };
      if (!res.ok) throw new Error(body.error ?? "No se pudieron cargar las entregas recibidas.");
      setItems(body.items ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    }
  }, [email, sectorId]);
  useEffect(() => {
    const t0 = setTimeout(() => void load(), 0);
    const t = setInterval(() => document.visibilityState === "visible" && void load(), 20_000);
    return () => {
      clearTimeout(t0);
      clearInterval(t);
    };
  }, [load]);
  /** Unidades recibidas por cada trabajo de Codificado (clave `native:<id>`). */
  const receivedByItem = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of items) m.set(`native:${r.codificadoItemId}`, (m.get(`native:${r.codificadoItemId}`) ?? 0) + r.quantity);
    return m;
  }, [items]);
  return { items, error, refresh: load, receivedByItem };
}

/** Bandeja: una fila por entrega recibida, con cliente, producto, lote, sector de origen, cantidad, fecha y hora y usuario. */
export function CodificadoReceiptsSection({ items }: { items: CodificadoReceipt[] }) {
  if (!items.length) return null;
  return (
    <section className="mb-4 rounded border border-[var(--os-border)] p-3" data-testid="cod-receipts" aria-label="Entregas recibidas desde Envasado">
      <h3 className="mb-2 text-sm font-semibold">Entregas recibidas desde Envasado</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="uppercase text-[var(--os-text-muted)]">
            <tr><th className="p-1">Cliente</th><th className="p-1">Producto</th><th className="p-1">Lote</th><th className="p-1">Origen</th><th className="p-1 text-right">Cantidad recibida</th><th className="p-1">Fecha y hora</th><th className="p-1">Entregó</th></tr>
          </thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.id} className="border-t border-[var(--os-border)]" data-testid="cod-receipt-row">
                <td className="p-1">{r.client || "—"}</td>
                <td className="p-1">{r.product || "—"}</td>
                <td className="p-1">{r.lote || "—"}</td>
                <td className="p-1">{r.originSector === "ENVASADO_PREMIUM" ? "Envasado Premium" : "Envasado Masivo"}</td>
                <td className="p-1 text-right tabular-nums">{fmtQty(r.quantity)}</td>
                <td className="p-1">{new Date(r.deliveredAt).toLocaleString("es-AR")}</td>
                <td className="p-1">{r.deliveredByName ?? r.deliveredBy}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
