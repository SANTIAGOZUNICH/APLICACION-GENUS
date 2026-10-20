"use client";

/**
 * Control semanal de MP — panel superior «MATERIAS PRIMAS A RESOLVER».
 * Muestra SOLO lo que necesita atención (sin stock / stock insuficiente / sin datos) del último control guardado de la semana
 * elegida. Antes de guardar no muestra fórmulas ni necesidades. El stock es compartido entre productos: el faltante total
 * sale una sola vez. Lo guardado es una foto; si el stock cambió después, se avisa y se muestra aparte (no se reescribe).
 * Las fórmulas completas siguen en el control individual de abajo.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ACTOR_EMAIL_HEADER, ACTOR_SECTOR_HEADER } from "@/lib/auth/header-names";
import { TONE_BADGE, TONE_CELL, fmtKg } from "@/lib/mp-control/availability-tone";
import { ATTENTION_LABEL, attentionDiff, buildNeedsAttention, filterAttention, type AttentionFilter, type AttentionItem, type AttentionStatus } from "@/lib/mp-control/needs-attention";
import type { SavedWeeklyControl } from "@/lib/mp-control/saved-weekly-control";
import type { WeeklyAvailability, WeeklyRow } from "@/lib/mp-control/weekly-availability-service";
import { GESTION_LABEL, NoteCell, fmtWhen } from "./mp-weekly-shared";

const TONE_OF: Record<AttentionStatus, "none" | "partial" | "unknown"> = { SIN_STOCK: "none", INSUFICIENTE: "partial", SIN_DATOS: "unknown" };
const FILTERS: Array<{ id: AttentionFilter; label: string }> = [
  { id: "TODAS", label: "TODAS" },
  { id: "SIN_STOCK", label: "SIN STOCK" },
  { id: "INSUFICIENTE", label: "INSUFICIENTES" },
  { id: "SIN_DATOS", label: "SIN DATOS" },
];

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
  const [data, setData] = useState<WeeklyAvailability | null>(null);
  const [saved, setSaved] = useState<SavedWeeklyControl | null | undefined>(undefined);
  const [schemaPending, setSchemaPending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [filter, setFilter] = useState<AttentionFilter>("TODAS");
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState<string[] | null>(null);
  const [confirmRestore, setConfirmRestore] = useState<string[] | null>(null);
  const [restoreSel, setRestoreSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const headers = useMemo(() => ({ "Content-Type": "application/json", [ACTOR_EMAIL_HEADER]: email, [ACTOR_SECTOR_HEADER]: sector }), [email, sector]);

  const fetchData = useCallback(async () => {
    const res = await fetch(`/api/v1/mp-control/weekly?week=${week}&_=${Date.now()}`, { credentials: "include", headers, cache: "no-store" });
    const body = (await res.json()) as WeeklyAvailability & { error?: string };
    if (!res.ok) throw new Error(body.error ?? "No se pudo consultar el stock");
    setData(body);
    setError(null);
  }, [week, headers]);
  const fetchSaved = useCallback(async () => {
    setSaved(undefined);
    const res = await fetch(`/api/v1/mp-control/weekly/saved?week=${week}`, { credentials: "include", headers, cache: "no-store" });
    const body = (await res.json()) as { saved: SavedWeeklyControl | null; schemaPending?: boolean; error?: string };
    if (!res.ok) throw new Error(body.error ?? "No se pudo leer el control guardado");
    setSaved(body.saved);
    setSchemaPending(Boolean(body.schemaPending));
  }, [week, headers]);

  // Al abrir, al cambiar de semana y después de guardar un control (savedTick). Nunca se muestran datos de otra semana.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- consulta al abrir
    void Promise.all([fetchData(), fetchSaved()]).catch((e) => setError(e instanceof Error ? e.message : "No se pudo consultar"));
  }, [fetchData, fetchSaved, savedTick]);

  const refresh = async () => {
    setLoading(true);
    await Promise.all([fetchData(), fetchSaved()]).catch((e) => setError(e instanceof Error ? e.message : "No se pudo consultar"));
    setLoading(false);
  };
  async function post(url: string, body: unknown, method = "POST") {
    const res = await fetch(url, { method, credentials: "include", headers, body: JSON.stringify(body) });
    const out = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new Error(out.error ?? "No se pudo guardar");
    return out;
  }
  async function resave() {
    setBusy(true);
    try {
      await post("/api/v1/mp-control/weekly/saved", { week });
      await fetchSaved();
      setNotice("Resultados actualizados con el stock de hoy.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo actualizar el control guardado");
    } finally {
      setBusy(false);
    }
  }
  async function saveNote(row: WeeklyRow, observacion: string) {
    try {
      await post("/api/v1/mp-control/weekly/state", { week: data!.weekStart, rowKey: row.key, label: row.materiaPrima, observacion }, "PATCH");
      await fetchData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar la observación");
      throw e;
    }
  }
  async function saveGestion(row: WeeklyRow, gestion: string) {
    try {
      await post("/api/v1/mp-control/weekly/state", { week: data!.weekStart, rowKey: row.key, label: row.materiaPrima, gestion }, "PATCH");
      await fetchData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar la decisión");
    }
  }
  async function removeRows(keys: string[]) {
    setBusy(true);
    try {
      const out = (await post("/api/v1/mp-control/weekly/exclude", { week: data!.weekStart, rowKeys: keys })) as { excluded?: number };
      const n = out.excluded ?? keys.length;
      setNotice(`Se quitaron ${n} materia${n === 1 ? "" : "s"} prima${n === 1 ? "" : "s"} del control de esta semana. El inventario, las fórmulas y las OE no se tocaron.`);
      setSelected(new Set());
      setConfirmDelete(null);
      await fetchData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron quitar");
    } finally {
      setBusy(false);
    }
  }
  async function doRestore(keys: string[]) {
    try {
      await post("/api/v1/mp-control/weekly/exclude", { week: data!.weekStart, rowKeys: keys, restore: true });
      await fetchData();
      setNotice(`Se restauraron ${keys.length} materia${keys.length === 1 ? "" : "s"} prima${keys.length === 1 ? "" : "s"} en el control de esta semana.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo restaurar");
    }
    setConfirmRestore(null);
    setRestoreSel(new Set());
  }
  async function productionAction(id: string, label: string, restore: boolean) {
    try {
      await post("/api/v1/mp-control/weekly/exclude-production", { week: data!.weekStart, items: [{ workItemId: id, label }], restore, reason: "Quitada manualmente del Control semanal" });
      await fetchData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo actualizar la producción");
    }
  }

  const rowsByKey = useMemo(() => new Map([...(data?.rows ?? []), ...(data?.excludedRows ?? [])].map((r) => [r.key, r])), [data]);
  const excludedKeys = useMemo(() => new Set((data?.excludedRows ?? []).map((r) => r.key)), [data]);
  // Lo mostrado es lo GUARDADO (menos lo que una persona quitó del control); lo actual solo se usa para avisar diferencias.
  const savedItems = useMemo(() => (saved?.result.items ?? []).filter((i) => !excludedKeys.has(i.rowKey)), [saved, excludedKeys]);
  const current = useMemo(() => (data ? buildNeedsAttention(data.rows, data.products) : null), [data]);
  const currentByKey = useMemo(() => new Map((current?.items ?? []).map((i) => [i.rowKey, i])), [current]);
  const diff = useMemo(() => (current ? attentionDiff(savedItems, current.items) : null), [savedItems, current]);
  const shown = filterAttention(savedItems, filter);
  const summary = useMemo(() => ({
    sinStock: savedItems.filter((i) => i.status === "SIN_STOCK").length,
    insuficientes: savedItems.filter((i) => i.status === "INSUFICIENTE").length,
    sinDatos: savedItems.filter((i) => i.status === "SIN_DATOS").length,
    total: savedItems.length,
  }), [savedItems]);
  const toggle = (key: string) => setSelected((cur) => { const n = new Set(cur); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const changedCount = diff ? diff.changed.length + diff.resolved.length + diff.added.length : 0;

  const tiles: Array<{ id: string; label: string; value: number; tone: "none" | "partial" | "unknown"; f: AttentionFilter }> = [
    { id: "sin-stock", label: "MP sin stock", value: summary.sinStock, tone: "none", f: "SIN_STOCK" },
    { id: "insuficientes", label: "MP con stock insuficiente", value: summary.insuficientes, tone: "partial", f: "INSUFICIENTE" },
    { id: "sin-datos", label: "MP sin identificar o sin datos", value: summary.sinDatos, tone: "unknown", f: "SIN_DATOS" },
    { id: "total", label: "Necesidades que requieren atención", value: summary.total, tone: "unknown", f: "TODAS" },
  ];

  return (
    <section className="rounded border border-[var(--os-border)] p-3" data-testid="mp-weekly-availability">
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <h3 className="text-sm font-semibold" data-testid="mpw-title">MATERIAS PRIMAS A RESOLVER</h3>
          <p className="text-xs text-[var(--os-text-muted)]">Solo lo que necesita atención del último control guardado de la semana. Las fórmulas completas están en el control individual de abajo.</p>
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
        <p className="mt-3 rounded border border-amber-400/60 bg-amber-400/10 px-3 py-3 text-sm" data-testid="mpw-schema-pending">El guardado del Control semanal necesita una actualización de la base de datos (migración 0065) que todavía no se aplicó.</p>
      ) : saved === undefined ? (
        <p className="mt-3 text-sm text-[var(--os-text-muted)]">Consultando el control guardado…</p>
      ) : saved === null ? (
        <p className="mt-3 rounded border border-dashed border-[var(--os-border)] px-3 py-6 text-center text-sm" data-testid="mpw-empty-unsaved">
          Guardá el control para ver las materias primas faltantes de esta semana
        </p>
      ) : (
        <>
          <p className="mt-2 text-xs text-[var(--os-text-muted)]" data-testid="mpw-saved-meta">
            Control de la semana {saved.weekStart} guardado el <b>{fmtWhen(saved.savedAt)}</b> por {saved.savedBy} (versión {saved.version}). Los valores son los del momento de guardar.
          </p>
          {changedCount > 0 ? (
            <div className="mt-2 rounded border border-amber-400/60 bg-amber-400/10 px-3 py-2 text-xs" role="status" data-testid="mpw-changed-banner">
              El stock o las necesidades cambiaron desde que se guardó ({changedCount} materia{changedCount === 1 ? "" : "s"} prima{changedCount === 1 ? "" : "s"}). Se muestra lo guardado y, debajo, lo de hoy.
              {canEdit ? <Button type="button" size="sm" className="ml-2 min-h-11" disabled={busy} onClick={() => void resave()} data-testid="mpw-resave">{busy ? "Actualizando…" : "Actualizar resultados con el stock de hoy"}</Button> : null}
            </div>
          ) : null}
          <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4" data-testid="mpw-tiles">
            {tiles.map((t) => (
              <button key={t.id} type="button" onClick={() => setFilter(t.f)} className={`min-h-16 rounded-lg border px-3 py-2 text-left ${TONE_BADGE[t.tone]} ${filter === t.f ? "ring-2 ring-[var(--os-teal)]" : ""}`} data-testid={`mpw-tile-${t.id}`}>
                <span className="block text-2xl font-bold leading-none" data-testid={`mpw-tile-value-${t.id}`}>{t.value}</span>
                <span className="mt-1 block text-[11px] leading-tight">{t.label}</span>
              </button>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2" data-testid="mpw-filters">
            {FILTERS.map((c) => (
              <button key={c.id} type="button" onClick={() => setFilter(c.id)} aria-pressed={filter === c.id} className={`min-h-11 rounded-full border px-4 text-xs font-semibold ${filter === c.id ? "border-[var(--os-teal)] bg-[var(--os-teal)]/20" : "border-[var(--os-border)]"}`} data-testid={`mpw-filter-${c.id}`}>{c.label}</button>
            ))}
            {canEdit ? (
              <Button type="button" size="sm" className="ml-auto min-h-11" variant={selectMode ? "primary" : "secondary"} onClick={() => { setSelectMode((m) => !m); setSelected(new Set()); setConfirmDelete(null); }} data-testid="mpw-select-toggle">{selectMode ? "Salir de selección" : "Seleccionar"}</Button>
            ) : null}
          </div>
          {selectMode ? (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs" data-testid="mpw-select-bar">
              <Button type="button" size="sm" className="min-h-11" variant="secondary" onClick={() => setSelected(new Set(shown.map((r) => r.rowKey)))} data-testid="mpw-select-all">Seleccionar todos</Button>
              <Button type="button" size="sm" className="min-h-11" variant="secondary" onClick={() => setSelected(new Set())} data-testid="mpw-select-none">Deseleccionar todos</Button>
              <span className="rounded border border-[var(--os-border)] px-2 py-1" data-testid="mpw-selected-count">{selected.size} seleccionada{selected.size === 1 ? "" : "s"}</span>
              <Button type="button" size="sm" className="min-h-11" variant="destructive" disabled={selected.size === 0 || busy} onClick={() => setConfirmDelete([...selected])} data-testid="mpw-delete-selected">Quitar seleccionadas ({selected.size})</Button>
            </div>
          ) : null}
          {confirmDelete ? (
            <div className="mt-2 rounded border border-rose-500/60 bg-rose-500/10 p-3 text-sm" role="alertdialog" data-testid="mpw-confirm-delete">
              <p>Vas a quitar <b>{confirmDelete.length}</b> materia{confirmDelete.length === 1 ? "" : "s"} prima{confirmDelete.length === 1 ? "" : "s"} del Control semanal de esta semana (queda registrado quién y cuándo).</p>
              <p className="mt-1 text-xs text-[var(--os-text-muted)]">No se elimina nada del inventario, no cambia el stock, ni las fórmulas, ni las OE, ni los consumos. Si después aparecen necesidades nuevas de esa materia prima, vuelve a mostrarse con un aviso. Se puede restaurar.</p>
              <div className="mt-2 flex gap-2">
                <Button type="button" size="sm" variant="destructive" className="min-h-11" disabled={busy} onClick={() => void removeRows(confirmDelete)} data-testid="mpw-confirm-delete-yes">{busy ? "Quitando…" : "Quitar del control"}</Button>
                <Button type="button" size="sm" variant="secondary" className="min-h-11" onClick={() => setConfirmDelete(null)} data-testid="mpw-confirm-delete-no">Cancelar</Button>
              </div>
            </div>
          ) : null}

          <ul className="mt-3 space-y-3" data-testid="mpw-list">
            {shown.map((it) => (
              <AttentionCard key={it.rowKey} item={it} today={currentByKey.get(it.rowKey) ?? null} row={rowsByKey.get(it.rowKey)} canEdit={canEdit} selectMode={selectMode} selected={selected.has(it.rowKey)} onToggle={() => toggle(it.rowKey)} onRemove={() => setConfirmDelete([it.rowKey])} onSaveNote={saveNote} onSaveGestion={saveGestion} />
            ))}
            {shown.length === 0 ? (
              <li className="rounded border border-dashed border-[var(--os-border)] px-3 py-5 text-center text-sm text-[var(--os-text-muted)]" data-testid="mpw-none">
                {savedItems.length === 0 ? "No hay materias primas para resolver: todas tienen stock suficiente (o están quitadas del control)." : "Ninguna materia prima con ese filtro."}
              </li>
            ) : null}
          </ul>
        </>
      )}

      {data && (data.excludedRows.length > 0 || data.excludedProductions.length > 0) ? (
        <details className="mt-3 rounded border border-[var(--os-border)] p-2 text-xs" data-testid="mpw-excluded">
          <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold">Quitadas de esta semana: {data.excludedRows.length} materia{data.excludedRows.length === 1 ? "" : "s"} prima{data.excludedRows.length === 1 ? "" : "s"}{data.excludedProductions.length ? ` · ${data.excludedProductions.length} producción${data.excludedProductions.length === 1 ? "" : "es"}` : ""}</summary>
          <p className="mb-2 text-[var(--os-text-muted)]">Quitar nunca borra stock, fórmulas, OE ni movimientos: solo oculta la necesidad de esta semana. Se vuelve a mostrar sola si aparecen necesidades nuevas o mayores. Podés restaurar una por una o varias a la vez.</p>
          {confirmRestore ? (
            <div className="mb-2 rounded border border-emerald-400/60 bg-emerald-400/10 p-3" role="alertdialog" data-testid="mpw-restore-confirm">
              <p>Vas a restaurar <b>{confirmRestore.length}</b> materia{confirmRestore.length === 1 ? "" : "s"} prima{confirmRestore.length === 1 ? "" : "s"} en el control de esta semana. No se modifica stock, fórmulas ni OE.</p>
              <div className="mt-2 flex gap-2">
                <Button type="button" size="sm" className="min-h-11" onClick={() => void doRestore(confirmRestore)} data-testid="mpw-restore-yes">Restaurar</Button>
                <Button type="button" size="sm" variant="secondary" className="min-h-11" onClick={() => setConfirmRestore(null)} data-testid="mpw-restore-no">Cancelar</Button>
              </div>
            </div>
          ) : null}
          {data.excludedRows.length > 0 ? (
            <div data-testid="mpw-excluded-rows">
              <h4 className="mb-1 font-semibold">Materias primas quitadas por una persona</h4>
              {canEdit ? (
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Button type="button" size="sm" variant="secondary" className="min-h-11" onClick={() => setRestoreSel(new Set(data.excludedRows.map((r) => r.key)))} data-testid="mpw-restore-all">Seleccionar todas</Button>
                  <Button type="button" size="sm" variant="secondary" className="min-h-11" onClick={() => setRestoreSel(new Set())}>Ninguna</Button>
                  <Button type="button" size="sm" className="min-h-11" disabled={restoreSel.size === 0} onClick={() => setConfirmRestore([...restoreSel])} data-testid="mpw-restore-selected">Restaurar seleccionadas ({restoreSel.size})</Button>
                </div>
              ) : null}
              <ul className="space-y-2">
                {data.excludedRows.map((r) => (
                  <li key={r.key} className="flex flex-wrap items-start gap-2 rounded border border-[var(--os-border)] p-2" data-testid="mpw-excluded-item">
                    {canEdit ? <input type="checkbox" className="mt-1 size-6" aria-label={`Elegir ${r.materiaPrima}`} checked={restoreSel.has(r.key)} onChange={() => setRestoreSel((cur) => { const n = new Set(cur); if (n.has(r.key)) n.delete(r.key); else n.add(r.key); return n; })} data-testid="mpw-restore-check" /> : null}
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{r.materiaPrima} — la quitó {r.state.excludedBy} el {fmtWhen(r.state.excludedAt)}</p>
                      <p className="text-[var(--os-text-muted)]" data-testid="mpw-excluded-scope">Alcance: toda la MP de esta semana · producciones que la necesitaban: {r.scope?.productionLabels.join(" · ") || "sin detalle guardado"} · necesidad al quitarla: {r.scope?.requeridoAtExclusion != null ? kg(r.scope.requeridoAtExclusion) : "—"} · hoy: {kg(r.requerido)}</p>
                    </div>
                    {canEdit ? <button type="button" className="min-h-11 rounded border border-[var(--os-border)] px-3" onClick={() => setConfirmRestore([r.key])} data-testid="mpw-restore">Restaurar</button> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {data.excludedProductions.length > 0 ? (
            <div className="mt-3" data-testid="mpw-prod-excluded-panel">
              <h4 className="mb-1 font-semibold">Producciones quitadas del cálculo de esta semana</h4>
              <ul className="space-y-1">
                {data.excludedProductions.map((p) => (
                  <li key={p.workItemId} className="flex flex-wrap items-center gap-2">
                    <span>{p.label} · {p.by} · {fmtWhen(p.at)}{p.reason ? ` — ${p.reason}` : ""}</span>
                    {canEdit ? <button type="button" className="min-h-11 rounded border border-[var(--os-border)] px-3" onClick={() => void productionAction(p.workItemId, p.label, true)} data-testid="mpw-prod-restore-panel">Volver a sumar</button> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </details>
      ) : null}
    </section>
  );
}

function AttentionCard({ item, today, row, canEdit, selectMode, selected, onToggle, onRemove, onSaveNote, onSaveGestion }: {
  item: AttentionItem;
  today: AttentionItem | null;
  row: WeeklyRow | undefined;
  canEdit: boolean;
  selectMode: boolean;
  selected: boolean;
  onToggle: () => void;
  onRemove: () => void;
  onSaveNote: (row: WeeklyRow, text: string) => Promise<void>;
  onSaveGestion: (row: WeeklyRow, gestion: string) => Promise<void>;
}) {
  const tone = TONE_OF[item.status];
  const changed = today
    ? today.status !== item.status || Math.abs(today.stockUtilizable - item.stockUtilizable) > 0.0005 || Math.abs(today.necesidadTotal - item.necesidadTotal) > 0.0005
    : true;
  return (
    <li className={`rounded-lg border p-3 ${TONE_CELL[tone]} ${selected ? "outline outline-2 outline-[var(--os-teal)]" : ""}`} data-testid="mpw-row" data-estado={item.status} data-selected={selected ? "true" : "false"}>
      <div className="flex flex-wrap items-center gap-2">
        {selectMode ? <input type="checkbox" aria-label={`Seleccionar ${item.materiaPrima}`} className="size-6" checked={selected} onChange={onToggle} data-testid="mpw-check" /> : null}
        <span className={`inline-block rounded border px-2 py-0.5 text-xs font-bold ${TONE_BADGE[tone]}`} data-testid="mpw-estado">{ATTENTION_LABEL[item.status]}</span>
        <span className="text-base font-semibold" data-testid="mpw-mp">{item.materiaPrima}</span>
        {item.codigo ? <span className="font-mono text-xs text-[var(--os-text-muted)]">{item.codigo}</span> : null}
        {canEdit && !selectMode ? <button type="button" className="ml-auto min-h-11 rounded border border-rose-500/50 px-3 text-xs text-rose-300" onClick={onRemove} data-testid="mpw-row-remove">Quitar</button> : null}
      </div>
      {item.status === "SIN_DATOS" ? (
        <p className="mt-1 text-sm" data-testid="mpw-sindatos">No se pudo vincular esta materia prima al inventario (o faltan datos): <b>no se asume stock cero</b>. Necesidad conocida: {kg(item.necesidadTotal)}.</p>
      ) : (
        <p className="mt-1 text-sm" data-testid="mpw-totales">
          {item.compartida ? "Stock utilizable total (compartido): " : "Disponible: "}<b data-testid="mpw-disp">{kg(item.stockUtilizable)}</b> · {item.compartida ? "Necesidad total: " : "Necesario: "}<b data-testid="mpw-nec">{kg(item.necesidadTotal)}</b> · {item.compartida ? "Faltante total: " : "Faltante: "}<b className="text-rose-300" data-testid="mpw-falta">{kg(item.faltanteTotal)}</b>
        </p>
      )}
      <ul className="mt-2 space-y-1" data-testid="mpw-productos">
        {item.productos.map((p, i) => (
          <li key={`${p.client}|${p.product}|${i}`} className={`rounded border border-[var(--os-border)] px-2 py-1 text-xs ${p.afectado ? "bg-black/10" : "opacity-70"}`} data-testid="mpw-producto" data-afectado={p.afectado ? "true" : "false"}>
            <span className="font-medium">{p.product}</span> — {p.client}
            {p.oes.length ? <> · OE {p.oes.join(", ")}</> : null}
            {p.weekKg != null ? <> · elaboración de la semana: {kg(p.weekKg)}</> : null}
            <> · necesita {kg(p.necesidadKg)}</>
            {item.status !== "SIN_DATOS" ? <> · le tocan {kg(p.disponibleKg)} · {p.faltanteKg ? <b className="text-rose-300">falta {kg(p.faltanteKg)}</b> : "cubierto con su parte"}</> : null}
            {item.compartida && p.afectado && item.status !== "SIN_DATOS" ? <span className="ml-1 rounded border border-amber-400/60 px-1 text-[10px]">afectado</span> : null}
          </li>
        ))}
      </ul>
      {changed ? (
        <p className="mt-2 text-xs text-amber-200" data-testid="mpw-today">
          Hoy: {today ? <>disponible {kg(today.stockUtilizable)} · necesario {kg(today.necesidadTotal)} · {ATTENTION_LABEL[today.status]}</> : <>ya no necesita atención (stock suficiente)</>}
        </p>
      ) : null}
      {row ? (
        <div className="mt-2 grid gap-2 md:grid-cols-2">
          <div onClick={(e) => e.stopPropagation()}>
            <p className="text-[11px] text-[var(--os-text-muted)]">Decisión</p>
            {canEdit ? (
              <select value={row.state.gestion} onChange={(e) => void onSaveGestion(row, e.target.value)} className="min-h-11 w-full rounded border border-[var(--os-border)] bg-[var(--os-surface)] px-1 text-xs" data-testid="mpw-gestion">
                {Object.entries(GESTION_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            ) : (
              <span className="text-xs">{GESTION_LABEL[row.state.gestion] ?? "—"}</span>
            )}
            {row.state.gestion && row.state.gestionBy ? <p className="mt-0.5 text-[10px] text-[var(--os-text-muted)]">{row.state.gestionBy} · {fmtWhen(row.state.gestionAt)}</p> : null}
          </div>
          <div>
            <p className="text-[11px] text-[var(--os-text-muted)]">Observaciones</p>
            <NoteCell row={row} canEdit={canEdit} onSave={onSaveNote as never} />
          </div>
        </div>
      ) : null}
    </li>
  );
}
