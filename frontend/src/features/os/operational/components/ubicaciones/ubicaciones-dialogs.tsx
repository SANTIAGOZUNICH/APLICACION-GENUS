"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fetchHistory, fetchMaterials, newKey, opAgregar, opRetirar, opTrasladar } from "@/lib/ubicaciones/client";
import { MOVEMENT_KIND_LABEL, fmtQty, parseQuantity } from "@/lib/ubicaciones/rules";
import type { MaterialOption, MovementView, OpResultView, UbicacionView } from "@/lib/ubicaciones/types";

export const fieldCls = "mt-1 block min-h-11 w-full rounded-lg border border-[var(--os-border)] bg-[var(--os-surface)] px-3 py-2 text-base";
const labelCls = "block text-sm font-medium";
const bigBtn = "min-h-11";

export const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", dateStyle: "short", timeStyle: "short" }) : "—");

type Props = { onClose: () => void; onDone: (r: OpResultView, message: string) => void };

// ───────────────────────── Asignar / agregar ─────────────────────────

type Row = { id: string; clientName: string; material: string; quantity: string; unit: string; codigo: string | null; meMaterialId: string | null; hint: string };
const newRow = (clientName = ""): Row => ({ id: newKey(), clientName, material: "", quantity: "", unit: "u", codigo: null, meMaterialId: null, hint: "" });

function MaterialField({ row, onChange }: { row: Row; onChange: (patch: Partial<Row>) => void }) {
  const [options, setOptions] = useState<MaterialOption[]>([]);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  const search = (text: string) => {
    if (timer.current) clearTimeout(timer.current);
    if (text.trim().length < 2) {
      setOptions([]);
      return;
    }
    timer.current = setTimeout(() => {
      fetchMaterials(text)
        .then((m) => {
          setOptions(m);
          setOpen(true);
        })
        .catch(() => setOptions([]));
    }, 250);
  };
  return (
    <div className="relative">
      <label className={labelCls}>
        Material
        <input
          className={fieldCls}
          value={row.material}
          placeholder="Ej.: frascos de shampoo 250 ml"
          onChange={(e) => {
            // Si se edita el texto, se desvincula del inventario ME (queda como material libre).
            onChange({ material: e.target.value, codigo: null, meMaterialId: null, hint: "" });
            search(e.target.value);
          }}
          onFocus={() => options.length && setOpen(true)}
          data-testid="ubi-add-material"
          autoComplete="off"
        />
      </label>
      {row.meMaterialId ? <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-300" data-testid="ubi-add-linked">Vinculado al inventario ME · {row.codigo}{row.hint ? ` · ${row.hint}` : ""}</p> : null}
      {open && options.length ? (
        <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-[var(--os-border)] bg-[var(--os-surface)] shadow-lg" role="listbox" data-testid="ubi-add-suggestions">
          {options.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                className="block min-h-11 w-full px-3 py-2 text-left text-sm hover:bg-[var(--os-bg)]"
                onClick={() => {
                  onChange({ material: m.descripcion || m.codigo, codigo: m.codigo, meMaterialId: m.id, unit: m.unit, clientName: row.clientName || m.cliente, hint: `stock ${fmtQty(m.stock)} · ya ubicado ${fmtQty(m.distributed)}` });
                  setOpen(false);
                }}
              >
                <span className="font-semibold">{m.codigo}</span> · {m.descripcion} <span className="text-[var(--os-text-muted)]">({m.cliente || "sin cliente"} · stock {fmtQty(m.stock)})</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function AddDialog({ location, clients, onClose, onDone }: Props & { location: UbicacionView; clients: Array<{ name: string }> }) {
  const [rows, setRows] = useState<Row[]>([newRow(location.items[0]?.clientName ?? "")]);
  const [observations, setObservations] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = useRef(newKey());
  const empty = location.items.length === 0;
  const upd = (id: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  async function submit() {
    if (busy) return;
    setError(null);
    for (const r of rows) {
      if (r.quantity.trim()) {
        const q = parseQuantity(r.quantity);
        if (!q.ok) return setError(q.message);
      }
    }
    setBusy(true);
    try {
      const res = await opAgregar({
        key: key.current,
        locationId: location.id,
        expectedVersion: location.version,
        lines: rows.map((r) => ({ clientName: r.clientName, material: r.material, quantity: r.quantity.trim() || null, unit: r.unit, codigo: r.codigo, meMaterialId: r.meMaterialId })),
        ...(empty && observations.trim() ? { observations } : {}),
      });
      onDone(res, empty ? `Ubicación ${location.code} asignada.` : `Material agregado a ${location.code}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar.");
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[92vh] w-[min(40rem,calc(100vw-16px))] max-w-[min(40rem,calc(100vw-16px))] overflow-y-auto p-4 sm:p-6" data-testid="ubi-add-dialog">
        <DialogHeader>
          <DialogTitle>{empty ? `Asignar ubicación ${location.code}` : `Agregar material a ${location.code}`}</DialogTitle>
          <DialogDescription>Indicá el cliente y los materiales del pallet. Si el material es del inventario ME, elegilo de la lista: se controla que no supere el stock disponible.</DialogDescription>
        </DialogHeader>
        <datalist id="ubi-clients">{clients.map((c) => <option key={c.name} value={c.name} />)}</datalist>
        <div className="space-y-3">
          {rows.map((r, i) => (
            <div key={r.id} className="space-y-2 rounded-xl border border-[var(--os-border)] p-3" data-testid="ubi-add-row">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase text-[var(--os-text-muted)]">Renglón {i + 1}</span>
                {rows.length > 1 ? <button type="button" aria-label="Quitar renglón" className="grid size-11 place-items-center rounded-lg text-rose-600" onClick={() => setRows((rs) => rs.filter((x) => x.id !== r.id))}><Trash2 className="size-5" /></button> : null}
              </div>
              <label className={labelCls}>
                Cliente
                <input className={fieldCls} list="ubi-clients" value={r.clientName} onChange={(e) => upd(r.id, { clientName: e.target.value })} placeholder="Ej.: TRC" data-testid="ubi-add-cliente" autoComplete="off" />
              </label>
              <MaterialField row={r} onChange={(p) => upd(r.id, p)} />
              <div className="grid grid-cols-[1fr_6rem] gap-2">
                <label className={labelCls}>
                  Cantidad <span className="font-normal text-[var(--os-text-muted)]">(opcional)</span>
                  <input className={fieldCls} inputMode="decimal" value={r.quantity} onChange={(e) => upd(r.id, { quantity: e.target.value })} placeholder="Ej.: 2000" data-testid="ubi-add-cantidad" />
                </label>
                <label className={labelCls}>
                  Unidad
                  <input className={fieldCls} value={r.unit} onChange={(e) => upd(r.id, { unit: e.target.value })} />
                </label>
              </div>
            </div>
          ))}
          <Button type="button" variant="secondary" className={bigBtn} onClick={() => setRows((rs) => [...rs, newRow(rs[rs.length - 1]?.clientName ?? "")])} data-testid="ubi-add-otro"><Plus className="size-4" /> Otro material</Button>
          {empty ? (
            <label className={labelCls}>
              Observaciones <span className="font-normal text-[var(--os-text-muted)]">(opcional)</span>
              <textarea className={`${fieldCls} min-h-20`} value={observations} onChange={(e) => setObservations(e.target.value)} data-testid="ubi-add-obs" />
            </label>
          ) : null}
        </div>
        {error ? <p role="alert" className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-sm" data-testid="ubi-add-error">{error}</p> : null}
        <DialogFooter>
          <Button type="button" variant="secondary" className={bigBtn} onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button type="button" className={bigBtn} onClick={() => void submit()} disabled={busy} data-testid="ubi-add-guardar">{busy ? "Guardando…" : empty ? "Asignar" : "Agregar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ───────────────────────── Trasladar ─────────────────────────

export function TransferDialog({ from, locations, onClose, onDone }: Props & { from: UbicacionView; locations: UbicacionView[] }) {
  const targets = useMemo(() => locations.filter((l) => l.active && l.id !== from.id).sort((a, b) => a.sortOrder - b.sortOrder), [locations, from.id]);
  const [toId, setToId] = useState("");
  const [all, setAll] = useState(true);
  const [sel, setSel] = useState<Record<string, { on: boolean; qty: string }>>(() => Object.fromEntries(from.items.map((i) => [i.id, { on: false, qty: "" }])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = useRef(newKey());
  const to = targets.find((t) => t.id === toId);

  async function submit() {
    if (busy) return;
    setError(null);
    if (!toId) return setError("Elegí la ubicación de destino.");
    const lines = from.items.filter((i) => sel[i.id]?.on).map((i) => ({ itemId: i.id, quantity: sel[i.id]!.qty.trim() || null }));
    if (!all) {
      if (!lines.length) return setError("Elegí al menos un material para mover.");
      for (const l of lines) {
        if (l.quantity != null) {
          const q = parseQuantity(l.quantity);
          if (!q.ok) return setError(q.message);
        }
      }
    }
    setBusy(true);
    try {
      const res = await opTrasladar({ key: key.current, fromId: from.id, toId, expectedVersion: from.version, expectedToVersion: to?.version, ...(all ? { all: true } : { lines }) });
      onDone(res, `Traslado de ${from.code} a ${to?.code ?? "destino"} registrado.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo trasladar.");
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[92vh] w-[min(36rem,calc(100vw-16px))] max-w-[min(36rem,calc(100vw-16px))] overflow-y-auto p-4 sm:p-6" data-testid="ubi-transfer-dialog">
        <DialogHeader>
          <DialogTitle>Mover desde {from.code}</DialogTitle>
          <DialogDescription>Trasladá todo el contenido o solo una parte. El total se conserva y queda registrado en el historial.</DialogDescription>
        </DialogHeader>
        <label className={labelCls}>
          Ubicación de destino
          <select className={fieldCls} value={toId} onChange={(e) => setToId(e.target.value)} data-testid="ubi-transfer-destino">
            <option value="">Elegí…</option>
            {targets.map((t) => <option key={t.id} value={t.id}>{t.code} · {t.items.length ? `Ocupada (${t.items.map((i) => i.clientName).filter((v, k, a) => a.indexOf(v) === k).join(", ")})` : "Libre"}</option>)}
          </select>
        </label>
        <div className="flex gap-2" role="group" aria-label="Qué mover">
          <button type="button" className={`${bigBtn} flex-1 rounded-lg border px-3 text-sm font-semibold ${all ? "border-[var(--color-action)] bg-[var(--color-action)] text-white" : "border-[var(--os-border)]"}`} onClick={() => setAll(true)} data-testid="ubi-transfer-todo">Todo el contenido</button>
          <button type="button" className={`${bigBtn} flex-1 rounded-lg border px-3 text-sm font-semibold ${!all ? "border-[var(--color-action)] bg-[var(--color-action)] text-white" : "border-[var(--os-border)]"}`} onClick={() => setAll(false)} data-testid="ubi-transfer-parcial">Elegir materiales</button>
        </div>
        {!all ? (
          <ul className="space-y-2" data-testid="ubi-transfer-items">
            {from.items.map((i) => (
              <li key={i.id} className="rounded-xl border border-[var(--os-border)] p-3">
                <label className="flex min-h-11 items-center gap-3 text-sm">
                  <input type="checkbox" className="size-5" checked={sel[i.id]?.on ?? false} onChange={(e) => setSel((s) => ({ ...s, [i.id]: { on: e.target.checked, qty: s[i.id]?.qty ?? "" } }))} data-testid="ubi-transfer-check" />
                  <span className="min-w-0 flex-1"><strong>{i.clientName}</strong> · {i.material}<br /><span className="text-[var(--os-text-muted)]">Hay {fmtQty(i.quantity, i.unit)}</span></span>
                </label>
                {sel[i.id]?.on && i.quantity != null ? (
                  <label className={`${labelCls} mt-1`}>
                    Cantidad a mover <span className="font-normal text-[var(--os-text-muted)]">(vacío = todo)</span>
                    <input className={fieldCls} inputMode="decimal" value={sel[i.id]!.qty} onChange={(e) => setSel((s) => ({ ...s, [i.id]: { on: true, qty: e.target.value } }))} placeholder={String(i.quantity)} data-testid="ubi-transfer-cantidad" />
                  </label>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        {error ? <p role="alert" className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-sm" data-testid="ubi-transfer-error">{error}</p> : null}
        <DialogFooter>
          <Button type="button" variant="secondary" className={bigBtn} onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button type="button" className={bigBtn} onClick={() => void submit()} disabled={busy} data-testid="ubi-transfer-confirmar">{busy ? "Moviendo…" : "Mover"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ───────────────────────── Retirar un material ─────────────────────────

export function RemoveDialog({ location, itemId, onClose, onDone }: Props & { location: UbicacionView; itemId: string }) {
  const item = location.items.find((i) => i.id === itemId);
  const [qty, setQty] = useState(item?.quantity != null ? String(item.quantity) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = useRef(newKey());
  if (!item) return null;
  async function submit() {
    if (busy || !item) return;
    setError(null);
    if (item.quantity != null) {
      const q = parseQuantity(qty);
      if (!q.ok) return setError(q.message);
    }
    setBusy(true);
    try {
      const res = await opRetirar({ key: key.current, locationId: location.id, expectedVersion: location.version, lines: [{ itemId, quantity: item.quantity == null ? null : qty }] });
      onDone(res, `Material retirado de ${location.code}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo retirar.");
      setBusy(false);
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="w-[min(28rem,calc(100vw-16px))] max-w-[min(28rem,calc(100vw-16px))] p-4 sm:p-6" data-testid="ubi-remove-dialog">
        <DialogHeader>
          <DialogTitle>Retirar de {location.code}</DialogTitle>
          <DialogDescription>{item.clientName} · {item.material}. Hay {fmtQty(item.quantity, item.unit)}. Retirar no cambia el stock del depósito: solo lo saca de esta ubicación.</DialogDescription>
        </DialogHeader>
        {item.quantity != null ? (
          <label className={labelCls}>
            Cantidad a retirar
            <input className={fieldCls} inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} data-testid="ubi-remove-cantidad" />
          </label>
        ) : null}
        {error ? <p role="alert" className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-sm">{error}</p> : null}
        <DialogFooter>
          <Button type="button" variant="secondary" className={bigBtn} onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button type="button" variant="destructive" className={bigBtn} onClick={() => void submit()} disabled={busy} data-testid="ubi-remove-confirmar">{busy ? "Retirando…" : "Retirar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ───────────────────────── Historial ─────────────────────────

export function HistoryDialog({ location, onClose }: { location: UbicacionView | null; onClose: () => void }) {
  const [rows, setRows] = useState<MovementView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    fetchHistory(location?.id)
      .then((r) => alive && setRows(r))
      .catch((e) => alive && setError(e instanceof Error ? e.message : "No se pudo cargar el historial."));
    return () => {
      alive = false;
    };
  }, [location?.id]);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] w-[min(44rem,calc(100vw-16px))] max-w-[min(44rem,calc(100vw-16px))] overflow-y-auto p-4 sm:p-6" data-testid="ubi-history-dialog">
        <DialogHeader>
          <DialogTitle>{location ? `Historial de ${location.code}` : "Movimientos de ubicaciones"}</DialogTitle>
          <DialogDescription>Registro permanente: no se puede editar ni borrar.</DialogDescription>
        </DialogHeader>
        {error ? <p role="alert" className="text-sm text-rose-600">{error}</p> : null}
        {rows === null && !error ? <p className="text-sm text-[var(--os-text-muted)]">Cargando…</p> : null}
        {rows?.length === 0 ? <p className="text-sm text-[var(--os-text-muted)]" data-testid="ubi-history-vacio">Todavía no hay movimientos.</p> : null}
        <ol className="space-y-2" data-testid="ubi-history-list">
          {rows?.map((m) => (
            <li key={m.id} className="rounded-xl border border-[var(--os-border)] p-3 text-sm" data-testid="ubi-history-item" data-kind={m.kind}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <strong>{MOVEMENT_KIND_LABEL[m.kind] ?? m.kind}{m.fromCode || m.toCode ? ` · ${m.fromCode ?? "—"} → ${m.toCode ?? "—"}` : ""}</strong>
                <span className="text-xs text-[var(--os-text-muted)]">{fmtDate(m.createdAt)} · {m.actorName ?? m.actorEmail}</span>
              </div>
              {m.lines.length ? (
                <ul className="mt-1 list-disc pl-5">
                  {m.lines.map((l, k) => (
                    <li key={k}>{l.clientName} · {l.material}: <strong>{fmtQty(l.quantity, l.unit)}</strong>{l.remaining != null ? <span className="text-[var(--os-text-muted)]"> (queda {fmtQty(l.remaining, l.unit)})</span> : null}</li>
                  ))}
                </ul>
              ) : null}
              {m.kind === "OBSERVACION" ? <p className="mt-1 text-[var(--os-text-muted)]">«{String(m.detail.after ?? "")}»</p> : null}
              {m.kind === "CONFIG" ? <p className="mt-1 text-[var(--os-text-muted)]">{String(m.detail.action ?? "")}</p> : null}
            </li>
          ))}
        </ol>
      </DialogContent>
    </Dialog>
  );
}
