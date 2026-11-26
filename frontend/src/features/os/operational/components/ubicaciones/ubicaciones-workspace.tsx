"use client";

/**
 * Cuerpo ÚNICO del mapa de ubicaciones: indicadores, buscador, referencias, mapa, panel de la posición y lista de sectores.
 * Depósito (`mode="deposito"`) agrega las acciones; Envasado Masivo/Premium (`mode="consulta"`) usa exactamente lo mismo SIN acciones de escritura.
 * Se mantiene al día solo (sondeo de lectura cada 10 s, postergado mientras se escribe en un formulario o hay una ventana abierta).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Boxes, CheckCircle2, History, MapPin, Package, Pencil, Search, Settings2, Trash2, X, ArrowLeftRight, Plus, Users, CalendarClock, UserRound, StickyNote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { SyncStatus, useAutoSync } from "@/features/os/operational/lib/use-auto-sync";
import { UbicacionesApiError, fetchClients, fetchMap, newKey, opLiberar, opObservaciones } from "@/lib/ubicaciones/client";
import { computeIndicators, distinctClients, fmtQty, fmtSubtotal, groupZones, itemMatches, locationStatus, searchLocations, subtotals } from "@/lib/ubicaciones/rules";
import type { MapView, OpResultView, UbicacionView } from "@/lib/ubicaciones/types";
import { CELL_STYLE, UbicacionesMap } from "./ubicaciones-map";
import { AddDialog, HistoryDialog, IngresosPanel, LinkDialog, RemoveDialog, TransferDialog, fieldCls, fmtDate } from "./ubicaciones-dialogs";
import { LocationConfigForm, NewLocationForm, ShapesDialog } from "./ubicaciones-config";

type Dlg = { type: "add" } | { type: "link"; itemId: string } | { type: "transfer" } | { type: "remove"; itemId: string } | { type: "history"; all?: boolean } | { type: "release" } | { type: "shapes" } | null;
const sig = (m: MapView | null) => JSON.stringify(m ? { ...m, serverTime: "" } : null);

function Kpi({ icon, value, label, tone, testid }: { icon: React.ReactNode; value: number; label: string; tone: string; testid: string }) {
  return (
    <div className={`rounded-xl border border-[var(--os-border)] border-t-4 bg-[var(--os-surface)] p-3 text-center ${tone}`} data-testid={testid}>
      <div className="mx-auto mb-1 grid size-7 place-items-center">{icon}</div>
      <div className="text-2xl font-bold leading-none" data-testid={`${testid}-valor`}>{value}</div>
      <div className="mt-1 text-xs text-[var(--os-text-muted)]">{label}</div>
    </div>
  );
}

export function UbicacionesWorkspace({ mode }: { mode: "deposito" | "consulta" }) {
  const [map, setMap] = useState<MapView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [dlg, setDlg] = useState<Dlg>(null);
  const [clients, setClients] = useState<Array<{ name: string }>>([]);
  const [configMode, setConfigMode] = useState(false);
  const [editingObs, setEditingObs] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ingresosToken, setIngresosToken] = useState(0);

  const load = useCallback(async () => {
    const m = await fetchMap();
    setMap((prev) => (sig(prev) === sig(m) ? prev : m));
    setError(null);
  }, []);
  const sync = useAutoSync({ run: load });
  const { syncNow } = sync;

  const canWrite = mode === "deposito" && Boolean(map?.capabilities.write);
  const canConfig = mode === "deposito" && Boolean(map?.capabilities.config);

  useEffect(() => {
    if (!canWrite) return;
    fetchClients().then(setClients).catch(() => undefined);
  }, [canWrite]);

  const locations = useMemo(() => map?.locations ?? [], [map]);
  const selected = locations.find((l) => l.id === selectedId) ?? null;
  const matches = useMemo(() => (query.trim() ? searchLocations(locations, query) : []), [locations, query]);
  const matchIds = useMemo(() => new Set(matches.map((m) => m.id)), [matches]);
  const indicators = useMemo(() => computeIndicators(locations), [locations]);
  // Subtotales SEPARADOS (verificado / sin verificar) de lo que coincide con la búsqueda.
  const matchSub = useMemo(() => subtotals(matches.flatMap((l) => { const hit = l.items.filter((i) => itemMatches(i, query)); return hit.length ? hit : l.items; })), [matches, query]);
  const selSub = useMemo(() => subtotals(selected?.items ?? []), [selected]);
  const zones = useMemo(() => groupZones(locations), [locations]);

  const applyResult = (r: OpResultView, message: string) => {
    setMap((m) => (m ? { ...m, locations: m.locations.map((l) => r.locations.find((x) => x.id === l.id) ?? l) } : m));
    setDlg(null);
    setEditingObs(null);
    setError(null);
    setNotice(r.replayed ? "Esta operación ya estaba registrada: no se repitió." : message);
    setIngresosToken((n) => n + 1);
    void syncNow(true);
  };
  const fail = (e: unknown) => {
    setNotice(null);
    setError(e instanceof Error ? e.message : "No se pudo completar la operación.");
    if (e instanceof UbicacionesApiError && e.status === 409) void syncNow(true);
  };
  const configSaved = (message: string, id?: string) => {
    setNotice(message);
    setError(null);
    setDlg(null);
    if (id) setSelectedId(id);
    void syncNow(true);
  };

  async function release() {
    if (!selected || busy) return;
    setBusy(true);
    try {
      applyResult(await opLiberar({ key: newKey(), locationId: selected.id, expectedVersion: selected.version }), `Ubicación ${selected.code} liberada.`);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  async function saveObs(loc: UbicacionView) {
    if (busy || editingObs == null) return;
    setBusy(true);
    try {
      applyResult(await opObservaciones({ key: newKey(), locationId: loc.id, expectedVersion: loc.version, observations: editingObs }), "Observaciones guardadas.");
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  const actBtn = "min-h-11 flex-1 whitespace-nowrap";
  const title = mode === "deposito" ? "Depósito · Ubicaciones" : "Ubicación de materiales";

  if (!map) {
    return (
      <div data-testid="ubi-root">
        <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
        {error || sync.error ? <p role="alert" className="mt-3 rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-sm" data-testid="ubi-error">{error ?? sync.error}</p> : <p className="mt-3 text-sm text-[var(--os-text-muted)]" data-testid="ubi-loading">Cargando el mapa…</p>}
      </div>
    );
  }

  return (
    <div data-testid="ubi-root" data-mode={mode} className="min-w-0">
      <header className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-2xl font-semibold tracking-tight" data-testid="ubi-title">{title}</h2>
          <p className="text-sm text-[var(--os-text-muted)]">{mode === "deposito" ? "Gestión de pallets y materiales de envase." : "Consultá dónde está el material de cada cliente."}</p>
          <SyncStatus lastSyncAt={sync.lastSyncAt} error={sync.error} deferred={sync.deferred} />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" className="min-h-11" onClick={() => setDlg({ type: "history", all: true })} data-testid="ubi-historial-general"><History className="size-4" /> Historial</Button>
          {canConfig ? (
            <Button type="button" variant={configMode ? "primary" : "secondary"} className="min-h-11" aria-pressed={configMode} onClick={() => setConfigMode((v) => !v)} data-testid="ubi-config-toggle"><Settings2 className="size-4" /> Configurar mapa</Button>
          ) : null}
        </div>
      </header>

      {error ? <p role="alert" className="mb-3 rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-sm" data-testid="ubi-error">{error}</p> : null}
      {notice ? <p role="status" className="mb-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm" data-testid="ubi-notice">{notice}</p> : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(250px,300px)_minmax(340px,460px)_minmax(0,1fr)] lg:items-start lg:[grid-template-rows:auto_1fr]">
        {/* Buscador + indicadores */}
        <section className="space-y-3 lg:col-start-1 lg:row-start-1" data-testid="ubi-top">
          <div>
            <label className="relative block">
              <span className="sr-only">Buscar cliente, material o ubicación</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-[var(--os-text-muted)]" />
              <input type="search" className={`${fieldCls} !mt-0 pl-10`} placeholder="Buscar cliente, material o ubicación…" value={query} onChange={(e) => setQuery(e.target.value)} data-testid="ubi-search" />
            </label>
            {query.trim() ? (
              <div className="mt-2" data-testid="ubi-search-result">
                <p className="text-sm" role="status"><strong data-testid="ubi-search-count">{matches.length}</strong> {matches.length === 1 ? "posición coincide" : "posiciones coinciden"}</p>
                {matches.length ? (
                  <p className="text-xs text-[var(--os-text-muted)]" data-testid="ubi-search-subtotales">Verificado: <strong data-testid="ubi-search-verificado">{fmtSubtotal(matchSub.verified)}</strong> · Sin verificar: <strong data-testid="ubi-search-sinverificar">{fmtSubtotal(matchSub.unverified)}</strong></p>
                ) : null}
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {matches.map((m) => (
                    <button key={m.id} type="button" className="min-h-11 min-w-11 rounded-lg border border-sky-600 bg-sky-200 px-2 text-sm font-bold text-slate-900" onClick={() => setSelectedId(m.id)} data-testid="ubi-search-chip">{m.code}</button>
                  ))}
                  <button type="button" className="grid min-h-11 min-w-11 place-items-center rounded-lg border border-[var(--os-border)] px-2" aria-label="Borrar búsqueda" onClick={() => setQuery("")}><X className="size-4" /></button>
                </div>
              </div>
            ) : null}
          </div>
          <div className="grid grid-cols-3 gap-2" data-testid="ubi-kpis">
            <Kpi testid="ubi-kpi-total" label="Posiciones" value={indicators.total} tone="!border-t-sky-500" icon={<Boxes className="size-6 text-sky-600" />} />
            <Kpi testid="ubi-kpi-ocupadas" label="Ocupadas" value={indicators.ocupadas} tone="!border-t-amber-500" icon={<Package className="size-6 text-amber-600" />} />
            <Kpi testid="ubi-kpi-libres" label="Libres" value={indicators.libres} tone="!border-t-emerald-500" icon={<CheckCircle2 className="size-6 text-emerald-600" />} />
          </div>
        </section>

        {/* Mapa */}
        <section className="min-w-0 lg:col-start-2 lg:row-span-2 lg:row-start-1" data-testid="ubi-map-section">
          <UbicacionesMap config={map.config} shapes={map.shapes} locations={locations} selectedId={selectedId} matchIds={matchIds} onSelect={(id) => setSelectedId((cur) => (cur === id ? null : id))} showInactive={configMode} />
        </section>

        {/* Panel de la ubicación */}
        <section className="min-w-0 lg:col-start-3 lg:row-span-2 lg:row-start-1" data-testid="ubi-panel-section">
          {selected ? (
            <article className="overflow-hidden rounded-xl border border-[var(--os-border)] bg-[var(--os-surface)]" data-testid="ubi-panel" data-code={selected.code} data-state={locationStatus(selected)}>
              <header className="flex items-center justify-between gap-2 bg-[#0b2a4a] px-4 py-3 text-white">
                <h3 className="flex items-center gap-2 text-lg font-bold"><MapPin className="size-5" /> Ubicación <span data-testid="ubi-panel-code">{selected.code}</span></h3>
                <span className="rounded-md px-2.5 py-1 text-sm font-bold text-slate-900" style={{ background: selected.active ? CELL_STYLE[selected.items.length ? "OCUPADA" : "LIBRE"].fill : CELL_STYLE.INACTIVA.fill }} data-testid="ubi-panel-estado">{!selected.active ? "Inactiva" : selected.items.length ? "Ocupada" : "Libre"}</span>
              </header>
              <div className="space-y-4 p-4">
                <div className="flex items-start gap-3">
                  <Users className="mt-1 size-5 shrink-0 text-[var(--os-text-muted)]" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-[var(--os-text-muted)]">{distinctClients(selected.items).length > 1 ? "Clientes asignados" : "Cliente asignado"}</p>
                    <p className="break-words text-lg font-bold" data-testid="ubi-panel-clientes">{distinctClients(selected.items).join(" · ") || "—"}</p>
                  </div>
                </div>
                <div>
                  <h4 className="mb-1 flex items-center justify-between gap-2 text-sm font-semibold">
                    <span className="flex items-center gap-2"><Package className="size-5 text-[var(--os-text-muted)]" /> Materiales almacenados ({selected.items.length})</span>
                    {canWrite && selected.active ? <Button type="button" variant="secondary" className="min-h-11" onClick={() => setDlg({ type: "add" })} data-testid="ubi-agregar"><Plus className="size-4" /> {selected.items.length ? "Agregar material" : "Asignar"}</Button> : null}
                  </h4>
                  {selected.items.length ? (
                    <ul className="divide-y divide-[var(--os-border)] rounded-lg border border-[var(--os-border)]" data-testid="ubi-panel-materiales">
                      {selected.items.map((i) => (
                        <li key={i.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm" data-testid="ubi-panel-item">
                          <div className="min-w-0 flex-1">
                            <p className="break-words font-medium">{i.material}</p>
                            <p className="text-xs text-[var(--os-text-muted)]">{i.clientName}{i.codigo ? ` · ${i.codigo}` : ""}</p>
                          </div>
                          <div className="flex shrink-0 flex-col items-end gap-1">
                            <strong className="whitespace-nowrap" data-testid="ubi-panel-cantidad">{i.quantity == null ? "sin cantidad" : fmtQty(i.quantity, i.unit)}</strong>
                            {i.verified ? <span className="rounded bg-emerald-200 px-1.5 text-xs font-bold text-emerald-950" data-testid="ubi-badge-verificado">Verificado</span> : <span className="rounded bg-amber-200 px-1.5 text-xs font-bold text-amber-950" data-testid="ubi-badge-sin-verificar">Sin verificar</span>}
                          </div>
                          {canWrite && !i.verified && i.quantity != null ? <button type="button" className="min-h-11 basis-full rounded-lg border border-[var(--os-border)] px-2 text-sm font-semibold hover:bg-[var(--os-bg)]" onClick={() => setDlg({ type: "link", itemId: i.id })} data-testid="ubi-vincular">Vincular a ME</button> : null}
                          {canWrite ? <button type="button" className="grid size-11 shrink-0 place-items-center rounded-lg text-rose-600 hover:bg-rose-500/10" aria-label={`Retirar ${i.material}`} onClick={() => setDlg({ type: "remove", itemId: i.id })} data-testid="ubi-retirar"><Trash2 className="size-5" /></button> : null}
                        </li>
                      ))}
                    </ul>
                  ) : <p className="rounded-lg border border-dashed border-[var(--os-border)] p-3 text-sm text-[var(--os-text-muted)]" data-testid="ubi-panel-vacia">Esta ubicación está libre.</p>}
                </div>
                {selected.items.length ? (
                  <div className="space-y-1 rounded-lg bg-[var(--os-bg)] p-3 text-sm" data-testid="ubi-panel-subtotales">
                    <p>Verificado (respaldado por el inventario ME): <strong data-testid="ubi-sub-verificado">{fmtSubtotal(selSub.verified)}</strong></p>
                    <p>Sin verificar (texto libre): <strong data-testid="ubi-sub-sinverificar">{fmtSubtotal(selSub.unverified)}</strong></p>
                    {selSub.unverified.rows ? <p className="text-xs text-[var(--os-text-muted)]">Lo «sin verificar» no está respaldado por el inventario ME ni cuenta contra el stock.</p> : null}
                  </div>
                ) : null}
                <div>
                  <h4 className="mb-1 flex items-center justify-between gap-2 text-sm font-semibold">
                    <span className="flex items-center gap-2"><StickyNote className="size-5 text-[var(--os-text-muted)]" /> Observaciones</span>
                    {canWrite && selected.active && editingObs == null ? <Button type="button" variant="secondary" className="min-h-11" onClick={() => setEditingObs(selected.observations)} data-testid="ubi-obs-editar"><Pencil className="size-4" /> Editar</Button> : null}
                  </h4>
                  {editingObs != null ? (
                    <div className="space-y-2">
                      <textarea className={`${fieldCls} min-h-24`} value={editingObs} onChange={(e) => setEditingObs(e.target.value)} data-testid="ubi-obs-texto" />
                      <div className="flex gap-2">
                        <Button type="button" className={actBtn} onClick={() => void saveObs(selected)} disabled={busy} data-testid="ubi-obs-guardar">Guardar</Button>
                        <Button type="button" variant="secondary" className={actBtn} onClick={() => setEditingObs(null)}>Cancelar</Button>
                      </div>
                    </div>
                  ) : <p className="min-h-11 whitespace-pre-wrap rounded-lg bg-[var(--os-bg)] p-3 text-sm" data-testid="ubi-panel-obs">{selected.observations || "Sin observaciones."}</p>}
                </div>
                <dl className="space-y-1.5 text-sm">
                  <div className="flex items-center justify-between gap-3"><dt className="flex items-center gap-2 text-[var(--os-text-muted)]"><CalendarClock className="size-4" /> Última modificación</dt><dd data-testid="ubi-panel-fecha">{fmtDate(selected.lastModifiedAt)}</dd></div>
                  <div className="flex items-center justify-between gap-3"><dt className="flex items-center gap-2 text-[var(--os-text-muted)]"><UserRound className="size-4" /> Modificado por</dt><dd className="truncate" data-testid="ubi-panel-usuario">{selected.lastModifiedBy ?? "—"}</dd></div>
                </dl>
                <div className="flex flex-wrap gap-2">
                  {canWrite && selected.items.length ? <Button type="button" variant="secondary" className={actBtn} onClick={() => setDlg({ type: "transfer" })} data-testid="ubi-mover"><ArrowLeftRight className="size-4" /> Mover ubicación</Button> : null}
                  {canWrite && selected.items.length ? <Button type="button" variant="secondary" className={actBtn} onClick={() => setDlg({ type: "release" })} data-testid="ubi-liberar"><Trash2 className="size-4" /> Liberar ubicación</Button> : null}
                  <Button type="button" variant="secondary" className={actBtn} onClick={() => setDlg({ type: "history" })} data-testid="ubi-historial"><History className="size-4" /> Ver historial</Button>
                </div>
                {canConfig && configMode ? (
                  <div className="space-y-2 rounded-xl border border-dashed border-[var(--os-border)] p-3">
                    <h4 className="text-sm font-semibold">Configurar esta posición</h4>
                    <LocationConfigForm key={`${selected.id}-${selected.version}`} location={selected} onSaved={configSaved} onError={(m) => { setNotice(null); setError(m); }} />
                  </div>
                ) : null}
              </div>
            </article>
          ) : (
            <div className="rounded-xl border border-dashed border-[var(--os-border)] p-6 text-center text-sm text-[var(--os-text-muted)]" data-testid="ubi-panel-vacio"><MapPin className="mx-auto mb-2 size-8" />Tocá una posición del mapa para ver su contenido.</div>
          )}
          {canConfig && configMode ? (
            <div className="mt-4 space-y-3 rounded-xl border border-[var(--os-border)] p-4" data-testid="ubi-config-panel">
              <h4 className="text-sm font-semibold">Nueva ubicación</h4>
              <NewLocationForm onSaved={configSaved} onError={(m) => { setNotice(null); setError(m); }} />
              <Button type="button" variant="secondary" className="min-h-11" onClick={() => setDlg({ type: "shapes" })} data-testid="ubi-config-formas">Forma del plano (contorno, pasillos, escalera, vacío)</Button>
            </div>
          ) : null}
        </section>

        {/* Referencias + sectores */}
        <section className="space-y-3 lg:col-start-1 lg:row-start-2" data-testid="ubi-bottom">
          <div className="rounded-xl border border-[var(--os-border)] p-3" data-testid="ubi-referencias">
            <h3 className="mb-2 text-sm font-semibold">Referencias</h3>
            <ul className="space-y-1.5 text-sm">
              {(["LIBRE", "OCUPADA", "SELECCIONADA", "RESULTADO"] as const).map((k) => (
                <li key={k} className="flex items-center gap-2"><span className="inline-block size-5 rounded border-2" style={{ background: CELL_STYLE[k].fill, borderColor: CELL_STYLE[k].stroke }} />{CELL_STYLE[k].label}</li>
              ))}
            </ul>
          </div>
          {canWrite ? <IngresosPanel locations={locations} refreshToken={ingresosToken} onDone={applyResult} /> : null}
          <div className="rounded-xl border border-[var(--os-border)] p-3" data-testid="ubi-sectores">
            <h3 className="mb-2 text-sm font-semibold">Sectores y posiciones</h3>
            <div className="divide-y divide-[var(--os-border)]">
              {zones.map((z) => (
                <details key={z.zone} className="group py-1" data-testid="ubi-zona">
                  <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 text-sm">
                    <span><strong>{z.from === z.to ? z.from : `${z.from} – ${z.to}`}</strong><br /><span className="text-[var(--os-text-muted)]">{z.zone}</span></span>
                    <span className="font-semibold">{z.count}</span>
                  </summary>
                  <div className="flex flex-wrap gap-1.5 pb-2">
                    {z.items.map((l) => (
                      <button key={l.id} type="button" className="min-h-11 min-w-11 rounded-lg border-2 px-1.5 text-sm font-bold text-slate-900" style={{ background: l.items.length ? CELL_STYLE.OCUPADA.fill : CELL_STYLE.LIBRE.fill, borderColor: l.id === selectedId ? "#0b1f3a" : l.items.length ? CELL_STYLE.OCUPADA.stroke : CELL_STYLE.LIBRE.stroke }} onClick={() => setSelectedId(l.id)} data-testid={`ubi-chip-${l.code}`}>{l.code}</button>
                    ))}
                  </div>
                </details>
              ))}
            </div>
            <div className="mt-2 flex items-center justify-between rounded-lg bg-[var(--os-bg)] px-3 py-2 text-sm font-semibold" data-testid="ubi-total-footer"><span>Total</span><span>{indicators.total} posiciones</span></div>
          </div>
        </section>
      </div>

      {dlg?.type === "add" && selected ? <AddDialog location={selected} clients={clients} onClose={() => setDlg(null)} onDone={applyResult} /> : null}
      {dlg?.type === "link" && selected && selected.items.find((i) => i.id === dlg.itemId) ? <LinkDialog location={selected} item={selected.items.find((i) => i.id === dlg.itemId)!} onClose={() => setDlg(null)} onDone={applyResult} /> : null}
      {dlg?.type === "transfer" && selected ? <TransferDialog from={selected} locations={locations} onClose={() => setDlg(null)} onDone={applyResult} /> : null}
      {dlg?.type === "remove" && selected ? <RemoveDialog location={selected} itemId={dlg.itemId} onClose={() => setDlg(null)} onDone={applyResult} /> : null}
      {dlg?.type === "history" ? <HistoryDialog location={dlg.all ? null : selected} onClose={() => setDlg(null)} /> : null}
      {dlg?.type === "shapes" ? <ShapesDialog map={map} onClose={() => setDlg(null)} onSaved={(m) => configSaved(m)} onError={(m) => { setNotice(null); setError(m); }} /> : null}
      <ConfirmDialog
        open={dlg?.type === "release" && Boolean(selected)}
        onOpenChange={(o) => !o && setDlg(null)}
        title={`Liberar ${selected?.code ?? ""}`}
        description="Se quita todo el contenido de esta ubicación y queda libre. El movimiento queda registrado en el historial. No cambia el stock del depósito."
        confirmLabel="Liberar ubicación"
        variant="destructive"
        onConfirm={() => void release()}
      />
    </div>
  );
}
