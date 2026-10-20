"use client";

/**
 * Control semanal de MP — panel superior «MATERIAS PRIMAS A RESOLVER».
 * Un bloque por cada control guardado de la semana (producto — cliente — kg de producción) con SOLO las MP que faltan:
 * rojo (sin stock / no identificada) y amarillo (stock insuficiente). Lo suficiente no se muestra. Antes de guardar un
 * control no hay nada arriba. Las fórmulas completas siguen en el control individual de abajo.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ACTOR_EMAIL_HEADER, ACTOR_SECTOR_HEADER } from "@/lib/auth/header-names";
import { TONE_BADGE, TONE_CELL, fmtKg, type Tone } from "@/lib/mp-control/availability-tone";
import { CONTROL_NEED_LABEL, type ControlNeedStatus } from "@/lib/mp-control/control-needs";
import type { SavedProductControl } from "@/lib/mp-control/saved-weekly-control";
import { fmtWhen } from "./mp-weekly-shared";

const TONE_OF: Record<ControlNeedStatus, Tone> = { SIN_STOCK: "none", NO_IDENTIFICADA: "none", INSUFICIENTE: "partial" };

export function mondayOf(d = new Date()): string {
  const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x.toISOString().slice(0, 10);
}
const shift = (iso: string, days: number) => {
  const x = new Date(`${iso}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + days);
  return x.toISOString().slice(0, 10);
};
const kg = (n: number | null | undefined) => (n == null ? "—" : `${fmtKg(n)} kg`);

export function MpWeeklyAttention({ email, sector, week, onWeekChange, savedTick }: { email: string; sector: string; week: string; onWeekChange: (w: string) => void; savedTick: number }) {
  const canEdit = sector === "MATERIA_PRIMA";
  const [controls, setControls] = useState<SavedProductControl[] | undefined>(undefined);
  const [schemaPending, setSchemaPending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const headers = useMemo(() => ({ "Content-Type": "application/json", [ACTOR_EMAIL_HEADER]: email, [ACTOR_SECTOR_HEADER]: sector }), [email, sector]);

  const fetchSaved = useCallback(async () => {
    setControls(undefined);
    const res = await fetch(`/api/v1/mp-control/weekly/saved?week=${week}&_=${Date.now()}`, { credentials: "include", headers, cache: "no-store" });
    const body = (await res.json()) as { controls?: SavedProductControl[]; schemaPending?: boolean; error?: string };
    if (!res.ok) throw new Error(body.error ?? "No se pudo leer el control guardado");
    setControls(body.controls ?? []);
    setSchemaPending(Boolean(body.schemaPending));
    setError(null);
  }, [week, headers]);

  // Al abrir, al cambiar de semana y después de guardar un control (savedTick). Nunca se muestran datos de otra semana.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- consulta al abrir
    void fetchSaved().catch((e) => setError(e instanceof Error ? e.message : "No se pudo consultar"));
  }, [fetchSaved, savedTick]);

  const refresh = async () => {
    setLoading(true);
    await fetchSaved().catch((e) => setError(e instanceof Error ? e.message : "No se pudo consultar"));
    setLoading(false);
  };
  async function resave(controlId: string) {
    setBusyId(controlId);
    try {
      const res = await fetch("/api/v1/mp-control/weekly/saved", { method: "POST", credentials: "include", headers, body: JSON.stringify({ week, controlId }) });
      const out = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(out.error ?? "No se pudo actualizar");
      await fetchSaved();
      setNotice("Faltantes actualizados con el stock de hoy.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo actualizar el control");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="rounded border border-[var(--os-border)] p-3" data-testid="mp-weekly-availability">
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <h3 className="text-sm font-semibold" data-testid="mpw-title">MATERIAS PRIMAS A RESOLVER</h3>
          <p className="text-xs text-[var(--os-text-muted)]">Solo lo que falta para cada control guardado. Las fórmulas completas están en el control individual de abajo.</p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button type="button" variant="secondary" size="sm" className="min-h-11" onClick={() => onWeekChange(shift(week, -7))} aria-label="Semana anterior">‹</Button>
          <input type="date" value={week} onChange={(e) => e.target.value && onWeekChange(e.target.value)} className="min-h-11 rounded border border-[var(--os-border)] bg-transparent px-2 text-sm" data-testid="mpw-week" />
          <Button type="button" variant="secondary" size="sm" className="min-h-11" onClick={() => onWeekChange(shift(week, 7))} aria-label="Semana siguiente">›</Button>
          <Button type="button" size="sm" className="min-h-11" onClick={() => void refresh()} disabled={loading} data-testid="mpw-refresh">{loading ? "Consultando…" : "Actualizar"}</Button>
        </div>
      </div>
      {notice ? <p className="mt-2 rounded border border-emerald-400/60 bg-emerald-400/10 px-3 py-2 text-xs" role="status" data-testid="mpw-notice">{notice}</p> : null}
      {error ? <p className="mt-2 rounded border border-rose-500/60 bg-rose-500/10 px-3 py-2 text-sm" role="alert" data-testid="mpw-error">No se pudo consultar: {error}. Lo que se ve puede estar desactualizado.</p> : null}

      {schemaPending ? (
        <p className="mt-3 rounded border border-amber-400/60 bg-amber-400/10 px-3 py-3 text-sm" data-testid="mpw-schema-pending">El guardado del Control semanal necesita una actualización de la base de datos (migración 0066) que todavía no se aplicó.</p>
      ) : controls === undefined ? (
        <p className="mt-3 text-sm text-[var(--os-text-muted)]">Consultando los controles guardados…</p>
      ) : controls.length === 0 ? (
        <p className="mt-3 rounded border border-dashed border-[var(--os-border)] px-3 py-6 text-center text-sm" data-testid="mpw-empty-unsaved">
          Guardá el control para ver las materias primas faltantes de esta semana
        </p>
      ) : (
        <ul className="mt-3 space-y-3" data-testid="mpw-list">
          {controls.map((c) => (
            <li key={c.controlId} className="rounded-lg border border-[var(--os-border)] p-3" data-testid="mpw-block" data-control-id={c.controlId}>
              <div className="flex flex-wrap items-start gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-bold uppercase" data-testid="mpw-block-title">
                    <span data-testid="mpw-block-product">{c.needs.product}</span> — <span data-testid="mpw-block-client">{c.needs.client}</span>
                  </p>
                  <p className="text-sm font-semibold" data-testid="mpw-block-kg">PRODUCCIÓN: {c.needs.quantityKg != null ? `${fmtKg(c.needs.quantityKg)} KG` : "—"}</p>
                  <p className="text-[11px] text-[var(--os-text-muted)]">
                    Guardado el {fmtWhen(c.savedAt)} por {c.savedBy}
                    {c.needs.linkedOe ? ` · OE ${c.needs.linkedOe}` : ""}
                  </p>
                </div>
                {canEdit ? (
                  <Button type="button" variant="secondary" size="sm" className="ml-auto min-h-11" disabled={busyId === c.controlId} onClick={() => void resave(c.controlId)} data-testid="mpw-resave">
                    {busyId === c.controlId ? "Actualizando…" : "Actualizar con stock de hoy"}
                  </Button>
                ) : null}
              </div>
              {c.needs.items.length === 0 ? (
                <p className="mt-2 rounded border border-emerald-400/50 bg-emerald-400/10 px-3 py-2 text-sm" data-testid="mpw-nothing">No faltan materias primas para esta producción.</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {c.needs.items.map((it) => (
                    <li key={`${it.materiaPrima}|${it.codigo}`} className={`rounded border px-3 py-2 ${TONE_BADGE[TONE_OF[it.status]]} ${TONE_CELL[TONE_OF[it.status]]}`} data-testid="mpw-item" data-estado={it.status}>
                      <p className="text-sm font-semibold">
                        <span data-testid="mpw-item-name">{it.materiaPrima}</span>
                        {it.codigo ? <span className="ml-2 font-mono text-xs opacity-80">{it.codigo}</span> : null}
                        <span className="ml-2" data-testid="mpw-estado">— {CONTROL_NEED_LABEL[it.status]}</span>
                      </p>
                      <p className="text-xs" data-testid="mpw-item-detail">
                        Necesario: {kg(it.necesarioKg)} · Stock físico: {it.stockFisicoKg == null ? "Stock no identificado" : kg(it.stockFisicoKg)} · Disponible para esta producción: {kg(it.disponibleKg)} · <b>Faltante: {kg(it.faltanteKg)}</b>
                        {it.shared ? " · stock compartido" : ""}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
