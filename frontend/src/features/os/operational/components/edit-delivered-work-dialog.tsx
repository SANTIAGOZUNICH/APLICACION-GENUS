"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatQty } from "@/lib/planning/circuit/delivery-math";
import { mergePackingGroups, packingTotals, resolveBoxesEntry, samePacking } from "@/lib/remitos/delivery-boxes-input";
import type { PackingGroup } from "@/lib/remitos/packing-math";
import type { InternalDeliveryDto } from "@/lib/planning/internal-deliveries-service";
import { DeliveryBoxesSection } from "./delivery-boxes-section";

type Json = Record<string, unknown>;

async function api<T = Json>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", credentials: "same-origin", ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const json = (await res.json().catch(() => ({}))) as Json;
  if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "No se pudo completar la operación.");
  return json as T;
}

const fmt = (n: number | null | undefined) => (n == null ? "—" : new Intl.NumberFormat("es-AR", { maximumFractionDigits: 3 }).format(n));
const fmtDate = (iso: string) => new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
const parseQty = (t: string) => { const n = Number(t.trim().replace(/\./g, "").replace(",", ".")); return t.trim() !== "" && Number.isFinite(n) ? n : null; };

/** Un renglón editable por cada entrega activa del trabajo. */
type Row = { d: InternalDeliveryDto; qty: string; obs: string; boxes: PackingGroup[]; showBoxes: boolean };

export type EditDeliveredWorkTarget = {
  /** Id del REGISTRO de entrega (work_item_deliveries) — se usa solo para entregas históricas sin renglones. */
  deliveryRecordId: string;
  /** Id real del trabajo (sin prefijo «native:»). */
  workItemId: string;
  client: string;
  product: string;
  lote: string | null;
  unit: string;
  /** Cantidad solicitada / asignada original: se muestra y NO se modifica. */
  plannedQuantity: string | null;
  /** Datos del registro agregado (solo se usan en entregas históricas sin renglones). */
  quantity: string | null;
  observations: string | null;
  packingGroups: Array<{ cajas: number; unidadesPorCaja: number }>;
};

/**
 * «Editar trabajo entregado» (Producción → Entregados): corrige cantidades, cajas, unidades por caja, su distribución y observaciones de
 * un trabajo que YA figura como ENTREGADO, sin devolverlo a Pendientes. Cada entrega se corrige con la misma lógica y auditoría que las
 * entregas internas: no se crea ninguna entrega nueva ni se duplican unidades, y la cantidad solicitada no cambia.
 */
export function EditDeliveredWorkDialog({ target, onClose, onSaved }: { target: EditDeliveredWorkTarget; onClose: () => void; onSaved: (message: string) => void }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [legacy, setLegacy] = useState<{ qty: string; obs: string; boxes: PackingGroup[]; showBoxes: boolean } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  useEffect(() => {
    let off = false;
    void api<{ items: InternalDeliveryDto[] }>(`/api/v1/internal-deliveries?workItemId=${encodeURIComponent(target.workItemId)}&status=ACTIVA`)
      .then((json) => {
        if (off) return;
        const lines = json.items.filter((i) => i.kind === "PRODUCCION").sort((a, b) => a.sequence - b.sequence);
        if (lines.length === 0) {
          setLegacy({ qty: target.quantity ?? "", obs: target.observations ?? "", boxes: target.packingGroups.map((g) => ({ ...g })), showBoxes: target.packingGroups.length > 0 });
          setRows([]);
        } else {
          setRows(lines.map((d) => ({ d, qty: formatQty(d.quantity), obs: d.observations ?? "", boxes: d.packingGroups.map((g) => ({ cajas: g.cajas, unidadesPorCaja: g.unidadesPorCaja })), showBoxes: d.packingGroups.length > 0 })));
        }
      })
      .catch((e) => { if (!off) setLoadError(e instanceof Error ? e.message : "No pudimos cargar las entregas del trabajo."); });
    return () => { off = true; };
  }, [target.workItemId, target.quantity, target.observations, target.packingGroups]);

  const setRow = (i: number, patch: Partial<Row>) => setRows((prev) => prev?.map((r, k) => (k === i ? { ...r, ...patch } : r)) ?? prev);

  // Totales en vivo (lo que quedaría tras guardar).
  const live = (() => {
    if (legacy) {
      const e = resolveBoxesEntry({ quantity: parseQty(legacy.qty), groups: legacy.showBoxes ? legacy.boxes : [] });
      const units = e.ok && e.quantity != null ? e.quantity : (parseQty(legacy.qty) ?? 0);
      return { units, cajas: e.ok ? e.cajas : 0, groups: e.ok ? e.groups : [] };
    }
    const entries = (rows ?? []).map((r) => resolveBoxesEntry({ quantity: parseQty(r.qty), groups: r.showBoxes ? r.boxes : [] }));
    const units = (rows ?? []).reduce((s, r, i) => { const e = entries[i]!; return s + (e.ok && e.quantity != null ? e.quantity : (parseQty(r.qty) ?? 0)); }, 0);
    const groups = mergePackingGroups(entries.map((e) => (e.ok ? e.groups : [])));
    return { units, cajas: packingTotals(groups).cajas, groups };
  })();

  async function save() {
    if (busyRef.current) return; // doble clic
    setError(null);
    busyRef.current = true;
    setBusy(true);
    try {
      let message = "Trabajo entregado actualizado. Entregados y el remito ya usan los nuevos datos.";
      if (legacy) {
        const e = resolveBoxesEntry({ quantity: parseQty(legacy.qty), groups: legacy.showBoxes ? legacy.boxes : [] });
        if (!e.ok) throw new Error(e.error);
        await api("/api/v1/internal-deliveries", { method: "POST", body: JSON.stringify({ action: "edit_legacy", deliveryId: target.deliveryRecordId, quantity: e.quantity ?? legacy.qty, observations: legacy.obs.trim(), packingGroups: e.groups }) });
      } else {
        const edits: Json[] = [];
        for (const r of rows ?? []) {
          const e = resolveBoxesEntry({ quantity: parseQty(r.qty), groups: r.showBoxes ? r.boxes : [] });
          if (!e.ok) throw new Error(`Entrega #${r.d.sequence}: ${e.error}`);
          const edit: Json = { id: r.d.id, expectedVersion: r.d.version };
          let changed = false;
          const q = e.quantity;
          if (q != null && Math.abs(q - r.d.quantity) > 1e-9) { edit.quantity = String(q); changed = true; }
          if (r.obs.trim() !== (r.d.observations ?? "").trim()) { edit.observations = r.obs.trim(); changed = true; }
          if (!samePacking(e.groups, r.d.packingGroups)) { edit.packingGroups = e.groups; changed = true; }
          if (changed) edits.push(edit);
        }
        if (edits.length === 0) throw new Error("No hay cambios para guardar.");
        const res = await api<{ notice?: string | null }>("/api/v1/internal-deliveries", { method: "POST", body: JSON.stringify({ action: "edit_work", workItemId: target.workItemId, edits }) });
        if (res.notice) message += ` ${res.notice}`;
      }
      onSaved(message);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos guardar los cambios.");
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent data-testid="edit-delivered-dialog">
        <DialogHeader>
          <DialogTitle>Editar trabajo entregado</DialogTitle>
          <DialogDescription>
            Corregí la cantidad real entregada, las cajas y las unidades por caja sin devolver el trabajo a Pendientes. La cantidad solicitada ({target.plannedQuantity ? `${target.plannedQuantity} ${target.unit}` : "—"}) no cambia.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[62vh] space-y-3 overflow-y-auto text-sm">
          <dl className="grid grid-cols-2 gap-2 rounded border border-[var(--os-border)] p-3">
            <div><dt className="text-xs uppercase text-[var(--os-text-muted)]">Cliente</dt><dd>{target.client || "—"}</dd></div>
            <div><dt className="text-xs uppercase text-[var(--os-text-muted)]">Producto</dt><dd>{target.product}</dd></div>
            <div><dt className="text-xs uppercase text-[var(--os-text-muted)]">Lote</dt><dd className="font-mono text-xs">{target.lote ?? "—"}</dd></div>
            <div><dt className="text-xs uppercase text-[var(--os-text-muted)]">Cantidad solicitada</dt><dd data-testid="edw-planned">{target.plannedQuantity ?? "—"} {target.unit}</dd></div>
          </dl>
          {loadError ? <p role="alert" className="text-amber-300" data-testid="edw-load-error">{loadError}</p> : null}
          {rows === null && !loadError ? <p>Cargando…</p> : null}
          {legacy ? (
            <div className="space-y-2 rounded border border-[var(--os-border)] p-3" data-testid="edw-legacy">
              <p className="text-xs text-[var(--os-text-muted)]">Entrega registrada antes del seguimiento por renglones: se corrige el registro de la entrega.</p>
              <label className="block"><span className="font-medium">Cantidad total entregada ({target.unit})</span>
                <input className="mt-1 w-full rounded border border-[var(--os-border)] bg-transparent px-3 py-2 tabular-nums" inputMode="numeric" value={legacy.qty} onChange={(e) => setLegacy({ ...legacy, qty: e.target.value })} data-testid="edw-legacy-qty" /></label>
              <label className="block"><span className="font-medium">Observaciones</span>
                <textarea className="mt-1 w-full rounded border border-[var(--os-border)] bg-transparent px-3 py-2" rows={2} value={legacy.obs} onChange={(e) => setLegacy({ ...legacy, obs: e.target.value })} data-testid="edw-legacy-obs" /></label>
              <DeliveryBoxesSection boxes={legacy.boxes} onBoxesChange={(boxes) => setLegacy({ ...legacy, boxes })} expected={parseQty(legacy.qty)} onUseTotal={(t) => setLegacy({ ...legacy, qty: String(t) })} open={legacy.showBoxes} onOpenChange={(showBoxes) => setLegacy({ ...legacy, showBoxes })} prefix="edw-legacy" label="Cajas de la entrega" />
            </div>
          ) : null}
          {rows?.map((r, i) => (
            <div key={r.d.id} className="space-y-2 rounded border border-[var(--os-border)] p-3" data-testid="edw-row" data-delivery-id={r.d.id}>
              <p className="font-medium">Entrega #{r.d.sequence} · {r.d.originLabel} · {fmtDate(r.d.date)}</p>
              {r.d.remito ? <p className="text-xs text-amber-300" data-testid="edw-remito">Ya figura en remitos vigentes ({fmt(r.d.remitted)} u.): solo se puede subir la cantidad o cambiar observaciones; para bajarla o cambiar las cajas, primero anulá o reemplazá el remito.</p> : null}
              <label className="block"><span className="font-medium">Cantidad entregada ({r.d.unit}) — si cargás cajas, el total se calcula</span>
                <input className="mt-1 w-full rounded border border-[var(--os-border)] bg-transparent px-3 py-2 tabular-nums" inputMode="numeric" value={r.qty} onChange={(e) => setRow(i, { qty: e.target.value })} data-testid="edw-qty" /></label>
              <label className="block"><span className="font-medium">Observaciones</span>
                <textarea className="mt-1 w-full rounded border border-[var(--os-border)] bg-transparent px-3 py-2" rows={2} value={r.obs} onChange={(e) => setRow(i, { obs: e.target.value })} data-testid="edw-obs" /></label>
              <DeliveryBoxesSection boxes={r.boxes} onBoxesChange={(boxes) => setRow(i, { boxes })} expected={parseQty(r.qty)} onUseTotal={(t) => setRow(i, { qty: String(t) })} open={r.showBoxes} onOpenChange={(showBoxes) => setRow(i, { showBoxes })} prefix={`edw-${i}`} label="Cajas de la entrega" />
            </div>
          ))}
          <p className="rounded bg-white/5 px-3 py-2 font-medium" data-testid="edw-total">
            Total entregado: {fmt(live.units)} {target.unit}{live.cajas > 0 ? ` en ${live.cajas} ${live.cajas === 1 ? "caja" : "cajas"}` : ""}
          </p>
          {error ? <p role="alert" className="text-amber-300" data-testid="edw-error">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cerrar</Button>
          <Button onClick={() => void save()} disabled={busy || (rows === null && !loadError)} data-testid="edw-save">{busy ? "Guardando…" : "Guardar cambios"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
