"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ACTOR_EMAIL_HEADER, ACTOR_SECTOR_HEADER } from "@/lib/auth/header-names";
import { formatQty, parseQty, planSchedules } from "@/lib/planning/work-schedules";

type Schedule = { id: string; plannedDate: string; plannedDateTo: string | null; quantity: string; isOriginal: boolean; status: string; deliveredUnits: number };
type Listing = { rootId: string; schedules: Schedule[]; total: number | null };

const nativeId = (id: string) => id.replace(/^native:/, "");
const fmtDate = (iso: string) => iso.split("-").reverse().join("/");
const newKey = () => `sched-${typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Date.now().toString(36)}`;
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * «Programaciones» de una misma OE/OA: la orden es una sola y se programa en varios días (cada día con su cantidad).
 * No crea órdenes, ni toca pedidos, consumos de MP, stock ni entregas. Solo Producción agrega o quita.
 */
export function WorkSchedulesPanel({ itemId, plannedDate, quantity, unit, email, sector, canManage, onChanged }: { itemId: string; plannedDate: string | null; quantity: string | null; unit: string | null; email: string; sector: string; canManage: boolean; onChanged?: () => void }) {
  const [data, setData] = useState<Listing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Array<{ date: string; qty: string }>>([]);
  const [rebalance, setRebalance] = useState(true);
  const [allowExceed, setAllowExceed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<Schedule | null>(null);
  const keyRef = useRef(newKey());
  const headers = useMemo(() => ({ "content-type": "application/json", [ACTOR_EMAIL_HEADER]: email, [ACTOR_SECTOR_HEADER]: sector }), [email, sector]);
  const base = `/api/v1/work-items/${encodeURIComponent(nativeId(itemId))}/schedules`;

  const load = useCallback(async () => {
    try {
      const res = await fetch(base, { credentials: "include", headers, cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as Listing & { error?: string };
      if (!res.ok) throw new Error(body.error ?? "No se pudieron cargar las programaciones");
      setData(body);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron cargar las programaciones");
    }
  }, [base, headers]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  function openDialog() {
    keyRef.current = newKey();
    setRows([{ date: addDays(plannedDate ?? new Date().toISOString().slice(0, 10), 1), qty: "" }]);
    setRebalance(true);
    setAllowExceed(false);
    setError(null);
    setOpen(true);
  }

  const members = (data?.schedules ?? []).map((s) => ({ id: s.id, date: s.plannedDate, qty: parseQty(s.quantity) ?? 0 }));
  const total = data?.total ?? members.reduce((s, m) => s + m.qty, 0);
  const preview = useMemo(
    () =>
      planSchedules({
        members,
        sourceId: nativeId(itemId),
        total,
        items: rows.map((r) => ({ date: r.date, qty: parseQty(r.qty) ?? (rebalance ? Number.NaN : (parseQty(quantity) ?? Number.NaN)) })),
        rebalance,
        allowExceed,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, rebalance, allowExceed, data, total, itemId, quantity]
  );

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(base, {
        method: "POST",
        credentials: "include",
        headers,
        body: JSON.stringify({ items: rows.map((r) => ({ plannedDate: r.date, quantity: r.qty.trim() || null })), rebalanceSource: rebalance, allowExceed, idempotencyKey: keyRef.current }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "No se pudo programar");
      setOpen(false);
      await load();
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo programar");
    } finally {
      setBusy(false);
    }
  }

  async function remove(s: Schedule) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/work-items/${encodeURIComponent(s.id)}/schedules`, { method: "DELETE", credentials: "include", headers });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "No se pudo quitar");
      setConfirmRemove(null);
      await load();
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo quitar");
      setConfirmRemove(null);
    } finally {
      setBusy(false);
    }
  }

  const list = data?.schedules ?? [];
  const u = unit ? ` ${unit}` : "";
  return (
    <section className="rounded border border-[var(--os-border)] p-3" data-testid="sched-panel">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">Programaciones de esta orden</h3>
        {canManage ? (
          <Button type="button" size="sm" variant="secondary" className="ml-auto min-h-10" onClick={openDialog} data-testid="sched-open">
            Programar en más días
          </Button>
        ) : null}
      </div>
      {list.length > 1 ? (
        <ul className="mt-2 space-y-1 text-xs" data-testid="sched-list">
          {list.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-2 rounded border border-[var(--os-border)] px-2 py-1.5" data-testid="sched-item">
              <span className="font-medium">{fmtDate(s.plannedDate)}{s.plannedDateTo && s.plannedDateTo !== s.plannedDate ? ` → ${fmtDate(s.plannedDateTo)}` : ""}</span>
              <span className="tabular-nums">{s.quantity}{u}</span>
              {s.isOriginal ? <span className="text-[var(--os-text-muted)]">original</span> : null}
              {s.deliveredUnits > 0 ? <span className="text-[var(--os-text-muted)]">entregado {formatQty(s.deliveredUnits)}</span> : null}
              {canManage && !s.isOriginal && s.status === "pendiente" && s.deliveredUnits === 0 ? (
                <button type="button" className="ml-auto min-h-9 rounded border border-rose-500/50 px-2 text-rose-300" onClick={() => setConfirmRemove(s)} data-testid="sched-remove">Quitar</button>
              ) : null}
            </li>
          ))}
          <li className="text-[11px] text-[var(--os-text-muted)]">
            Total programado {formatQty(members.reduce((a, m) => a + m.qty, 0))}{u}{data?.total ? ` de ${formatQty(data.total)}${u} de la orden` : ""}. Es la misma OE/OA: no se duplican órdenes, consumos ni entregas.
          </li>
        </ul>
      ) : (
        <p className="mt-1 text-xs text-[var(--os-text-muted)]">Esta orden se hace en un solo día. Podés repartirla en varios sin crear otra orden.</p>
      )}
      {error && !open ? <p className="mt-2 text-xs text-[var(--genus-error,#b91c1c)]" data-testid="sched-error">{error}</p> : null}

      <Dialog open={open} onOpenChange={(o) => (busy ? undefined : setOpen(o))}>
        <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto" data-testid="sched-dialog">
          <DialogHeader>
            <DialogTitle>Programar en más días</DialogTitle>
            <DialogDescription>Misma OE/OA: cada día es una programación con su fecha y cantidad. No se crean órdenes nuevas.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            {rows.map((r, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <input type="date" value={r.date} onChange={(e) => setRows((prev) => prev.map((x, j) => (j === i ? { ...x, date: e.target.value } : x)))} className="min-h-11 rounded border border-[var(--os-border)] px-2" data-testid="sched-row-date" />
                <input type="text" inputMode="decimal" placeholder={rebalance ? "Cantidad" : `Cantidad (${quantity ?? "—"})`} value={r.qty} onChange={(e) => setRows((prev) => prev.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} className="min-h-11 w-32 rounded border border-[var(--os-border)] px-2 tabular-nums" data-testid="sched-row-qty" />
                <span className="text-xs text-[var(--os-text-muted)]">{unit ?? ""}</span>
                {rows.length > 1 ? <button type="button" className="min-h-9 px-2 text-xs text-[var(--os-text-muted)]" onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}>Quitar</button> : null}
              </div>
            ))}
            <Button type="button" size="sm" variant="tertiary" className="min-h-10" onClick={() => setRows((prev) => [...prev, { date: addDays(prev[prev.length - 1]?.date ?? plannedDate ?? new Date().toISOString().slice(0, 10), 1), qty: "" }])} data-testid="sched-add-row">+ Agregar otro día</Button>
            <label className="flex items-start gap-2 text-xs">
              <input type="checkbox" className="mt-0.5 size-5" checked={rebalance} onChange={(e) => setRebalance(e.target.checked)} data-testid="sched-rebalance" />
              <span>Repartir la cantidad de la orden: la programación actual ({fmtDate(plannedDate ?? "")}) queda con lo que falte.</span>
            </label>
            {preview.ok && rebalance && preview.newSourceQty != null ? (
              <p className="rounded bg-[var(--os-bg-muted)] px-2 py-1 text-xs" data-testid="sched-preview">La programación actual queda con {formatQty(preview.newSourceQty)}{u}; total de la orden {formatQty(total)}{u}.</p>
            ) : null}
            {!preview.ok && rows.every((r) => r.date) ? <p className="text-xs text-[var(--genus-warning)]" data-testid="sched-warning">{preview.message}</p> : null}
            {!preview.ok && preview.code === "EXCEEDS" ? (
              <label className="flex items-start gap-2 text-xs">
                <input type="checkbox" className="mt-0.5 size-5" checked={allowExceed} onChange={(e) => setAllowExceed(e.target.checked)} data-testid="sched-exceed" />
                <span>Confirmo que quiero superar la cantidad de la orden.</span>
              </label>
            ) : null}
            {error ? <p className="text-xs text-[var(--genus-error,#b91c1c)]" role="alert" data-testid="sched-dialog-error">{error}</p> : null}
          </div>
          <DialogFooter>
            <Button variant="secondary" disabled={busy} onClick={() => setOpen(false)}>Cancelar</Button>
            <Button disabled={busy || !preview.ok} onClick={() => void submit()} data-testid="sched-submit">{busy ? "Programando…" : "Programar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmRemove != null} onOpenChange={(o) => (!o && !busy ? setConfirmRemove(null) : undefined)}>
        <DialogContent data-testid="sched-remove-dialog">
          <DialogHeader>
            <DialogTitle>Quitar programación</DialogTitle>
            <DialogDescription>Se quita solo la programación del {confirmRemove ? fmtDate(confirmRemove.plannedDate) : ""}. La orden y las demás programaciones se mantienen.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" disabled={busy} onClick={() => setConfirmRemove(null)}>Cancelar</Button>
            <Button variant="destructive" disabled={busy} onClick={() => confirmRemove && void remove(confirmRemove)} data-testid="sched-remove-confirm">Quitar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
