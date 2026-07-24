"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ACTOR_EMAIL_HEADER,
  ACTOR_SECTOR_HEADER,
} from "@/lib/orders/actor";
import { usePreviewSession } from "@/features/os/session/preview-context";

type Movement = {
  id: string;
  codigo: string;
  kind: string;
  quantity: number;
  balanceAfter: number | null;
  reason: string;
  refType: string | null;
  refId: string | null;
  createdAt: string;
  actorEmail: string;
};

export function MpStockLedgerPanel({ schemaPending }: { schemaPending: boolean }) {
  const { email, sectorId } = usePreviewSession();
  const [codigo, setCodigo] = useState("");
  const [kind, setKind] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [rows, setRows] = useState<Movement[]>([]);
  const [balance, setBalance] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!codigo.trim()) {
      setRows([]);
      setBalance(null);
      return;
    }
    const qs = new URLSearchParams({ codigo: codigo.trim() });
    const res = await fetch(`/api/v1/mp-stock/ledger?${qs}`, {
      headers: {
        [ACTOR_EMAIL_HEADER]: email ?? "",
        [ACTOR_SECTOR_HEADER]: sectorId,
      },
    });
    const body = (await res.json()) as {
      history?: Movement[];
      balance?: { stockActual: number } | null;
      error?: string;
    };
    if (!res.ok) {
      setError(body.error ?? "Error ledger");
      return;
    }
    let hist = body.history ?? [];
    if (kind) hist = hist.filter((h) => h.kind === kind);
    if (from) hist = hist.filter((h) => h.createdAt.slice(0, 10) >= from);
    if (to) hist = hist.filter((h) => h.createdAt.slice(0, 10) <= to);
    setRows(hist);
    setBalance(body.balance?.stockActual ?? null);
    setError(null);
  }, [codigo, kind, from, to, email, sectorId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-2 rounded border p-3" data-testid="mp-stock-ledger-panel">
      <h3 className="text-sm font-semibold">Historial de stock (ledger)</h3>
      {schemaPending ? (
        <p className="text-xs text-amber-800">
          Base de datos pendiente de actualización. Historial vacío hasta aplicar 0005.
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2 text-xs">
        <input
          className="rounded border px-2 py-1"
          placeholder="Código MP"
          value={codigo}
          onChange={(e) => setCodigo(e.target.value)}
          data-testid="ledger-codigo"
        />
        <select
          className="rounded border px-2 py-1"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
        >
          <option value="">Origen (todos)</option>
          <option value="SALDO_INICIAL">Saldo inicial</option>
          <option value="INGRESO">Ingreso</option>
          <option value="CONSUMO_OE">Consumo OE</option>
          <option value="AJUSTE">Ajuste</option>
          <option value="REVERSO">Reverso</option>
        </select>
        <input
          type="date"
          className="rounded border px-2 py-1"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <input
          type="date"
          className="rounded border px-2 py-1"
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
      </div>
      {balance != null ? (
        <p className="text-xs">
          Stock actual (ledger): <strong>{balance}</strong> kg
        </p>
      ) : null}
      {error ? <p className="text-xs text-rose-700">{error}</p> : null}
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b text-left">
            <th className="p-1">Fecha</th>
            <th className="p-1">Origen</th>
            <th className="p-1">Cantidad</th>
            <th className="p-1">Saldo</th>
            <th className="p-1">Motivo</th>
            <th className="p-1">Actor</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b">
              <td className="p-1">{new Date(r.createdAt).toLocaleString("es-AR")}</td>
              <td className="p-1">{r.kind}</td>
              <td className="p-1">{r.quantity}</td>
              <td className="p-1">{r.balanceAfter ?? "—"}</td>
              <td className="p-1">{r.reason}</td>
              <td className="p-1">{r.actorEmail}</td>
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <td colSpan={6} className="p-2 text-[var(--os-text-muted)]">
                Sin movimientos.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
