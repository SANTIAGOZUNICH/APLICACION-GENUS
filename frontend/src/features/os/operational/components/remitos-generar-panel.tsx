"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { describeDeliveryPacking } from "@/lib/remitos/delivery-packing";
import type { EligibleDelivery, RemitoPreviewGroup } from "@/lib/remitos/delivery-grouping";
import { createRemitosFromDeliveriesApi, fetchEligibleDeliveriesApi, previewRemitosFromDeliveriesApi } from "@/lib/remitos/remitos-client";

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

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetchEligibleDeliveriesApi(session);
      setItems(r.deliveries);
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
  const byGroup = useMemo(() => {
    const m = new Map<string, EligibleDelivery[]>();
    for (const d of items) {
      const k = `${d.client}|${d.deliveryDate}`;
      m.set(k, [...(m.get(k) ?? []), d]);
    }
    return [...m.entries()];
  }, [items]);

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
          <Button type="button" className="ml-auto min-h-11" disabled={selected.size === 0 || busy} onClick={() => void openPreview()} data-testid="remitos-hacer">
            Hacer remito ({selected.size})
          </Button>
        ) : (
          <span className="ml-auto text-xs text-[var(--os-text-muted)]">Solo consulta</span>
        )}
      </div>
      {notice ? <p className="rounded border border-[var(--os-teal)]/40 bg-[var(--os-teal)]/10 px-3 py-2 text-sm" data-testid="remitos-generar-notice">{notice}</p> : null}
      {error ? <p className="rounded border border-[var(--genus-warning)]/30 bg-[var(--genus-warning-soft)] px-3 py-2 text-sm text-[var(--genus-warning)]" data-testid="remitos-generar-error">{error}</p> : null}
      {loading ? <p className="text-sm text-[var(--os-text-muted)]">Cargando entregas…</p> : null}
      {!loading && items.length === 0 ? <p className="text-sm text-[var(--os-text-muted)]" data-testid="remitos-generar-empty">No hay entregas pendientes de remito.</p> : null}
      {byGroup.map(([key, rows]) => (
        <div key={key} className="overflow-x-auto rounded border border-[var(--os-border)] bg-[var(--os-surface)]" data-testid="remitos-generar-group">
          <div className="flex items-center gap-2 border-b border-[var(--os-border)] px-3 py-2 text-sm font-medium">
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
                  <td className="px-2 py-2">{d.boxesText ?? <span className="text-[var(--genus-warning)]">sin detalle de cajas</span>}</td>
                  <td className="px-2 py-2 font-mono">{d.lote || "—"}</td>
                  <td className="px-2 py-2">{d.kind === "FINAL" ? "Final" : "Parcial"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

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
                      <span className="block text-[var(--os-text-muted)]">{describeDeliveryPacking(l.packingGroups) ?? "sin detalle de cajas (se puede completar editando el borrador)"}</span>
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
