"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { describeDeliveryPacking } from "@/lib/remitos/delivery-packing";
import type { EligibleDelivery, RemitoPreviewGroup } from "@/lib/remitos/delivery-grouping";
import { createRemitosFromDeliveriesApi, fetchEligibleDeliveriesApi, fetchMarkedDeliveriesApi, markDeliveriesApi, previewRemitosFromDeliveriesApi, type MarkedDeliveryView } from "@/lib/remitos/remitos-client";

type Session = { email: string; sector: string };

const fmt = (n: number) => new Intl.NumberFormat("es-AR", { maximumFractionDigits: 3 }).format(n);
const fmtDate = (iso: string) => iso.split("-").reverse().join("/");

/**
 * «Generar remitos»: entregas REALES (no producciones) todavía sin remito. Se eligen, se ve una vista previa agrupada por
 * cliente + fecha (un pedido con varios productos = un remito; clientes y fechas distintas nunca se mezclan) y recién ahí
 * se crea el borrador. Producción gestiona; Administración / Facturación solo consulta.
 */
export function RemitosGenerarPanel({ session, canManage, onCreated }: { session: Session; canManage: boolean; onCreated: () => void }) {
  const [items, setItems] = useState<EligibleDelivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<{ groups: RemitoPreviewGroup[]; missing: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [marked, setMarked] = useState<MarkedDeliveryView[]>([]);
  const [showMarked, setShowMarked] = useState(false);
  const [markDialog, setMarkDialog] = useState<null | "exclude" | "mark_created">(null);
  const [extNumber, setExtNumber] = useState("");
  const [extDate, setExtDate] = useState("");
  const [extNotes, setExtNotes] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetchEligibleDeliveriesApi(session);
      setItems(r.deliveries);
      setMarked(await fetchMarkedDeliveriesApi(session).catch(() => []));
      setSelected((prev) => new Set([...prev].filter((id) => r.deliveries.some((d) => d.deliveryLineId === id))));
      setError(r.schemaPending ? "Falta aplicar la migración de remitos en la base." : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron cargar las entregas");
    } finally {
      setLoading(false);
    }
  }, [session]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const toggle = (id: string) => setSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return items;
    return items.filter((d) => [d.client, d.product, d.pedido ?? "", d.lote, d.orderRef ?? ""].some((x) => x.toLowerCase().includes(q)));
  }, [items, filter]);
  const allVisibleSelected = visible.length > 0 && visible.every((d) => selected.has(d.deliveryLineId));
  const toggleAllVisible = () =>
    setSelected((prev) => {
      const n = new Set(prev);
      if (allVisibleSelected) visible.forEach((d) => n.delete(d.deliveryLineId));
      else visible.forEach((d) => n.add(d.deliveryLineId));
      return n;
    });
  const toggleGroup = (rows: EligibleDelivery[]) =>
    setSelected((prev) => {
      const n = new Set(prev);
      const all = rows.every((d) => n.has(d.deliveryLineId));
      rows.forEach((d) => (all ? n.delete(d.deliveryLineId) : n.add(d.deliveryLineId)));
      return n;
    });
  const byGroup = useMemo(() => {
    const m = new Map<string, EligibleDelivery[]>();
    for (const d of visible) {
      const k = `${d.client}|${d.deliveryDate}`;
      m.set(k, [...(m.get(k) ?? []), d]);
    }
    return [...m.entries()];
  }, [visible]);

  async function openPreview() {
    setBusy(true);
    setError(null);
    try {
      setPreview(await previewRemitosFromDeliveriesApi(session, [...selected]));
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo armar la vista previa");
    } finally {
      setBusy(false);
    }
  }
  async function applyMark(action: "exclude" | "mark_created" | "restore", ids: string[]) {
    if (busy || ids.length === 0) return; // doble clic
    setBusy(true);
    setError(null);
    try {
      const r = await markDeliveriesApi(session, { action, lineIds: ids, externalRemitoNumber: extNumber, externalRemitoDate: extDate || undefined, notes: extNotes });
      const n = (r.marked ?? r.restored ?? []).length;
      const sk = r.skipped?.length ?? 0;
      setNotice(
        action === "restore"
          ? `${n} entrega${n === 1 ? "" : "s"} volvieron a pendientes de remito.`
          : action === "exclude"
            ? `${n} entrega${n === 1 ? "" : "s"} quitada${n === 1 ? "" : "s"} de pendientes (se pueden restaurar).${sk ? ` ${sk} se omitió (ya estaba en un remito o marcada).` : ""}`
            : `${n} entrega${n === 1 ? "" : "s"} marcada${n === 1 ? "" : "s"} como remito ya creado.${sk ? ` ${sk} se omitió (ya estaba en un remito o marcada).` : ""}`
      );
      setMarkDialog(null);
      setExtNumber("");
      setExtDate("");
      setExtNotes("");
      setSelected(new Set());
      await load();
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo completar la acción");
    } finally {
      setBusy(false);
    }
  }
  async function confirm() {
    if (busy) return; // doble clic
    setBusy(true);
    setError(null);
    try {
      const r = await createRemitosFromDeliveriesApi(session, [...selected]);
      setPreview(null);
      setSelected(new Set());
      setNotice(`Se creó/actualizó ${r.remitos.length} borrador${r.remitos.length === 1 ? "" : "es"} de remito${r.skipped.length ? ` (${r.skipped.length} entrega${r.skipped.length === 1 ? "" : "s"} ya estaba${r.skipped.length === 1 ? "" : "n"} en un remito y se omitió)` : ""}. Revisalo en «Borradores» y generalo.`);
      await load();
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo crear el remito");
      setPreview(null);
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3" data-testid="remitos-generar">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-[var(--os-text-muted)]">Entregas reales todavía sin remito. Un remito agrupa por cliente y fecha de entrega; cada renglón conserva su pedido.</p>
        {canManage ? (
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button type="button" variant="secondary" className="min-h-11" disabled={selected.size === 0 || busy} onClick={() => setMarkDialog("exclude")} data-testid="remitos-quitar">
              Quitar de pendientes
            </Button>
            <Button type="button" variant="secondary" className="min-h-11" disabled={selected.size === 0 || busy} onClick={() => setMarkDialog("mark_created")} data-testid="remitos-ya-creado">
              Marcar como remito ya creado
            </Button>
            <Button type="button" className="min-h-11" disabled={selected.size === 0 || busy} onClick={() => void openPreview()} data-testid="remitos-hacer">
              Hacer remito ({selected.size})
            </Button>
          </div>
        ) : (
          <span className="ml-auto text-xs text-[var(--os-text-muted)]">Solo consulta</span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <input type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filtrar por cliente, producto, pedido o lote" className="min-h-11 min-w-[16rem] flex-1 rounded border border-[var(--os-border)] bg-[var(--os-surface)] px-3" data-testid="remitos-generar-filtro" />
        {canManage ? (
          <>
            <label className="flex min-h-11 items-center gap-2"><input type="checkbox" className="size-6" checked={allVisibleSelected} onChange={toggleAllVisible} data-testid="remitos-select-all" /> Seleccionar todo lo visible</label>
            <Button type="button" variant="secondary" className="min-h-11" disabled={selected.size === 0} onClick={() => setSelected(new Set())} data-testid="remitos-deselect">Deseleccionar ({selected.size})</Button>
          </>
        ) : null}
      </div>
      {notice ? <p className="rounded border border-[var(--os-teal)]/40 bg-[var(--os-teal)]/10 px-3 py-2 text-sm" data-testid="remitos-generar-notice">{notice}</p> : null}
      {error ? <p className="rounded border border-[var(--genus-warning)]/30 bg-[var(--genus-warning-soft)] px-3 py-2 text-sm text-[var(--genus-warning)]" data-testid="remitos-generar-error">{error}</p> : null}
      {loading ? <p className="text-sm text-[var(--os-text-muted)]">Cargando entregas…</p> : null}
      {!loading && items.length === 0 ? <p className="text-sm text-[var(--os-text-muted)]" data-testid="remitos-generar-empty">No hay entregas pendientes de remito.</p> : null}
      {byGroup.map(([key, rows]) => (
        <div key={key} className="overflow-x-auto rounded border border-[var(--os-border)] bg-[var(--os-surface)]" data-testid="remitos-generar-group">
          <div className="flex items-center gap-2 border-b border-[var(--os-border)] px-3 py-2 text-sm font-medium">
            {canManage ? <input type="checkbox" className="size-6" checked={rows.every((d) => selected.has(d.deliveryLineId))} onChange={() => toggleGroup(rows)} aria-label="Elegir todo el grupo" data-testid="remitos-group-check" /> : null}
            {rows[0]!.client} · entrega {fmtDate(rows[0]!.deliveryDate)}
          </div>
          <table className="w-full min-w-[44rem] text-left text-xs">
            <thead className="text-[var(--os-text-muted)]">
              <tr>
                {canManage ? <th className="w-12 px-3 py-2" /> : null}
                <th className="px-2 py-2">Pedido</th>
                <th className="px-2 py-2">Producto</th>
                <th className="px-2 py-2">Entregado</th>
                <th className="px-2 py-2">Cajas</th>
                <th className="px-2 py-2">Lote</th>
                <th className="px-2 py-2">Tipo</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.deliveryLineId} className={`border-t border-[var(--os-border)] ${selected.has(d.deliveryLineId) ? "bg-[var(--os-teal)]/15" : ""}`} data-testid="remitos-generar-row">
                  {canManage ? (
                    <td className="px-3 py-2"><input type="checkbox" className="size-6" checked={selected.has(d.deliveryLineId)} onChange={() => toggle(d.deliveryLineId)} aria-label={`Elegir ${d.product}`} data-testid="remitos-generar-check" /></td>
                  ) : null}
                  <td className="px-2 py-2">{d.pedido ?? "—"}</td>
                  <td className="px-2 py-2">{d.product}</td>
                  <td className="px-2 py-2 tabular-nums">{fmt(d.quantity)} {d.unit ?? ""}</td>
                  <td className="px-2 py-2">{d.boxesText ?? <span className="text-[var(--genus-warning)]">Sin detalle de cajas registrado</span>}</td>
                  <td className="px-2 py-2 font-mono">{d.lote || "—"}</td>
                  <td className="px-2 py-2">{d.kind === "FINAL" ? "Final" : "Parcial"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {marked.length > 0 ? (
        <div className="rounded border border-[var(--os-border)] bg-[var(--os-surface)]" data-testid="remitos-marcadas">
          <button type="button" className="flex min-h-11 w-full items-center justify-between px-3 py-2 text-left text-sm font-medium" onClick={() => setShowMarked((v) => !v)} data-testid="remitos-marcadas-toggle">
            <span>Quitadas de pendientes / remito ya creado ({marked.length})</span>
            <span aria-hidden>{showMarked ? "▲" : "▼"}</span>
          </button>
          {showMarked ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[44rem] text-left text-xs">
                <thead className="text-[var(--os-text-muted)]"><tr><th className="px-3 py-2">Estado</th><th className="px-2 py-2">Cliente</th><th className="px-2 py-2">Pedido</th><th className="px-2 py-2">Producto</th><th className="px-2 py-2">Entregado</th><th className="px-2 py-2">Cajas</th><th className="px-2 py-2">Quién / cuándo</th>{canManage ? <th className="px-2 py-2" /> : null}</tr></thead>
                <tbody>
                  {marked.map((m) => (
                    <tr key={m.deliveryLineId} className="border-t border-[var(--os-border)]" data-testid="remitos-marcada-row">
                      <td className="px-3 py-2">{m.mark === "EXCLUIDA" ? "Quitada de pendientes" : `Remito ya creado${m.externalRemitoNumber ? ` Nº ${m.externalRemitoNumber}` : ""}${m.externalRemitoDate ? ` (${fmtDate(m.externalRemitoDate)})` : ""}`}{m.notes ? <span className="block text-[var(--os-text-muted)]">{m.notes}</span> : null}</td>
                      <td className="px-2 py-2">{m.client}</td>
                      <td className="px-2 py-2">{m.pedido ?? "—"}</td>
                      <td className="px-2 py-2">{m.product}</td>
                      <td className="px-2 py-2 tabular-nums">{fmt(m.quantity)} {m.unit ?? ""}</td>
                      <td className="px-2 py-2">{m.boxesText ?? "Sin detalle de cajas registrado"}</td>
                      <td className="px-2 py-2">{m.markedBy}<span className="block text-[var(--os-text-muted)]">{new Date(m.markedAt).toLocaleString("es-AR")}</span></td>
                      {canManage ? <td className="px-2 py-2"><Button type="button" variant="secondary" className="min-h-11" disabled={busy} onClick={() => void applyMark("restore", [m.deliveryLineId])} data-testid="remitos-restaurar">Restaurar</Button></td> : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      ) : null}

      <Dialog open={markDialog != null} onOpenChange={(o) => (!o && !busy ? setMarkDialog(null) : undefined)}>
        <DialogContent className="max-w-md" data-testid="remitos-mark-dialog">
          <DialogHeader>
            <DialogTitle>{markDialog === "exclude" ? "Quitar de pendientes" : "Marcar como remito ya creado"}</DialogTitle>
            <DialogDescription>
              {markDialog === "exclude"
                ? `Se quitan ${selected.size} entrega(s) de «Generar remitos». No se borra nada y se puede restaurar cuando quieras.`
                : `Las ${selected.size} entrega(s) ya tienen remito hecho fuera de GENUS OS. No se crea ningún remito ni se usa numeración interna; no se factura automáticamente.`}
            </DialogDescription>
          </DialogHeader>
          {markDialog === "mark_created" ? (
            <div className="space-y-2 text-sm">
              <label className="block">Número de remito (opcional)<input value={extNumber} onChange={(e) => setExtNumber(e.target.value)} className="mt-1 min-h-11 w-full rounded border border-[var(--os-border)] bg-[var(--os-surface)] px-3" data-testid="remitos-ext-numero" /></label>
              <label className="block">Fecha (opcional)<input type="date" value={extDate} onChange={(e) => setExtDate(e.target.value)} className="mt-1 min-h-11 w-full rounded border border-[var(--os-border)] bg-[var(--os-surface)] px-3" data-testid="remitos-ext-fecha" /></label>
              <label className="block">Observaciones (opcional)<textarea value={extNotes} onChange={(e) => setExtNotes(e.target.value)} rows={2} className="mt-1 w-full rounded border border-[var(--os-border)] bg-[var(--os-surface)] px-3 py-2" data-testid="remitos-ext-obs" /></label>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="secondary" disabled={busy} onClick={() => setMarkDialog(null)}>Cancelar</Button>
            <Button disabled={busy} onClick={() => markDialog && void applyMark(markDialog, [...selected])} data-testid="remitos-mark-confirmar">{busy ? "Guardando…" : "Confirmar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={preview != null} onOpenChange={(o) => (!o && !busy ? setPreview(null) : undefined)}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto" data-testid="remitos-preview-dialog">
          <DialogHeader>
            <DialogTitle>Vista previa del remito</DialogTitle>
            <DialogDescription>Se crea un borrador por cliente y fecha de entrega. No modifica stock ni entregas; recién al «Generar» el borrador se emite.</DialogDescription>
          </DialogHeader>
          {preview?.missing.length ? <p className="text-xs text-[var(--genus-warning)]">{preview.missing.length} entrega(s) elegida(s) ya no están disponibles (ya están en un remito) y no se incluyen.</p> : null}
          <div className="space-y-3 text-sm">
            {preview?.groups.map((g) => (
              <div key={`${g.client}|${g.deliveryDate}`} className="rounded border border-[var(--os-border)] p-3" data-testid="remitos-preview-group">
                <p className="font-medium">{g.client} · entrega {fmtDate(g.deliveryDate)}</p>
                <p className="text-xs text-[var(--os-text-muted)]">Pedidos: {g.pedidos.length ? g.pedidos.join(", ") : "—"} · Total {fmt(g.totalUnits)} u. · {g.totalCajas} caja(s)</p>
                <ul className="mt-2 space-y-1">
                  {g.lines.map((l) => (
                    <li key={l.deliveryLineId} className="text-xs">
                      <span className="font-medium">{l.product}</span> — {fmt(l.quantity)} {l.unit ?? "u."} · pedido {l.pedido ?? "—"}{l.lote ? ` · lote ${l.lote}` : ""}
                      <span className="block text-[var(--os-text-muted)]">{describeDeliveryPacking(l.packingGroups) ?? "Sin detalle de cajas registrado (se puede completar editando el borrador)"}{l.packingSource === "TRABAJO" || l.packingSource === "SNAPSHOT" ? " · tomadas del trabajo" : ""}</span>
                      {l.packingWarning ? <span className="block text-amber-400" data-testid="remito-cajas-aviso">⚠ {l.packingWarning}{l.packingSuggested && l.packingSuggested.length > 0 ? ` Registrado en el trabajo: ${describeDeliveryPacking(l.packingSuggested)}.` : ""}</span> : null}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="secondary" disabled={busy} onClick={() => setPreview(null)}>Cancelar</Button>
            <Button disabled={busy || !preview?.groups.length} onClick={() => void confirm()} data-testid="remitos-confirmar">
              {busy ? "Creando…" : "Confirmar y crear borrador"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
