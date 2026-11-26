"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fetchHistory, fetchIngresos, fetchMaterials, newKey, opAgregar, opClientes, opIngresoAjustar, opIngresoRetirar, opIngresoMe, opRetirar, opTrasladar, opVincular } from "@/lib/ubicaciones/client";
import { MOVEMENT_KIND_LABEL, clientKeyOf, cleanLabel, fmtQty, parseQuantity, similarFreeItems } from "@/lib/ubicaciones/rules";
import type { IngresoPendiente, IngresoReview, MaterialOption, MovementView, OpResultView, UbicacionItemView, UbicacionView } from "@/lib/ubicaciones/types";

export const fieldCls = "mt-1 block min-h-11 w-full rounded-lg border border-[var(--os-border)] bg-[var(--os-surface)] px-3 py-2 text-base";
const labelCls = "block text-sm font-medium";
const bigBtn = "min-h-11";

export const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", dateStyle: "short", timeStyle: "short" }) : "—");

type Props = { onClose: () => void; onDone: (r: OpResultView, message: string) => void };

// ───────────────────────── Asignar / agregar ─────────────────────────

type Row = { id: string; clientName: string; material: string; quantity: string; unit: string; codigo: string | null; meMaterialId: string | null; hint: string; mergeIntoItemId: string | null };
const newRow = (clientName = ""): Row => ({ id: newKey(), clientName, material: "", quantity: "", unit: "u", codigo: null, meMaterialId: null, hint: "", mergeIntoItemId: null });

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
            onChange({ material: e.target.value, codigo: null, meMaterialId: null, hint: "", mergeIntoItemId: null });
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
        lines: rows.map((r) => ({ clientName: r.clientName, material: r.material, quantity: r.quantity.trim() || null, unit: r.unit, codigo: r.codigo, meMaterialId: r.meMaterialId, mergeIntoItemId: r.meMaterialId ? null : r.mergeIntoItemId })),
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
              {!r.meMaterialId && r.material.trim() ? (
                <div className="rounded-lg bg-amber-500/10 p-2 text-xs" data-testid="ubi-add-sinverificar">
                  <p><strong>Sin vincular al inventario ME:</strong> la cantidad queda como «Sin verificar» y no se controla contra el stock.</p>
                  {similarFreeItems(location.items, r).length ? (
                    <fieldset className="mt-2 space-y-1" data-testid="ubi-add-similar">
                      <legend className="font-semibold">Ya hay un material parecido en esta ubicación:</legend>
                      <label className="flex min-h-11 items-center gap-2 text-sm"><input type="radio" className="size-5" name={`m-${r.id}`} checked={!r.mergeIntoItemId} onChange={() => upd(r.id, { mergeIntoItemId: null })} data-testid="ubi-add-aparte" /> Crear aparte (recomendado)</label>
                      {similarFreeItems(location.items, r).slice(0, 3).map((s) => (
                        <label key={s.id} className="flex min-h-11 items-center gap-2 text-sm"><input type="radio" className="size-5" name={`m-${r.id}`} checked={r.mergeIntoItemId === s.id} onChange={() => upd(r.id, { mergeIntoItemId: s.id })} data-testid="ubi-add-sumar" /> Sumar a «{s.material}» ({fmtQty(s.quantity, s.unit)})</label>
                      ))}
                    </fieldset>
                  ) : null}
                </div>
              ) : null}
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

// ───────────────────────── Clientes asignados (sin materiales) ─────────────────────────

export function ClientsDialog({ location, clients, onClose, onDone }: Props & { location: UbicacionView; clients: Array<{ name: string }> }) {
  const [text, setText] = useState("");
  const [adds, setAdds] = useState<string[]>([]);
  const [removes, setRemoves] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = useRef(newKey());
  const current = location.clients.filter((c) => !removes.includes(c.clientKey));
  const known = new Set([...current.map((c) => c.clientKey), ...adds.map((n) => clientKeyOf(n) ?? n)]);

  function addName() {
    const name = cleanLabel(text);
    if (!name) return;
    const k = clientKeyOf(name);
    if (!k) return setError("Indicá el nombre del cliente (por ejemplo TRC).");
    if (known.has(k)) {
      setText("");
      return setError("Ese cliente ya está en la lista.");
    }
    setError(null);
    // Si se quitó y se vuelve a escribir, simplemente se cancela la baja.
    if (removes.includes(k)) setRemoves((r) => r.filter((x) => x !== k));
    else setAdds((a) => [...a, name]);
    setText("");
  }
  async function submit() {
    if (busy) return;
    const pending = cleanLabel(text);
    const addList = pending && !known.has(clientKeyOf(pending) ?? pending) ? [...adds, pending] : adds;
    if (!addList.length && !removes.length) return setError("No hay cambios para guardar.");
    setBusy(true);
    setError(null);
    try {
      const res = await opClientes({ key: key.current, locationId: location.id, expectedVersion: location.version, add: addList, remove: removes });
      onDone(res, `Clientes de ${location.code} actualizados.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar.");
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[92vh] w-[min(34rem,calc(100vw-16px))] max-w-[min(34rem,calc(100vw-16px))] overflow-y-auto p-4 sm:p-6" data-testid="ubi-clientes-dialog">
        <DialogHeader>
          <DialogTitle>Clientes de {location.code}</DialogTitle>
          <DialogDescription>Asigná uno o varios clientes a esta ubicación sin cargar materiales. Con un cliente asignado la ubicación queda ocupada. Los clientes que tienen materiales almacenados no se pueden quitar.</DialogDescription>
        </DialogHeader>
        <datalist id="ubi-clients-asignar">{clients.map((c) => <option key={c.name} value={c.name} />)}</datalist>
        <ul className="space-y-1.5" data-testid="ubi-clientes-lista">
          {current.map((c) => (
            <li key={c.clientKey} className="flex min-h-11 items-center justify-between gap-2 rounded-lg border border-[var(--os-border)] px-3 py-1.5 text-sm" data-testid="ubi-clientes-item" data-removable={c.removable}>
              <span className="min-w-0 break-words font-semibold">{c.clientName}{c.hasMaterials ? <span className="ml-2 rounded bg-sky-200 px-1.5 text-xs font-bold text-sky-950" data-testid="ubi-clientes-conmateriales">con materiales</span> : null}</span>
              <button type="button" className="grid size-11 shrink-0 place-items-center rounded-lg text-rose-600 hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-35" disabled={!c.removable || busy} title={c.removable ? "Quitar cliente" : "Tiene materiales almacenados: retiralos primero"} aria-label={c.removable ? `Quitar ${c.clientName}` : `${c.clientName} tiene materiales: no se puede quitar`} onClick={() => setRemoves((r) => [...r, c.clientKey])} data-testid="ubi-clientes-quitar"><X className="size-5" /></button>
            </li>
          ))}
          {adds.map((n) => (
            <li key={n} className="flex min-h-11 items-center justify-between gap-2 rounded-lg border border-emerald-500/50 bg-emerald-500/10 px-3 py-1.5 text-sm" data-testid="ubi-clientes-nuevo">
              <span className="min-w-0 break-words font-semibold">{n} <span className="text-xs font-normal text-[var(--os-text-muted)]">(nuevo)</span></span>
              <button type="button" className="grid size-11 shrink-0 place-items-center rounded-lg text-rose-600" aria-label={`Descartar ${n}`} onClick={() => setAdds((a) => a.filter((x) => x !== n))}><X className="size-5" /></button>
            </li>
          ))}
          {!current.length && !adds.length ? <li className="rounded-lg border border-dashed border-[var(--os-border)] p-3 text-sm text-[var(--os-text-muted)]">Sin clientes asignados.</li> : null}
        </ul>
        <div className="flex items-end gap-2">
          <label className={`${labelCls} min-w-0 flex-1`}>
            Cliente
            <input className={fieldCls} list="ubi-clients-asignar" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addName(); } }} placeholder="Ej.: TRC" autoComplete="off" data-testid="ubi-clientes-input" />
          </label>
          <Button type="button" variant="secondary" className={bigBtn} onClick={addName} data-testid="ubi-clientes-agregar"><Plus className="size-4" /> Agregar</Button>
        </div>
        {error ? <p role="alert" className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-sm" data-testid="ubi-clientes-error">{error}</p> : null}
        <DialogFooter>
          <Button type="button" variant="secondary" className={bigBtn} onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button type="button" className={bigBtn} onClick={() => void submit()} disabled={busy} data-testid="ubi-clientes-guardar">{busy ? "Guardando…" : "Guardar"}</Button>
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

const ACTION_LABEL: Record<string, string> = { cliente_asignado: "Cliente asignado", cliente_quitado: "Cliente quitado", vincular: "Vinculado a material ME", ajuste_ingreso: "Ajuste por ingreso de ME modificado", ingreso_anulado: "Retiro por ingreso de ME anulado", ubicar: "Ingreso de ME ubicado" };
const movementLabel = (m: MovementView) => ACTION_LABEL[String(m.detail.action ?? "")] ?? MOVEMENT_KIND_LABEL[m.kind] ?? m.kind;

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
                <strong>{movementLabel(m)}{m.fromCode || m.toCode ? ` · ${m.fromCode ?? "—"} → ${m.toCode ?? "—"}` : ""}</strong>
                <span className="text-xs text-[var(--os-text-muted)]">{fmtDate(m.createdAt)} · {m.actorName ?? m.actorEmail}</span>
              </div>
              {m.lines.length ? (
                <ul className="mt-1 list-disc pl-5">
                  {m.lines.map((l, k) => (
                    <li key={k}>{l.clientName}{!l.material ? " (sin materiales)" : ""}{l.material ? <> · {l.material}: <strong>{fmtQty(l.quantity, l.unit)}</strong></> : null}{l.material && l.verified === false ? <span className="ml-1 rounded bg-amber-200 px-1 text-xs font-bold text-amber-950">Sin verificar</span> : null}{l.remaining != null ? <span className="text-[var(--os-text-muted)]"> (queda {fmtQty(l.remaining, l.unit)})</span> : null}</li>
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

// ───────────────────────── Vincular un renglón a un material ME ─────────────────────────

export function LinkDialog({ location, item, onClose, onDone }: Props & { location: UbicacionView; item: UbicacionItemView }) {
  const [q, setQ] = useState(item.material);
  const [options, setOptions] = useState<MaterialOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = useRef(newKey());
  useEffect(() => {
    const t = setTimeout(() => {
      fetchMaterials(q).then(setOptions).catch(() => setOptions([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);
  async function link(m: MaterialOption) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      onDone(await opVincular({ key: key.current, locationId: location.id, itemId: item.id, meMaterialId: m.id, expectedVersion: location.version }), `«${item.material}» vinculado a ${m.codigo}: ahora está verificado.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo vincular.");
      setBusy(false);
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[92vh] w-[min(36rem,calc(100vw-16px))] max-w-[min(36rem,calc(100vw-16px))] overflow-y-auto p-4 sm:p-6" data-testid="ubi-link-dialog">
        <DialogHeader>
          <DialogTitle>Vincular a material ME</DialogTitle>
          <DialogDescription>{item.clientName} · {item.material}: {fmtQty(item.quantity, item.unit)}. Al vincularlo, la cantidad se controla contra el stock disponible del material elegido.</DialogDescription>
        </DialogHeader>
        <label className={labelCls}>
          Buscar material del inventario
          <input className={fieldCls} value={q} onChange={(e) => setQ(e.target.value)} data-testid="ubi-link-buscar" autoComplete="off" />
        </label>
        <ul className="max-h-64 space-y-1 overflow-auto" data-testid="ubi-link-opciones">
          {options.map((m) => (
            <li key={m.id}>
              <button type="button" className="block min-h-11 w-full rounded-lg border border-[var(--os-border)] px-3 py-2 text-left text-sm hover:bg-[var(--os-bg)]" disabled={busy} onClick={() => void link(m)} data-testid="ubi-link-opcion">
                <strong>{m.codigo}</strong> · {m.descripcion} <span className="text-[var(--os-text-muted)]">({m.cliente || "sin cliente"}) · stock {fmtQty(m.stock)} · ya ubicado verificado {fmtQty(m.distributed)}</span>
              </button>
            </li>
          ))}
          {!options.length ? <li className="text-sm text-[var(--os-text-muted)]">Sin resultados.</li> : null}
        </ul>
        {error ? <p role="alert" className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-sm" data-testid="ubi-link-error">{error}</p> : null}
        <DialogFooter><Button type="button" variant="secondary" className={bigBtn} onClick={onClose} disabled={busy}>Cancelar</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ───────────────────────── Ingresos ME sin ubicar / a revisar ─────────────────────────

export function IngresosPanel({ locations, refreshToken, onDone }: { locations: UbicacionView[]; refreshToken: number; onDone: (r: OpResultView, message: string) => void }) {
  const [data, setData] = useState<{ unplaced: IngresoPendiente[]; review: IngresoReview[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [placing, setPlacing] = useState<IngresoPendiente | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const run = () => fetchIngresos().then((d) => alive && (setData(d), setError(null))).catch((e) => alive && setError(e instanceof Error ? e.message : "No se pudo cargar."));
    run();
    const t = setInterval(() => document.visibilityState === "visible" && run(), 15_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [refreshToken]);
  async function act(id: string, fn: () => Promise<OpResultView>, msg: string) {
    if (busyId) return;
    setBusyId(id);
    try {
      onDone(await fn(), msg);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo completar.");
    } finally {
      setBusyId(null);
    }
  }
  const n = (data?.unplaced.length ?? 0) + (data?.review.length ?? 0);
  return (
    <details className="rounded-xl border border-[var(--os-border)] p-3" open={n > 0} data-testid="ubi-ingresos">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 text-sm font-semibold">
        <span>Ingresos ME sin ubicar</span>
        <span className="rounded-full bg-amber-200 px-2 py-0.5 text-xs font-bold text-amber-950" data-testid="ubi-ingresos-count">{n}</span>
      </summary>
      {error ? <p role="alert" className="mt-2 text-xs text-rose-600" data-testid="ubi-ingresos-error">{error}</p> : null}
      <div className="mt-2 space-y-2">
        {data?.review.map((r) => (
          <div key={r.ingresoId} className="rounded-lg border border-amber-500/60 bg-amber-500/10 p-2 text-sm" data-testid="ubi-ingreso-revisar" data-reason={r.reason}>
            <p className="font-semibold">{r.reason === "ANULADO" ? "Ingreso anulado: revisar ubicación" : `Ingreso modificado: ${r.diff > 0 ? "+" : ""}${fmtQty(r.diff, r.unit)}`}</p>
            <p className="text-xs text-[var(--os-text-muted)]">{r.ingresoNro ? `#${r.ingresoNro} · ` : ""}{r.cliente} · {r.material} · ubicado {fmtQty(r.applied, r.unit)} en {r.locationCode}</p>
            <Button type="button" variant="secondary" className="mt-1 min-h-11 w-full" disabled={busyId === r.ingresoId} onClick={() => void act(r.ingresoId, () => (r.reason === "ANULADO" ? opIngresoRetirar({ ingresoId: r.ingresoId }) : opIngresoAjustar({ ingresoId: r.ingresoId })), r.reason === "ANULADO" ? `Cantidad retirada de ${r.locationCode}.` : `Diferencia ajustada en ${r.locationCode}.`)} data-testid={r.reason === "ANULADO" ? "ubi-ingreso-retirar" : "ubi-ingreso-ajustar"}>
              {r.reason === "ANULADO" ? `Retirar ${fmtQty(r.applied, r.unit)} de ${r.locationCode}` : "Ajustar solo la diferencia"}
            </Button>
          </div>
        ))}
        {data?.unplaced.map((i) => (
          <div key={i.ingresoId} className="flex items-center gap-2 rounded-lg border border-[var(--os-border)] p-2 text-sm" data-testid="ubi-ingreso-fila">
            <div className="min-w-0 flex-1">
              <p className="break-words font-medium">{i.material || i.codigo}</p>
              <p className="text-xs text-[var(--os-text-muted)]">{i.fecha.split("-").reverse().join("/")} · {i.cliente || "sin cliente"} · <strong>{fmtQty(i.total, i.unit)}</strong></p>
            </div>
            <Button type="button" className="min-h-11" onClick={() => setPlacing(i)} data-testid="ubi-ingreso-ubicar">Ubicar</Button>
          </div>
        ))}
        {data && !n ? <p className="text-xs text-[var(--os-text-muted)]" data-testid="ubi-ingresos-vacio">No hay ingresos pendientes de ubicar.</p> : null}
        {data && data.unplaced.length >= 100 ? <p className="text-xs text-[var(--os-text-muted)]">Se muestran los 100 más recientes.</p> : null}
      </div>
      {placing ? <PlaceIngresoDialog ingreso={placing} locations={locations} onClose={() => setPlacing(null)} onDone={(r, m) => { setPlacing(null); onDone(r, m); }} /> : null}
    </details>
  );
}

function PlaceIngresoDialog({ ingreso, locations, onClose, onDone }: Props & { ingreso: IngresoPendiente; locations: UbicacionView[] }) {
  const [toId, setToId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    if (busy) return;
    if (!toId) return setError("Elegí la ubicación.");
    setBusy(true);
    try {
      const r = await opIngresoMe({ ingresoId: ingreso.ingresoId, locationId: toId });
      onDone(r, r.replayed ? `Este ingreso ya estaba ubicado en ${r.placedIn ?? "el mapa"}: no se sumó de nuevo.` : `Ingreso ubicado en ${r.placedIn ?? "el mapa"}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo ubicar.");
      setBusy(false);
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="w-[min(30rem,calc(100vw-16px))] max-w-[min(30rem,calc(100vw-16px))] p-4 sm:p-6" data-testid="ubi-place-dialog">
        <DialogHeader>
          <DialogTitle>Ubicar ingreso</DialogTitle>
          <DialogDescription>{ingreso.cliente} · {ingreso.material}: {fmtQty(ingreso.total, ingreso.unit)}. Se suma una sola vez, aunque toques dos veces o reintentes.</DialogDescription>
        </DialogHeader>
        <label className={labelCls}>
          Ubicación
          <select className={fieldCls} value={toId} onChange={(e) => setToId(e.target.value)} data-testid="ubi-place-destino">
            <option value="">Elegí…</option>
            {locations.filter((l) => l.active).map((l) => <option key={l.id} value={l.id}>{l.code} · {l.items.length ? "Ocupada" : "Libre"}</option>)}
          </select>
        </label>
        {error ? <p role="alert" className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-sm" data-testid="ubi-place-error">{error}</p> : null}
        <DialogFooter>
          <Button type="button" variant="secondary" className={bigBtn} onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button type="button" className={bigBtn} onClick={() => void submit()} disabled={busy} data-testid="ubi-place-confirmar">{busy ? "Ubicando…" : "Ubicar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
