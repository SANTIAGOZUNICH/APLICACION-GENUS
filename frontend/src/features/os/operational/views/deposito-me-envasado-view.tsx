"use client";

import { useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { TwinShell } from "@/features/os/shell/twin-shell";
import { usePreviewSession } from "@/features/os/session/preview-context";
import { addDaysIso, parseIsoDate, todayInBuenosAires, weekStartMonday, workWeekDays } from "@/lib/operational/operational-calendar";
import { ME_LABEL, ME_MAX_OBSERVATION, canSetMeStatus, type MeInfo, type MeStatus } from "@/lib/me-status/me-status";
import type { WeeklyPlanItemDto } from "@/lib/planning/weekly-plan-dto";
import { MeBadge } from "../components/me-badge";
import { useSharedWeeklyPlan, type PlanSectorFilter } from "../hooks/use-shared-weekly-plan";

const FILTERS: Array<{ id: PlanSectorFilter; label: string }> = [
  { id: "ALL", label: "Todos" },
  { id: "ENVASADO_MASIVO", label: "Envasado Masivo" },
  { id: "ENVASADO_PREMIUM", label: "Envasado Premium" },
];
const SHORT_SECTOR: Record<string, string> = { ENVASADO_MASIVO: "Masivo", ENVASADO_PREMIUM: "Premium" };
const ACTIONS: Array<{ st: MeStatus; text: string; title: string }> = [
  { st: "SIN_INFO", text: "Sin info", title: "Sin verificar: retira la confirmación" },
  { st: "OK", text: "✅", title: "Material de Envase correcto" },
  { st: "NO_OK", text: "❌", title: "Material de Envase incorrecto, incompleto o no disponible" },
];
/** Computadora ancha (xl): una fila con las 7 columnas; en pantallas menores (tablet) cada trabajo es un bloque apilado: nada queda fuera de la pantalla. */
const GRID = "xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1.5fr)_4.5rem_5rem_6rem_6.5rem_15rem]";
const fmtDate = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : iso);

/**
 * Depósito → «ME de Envasado»: los trabajos de Envasado programados (la MISMA planificación compartida, sin copias) con el estado del Material de
 * Envase y, en la columna Acciones, SIEMPRE visibles, los tres botones (Sin info / ✅ / ❌) más la observación — sin abrir otro panel y sin
 * desplazamiento horizontal en computadora ni tablet. Quién puede modificar lo decide el SERVIDOR (Depósito y Dirección) y la pantalla lo respeta:
 * la fila se actualiza al instante y, si el servidor rechaza, se vuelve al estado anterior con el motivo. Informativo: no mueve stock.
 */
export function DepositoMeEnvasadoView() {
  const { sectorId } = usePreviewSession();
  const today = useMemo(() => todayInBuenosAires(), []);
  const [anchor, setAnchor] = useState(today);
  const weekStart = useMemo(() => weekStartMonday(anchor), [anchor]);
  const days = useMemo(() => workWeekDays(weekStart), [weekStart]);
  const [filter, setFilter] = useState<PlanSectorFilter>("ALL");
  const { items, loading, error, updatedAgoLabel, refresh, canEditMe, actorSector } = useSharedWeeklyPlan({ weekStart, planSector: filter });
  // El permiso lo dice el servidor (sesión real); mientras no responde, se usa el sector de la sesión de la pantalla.
  const canEdit = canEditMe ?? canSetMeStatus(sectorId);
  const [local, setLocal] = useState<Record<string, MeInfo>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const rows = useMemo(
    () => [...items].filter((i) => i.me).sort((a, b) => a.plannedDate.localeCompare(b.plannedDate) || a.client.localeCompare(b.client) || a.product.localeCompare(b.product)),
    [items]
  );
  const meOf = (i: WeeklyPlanItemDto): MeInfo => local[i.workItemId] ?? i.me!;
  const pending = rows.filter((i) => meOf(i).status === "SIN_INFO").length;

  async function save(i: WeeklyPlanItemDto, status: MeStatus) {
    if (!canEdit || busy) return;
    const previous = meOf(i);
    const observation = (drafts[i.workItemId] ?? previous.observation ?? "").trim();
    setBusy(i.workItemId);
    setMsg(null);
    // Inmediato: la fila cambia al pulsar; si el servidor rechaza se vuelve al estado anterior.
    setLocal((l) => ({ ...l, [i.workItemId]: { ...previous, status, observation: observation || null } }));
    try {
      const res = await fetch(`/api/v1/work-items/${i.workItemId}/me`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status, observation: observation || null }) });
      const json = (await res.json().catch(() => ({}))) as { me?: MeInfo; error?: string };
      if (!res.ok || !json.me) throw new Error(json.error ?? `El servidor rechazó el cambio (${res.status}).`);
      setLocal((l) => ({ ...l, [i.workItemId]: json.me! }));
      setDrafts((d) => { const n = { ...d }; delete n[i.workItemId]; return n; });
      setMsg({ ok: true, text: `ME de «${i.product}» → ${ME_LABEL[status]}` });
      refresh();
    } catch (e) {
      setLocal((l) => ({ ...l, [i.workItemId]: previous }));
      setMsg({ ok: false, text: e instanceof Error ? e.message : "No se pudo guardar el estado de ME." });
    } finally {
      setBusy(null);
    }
  }

  const s = parseIsoDate(weekStart);
  const e = parseIsoDate(days[days.length - 1] ?? weekStart);
  return (
    <TwinShell title="ME de Envasado">
      <div className="space-y-3" data-testid="deposito-me-envasado" data-week-start={weekStart} data-can-edit={canEdit ? "1" : "0"} data-actor-sector={actorSector ?? ""}>
        <header>
          <h2 className="text-2xl font-semibold tracking-tight">ME de Envasado</h2>
          <p className="text-sm text-[var(--os-text-muted)]" data-testid="me-help">
            {canEdit
              ? "Marcá si el Material de Envase de cada trabajo está ✅ correcto, ❌ incorrecto o incompleto, o Sin info. Informativo: no mueve stock ni frena la producción."
              : "Consulta del estado del Material de Envase de cada trabajo. Solo Depósito (y Dirección) puede modificarlo."}
          </p>
        </header>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="min-h-10 rounded border border-[var(--os-border)] px-3 text-sm" onClick={() => setAnchor(addDaysIso(weekStart, -7))} data-testid="me-prev">Semana anterior</button>
          <button type="button" className="min-h-10 rounded border border-[var(--os-border)] px-3 text-sm" onClick={() => setAnchor(today)} data-testid="me-today">Semana actual</button>
          <button type="button" className="min-h-10 rounded border border-[var(--os-border)] px-3 text-sm" onClick={() => setAnchor(addDaysIso(weekStart, 7))} data-testid="me-next">Semana siguiente</button>
          <span className="px-1 text-base font-semibold" data-testid="me-range">{s?.day}/{s?.month} – {e?.day}/{e?.month}<span className="ml-2 text-sm font-normal text-[var(--os-text-muted)]" data-testid="me-count">{loading ? "Cargando…" : `${rows.length} trabajo${rows.length === 1 ? "" : "s"} · ${pending} sin verificar`}</span></span>
          <div className="flex flex-wrap gap-1">
            {FILTERS.map((f) => (
              <button key={f.id} type="button" className={`min-h-10 rounded px-3 text-sm ${filter === f.id ? "bg-[var(--os-teal)] text-[var(--os-navy)]" : "border border-[var(--os-border)]"}`} onClick={() => setFilter(f.id)} data-testid={`me-filter-${f.id}`}>{f.label}</button>
            ))}
          </div>
          <button type="button" className="ml-auto inline-flex min-h-10 items-center gap-1 rounded border border-[var(--os-border)] px-3 text-sm" onClick={() => refresh()} data-testid="me-refresh"><RefreshCw className="size-4" aria-hidden="true" /> Actualizar</button>
          <span className="text-xs text-[var(--os-text-muted)]">Actualizado {updatedAgoLabel}</span>
        </div>
        {error ? <div role="alert" className="rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm" data-testid="me-load-error">No pudimos actualizar el plan{rows.length > 0 ? " — se conserva la última vista correcta." : "."}</div> : null}
        {msg ? <p role={msg.ok ? "status" : "alert"} className={`rounded border px-3 py-2 text-sm ${msg.ok ? "border-[var(--os-border)]" : "border-rose-400/50 bg-rose-500/10 text-rose-100"}`} data-testid={msg.ok ? "me-msg" : "me-error"}>{msg.ok ? msg.text : `No se pudo guardar: ${msg.text}`}</p> : null}
        {!loading && rows.length === 0 ? <p className="text-sm text-[var(--os-text-muted)]" data-testid="me-empty-week">No hay trabajos de Envasado programados en esta semana.</p> : null}
        {rows.length > 0 ? (
          <div className="rounded border border-[var(--os-border)]" role="table" aria-label="Trabajos de Envasado y estado de ME" data-testid="me-envasado-table">
            <div role="row" className={`hidden gap-x-3 p-2 text-xs uppercase text-[var(--os-text-muted)] xl:grid ${GRID}`}>
              <div role="columnheader">Cliente</div><div role="columnheader">Producto</div><div role="columnheader">Fecha</div><div role="columnheader">Sector</div><div role="columnheader" className="text-right">Cantidad</div><div role="columnheader">Estado ME</div><div role="columnheader">Acciones</div>
            </div>
            {rows.map((i) => {
              const me = meOf(i);
              const draft = drafts[i.workItemId] ?? me.observation ?? "";
              const dirty = draft.trim() !== (me.observation ?? "");
              return (
                <div key={i.workItemId} role="row" className={`grid gap-x-3 gap-y-1.5 border-t border-[var(--os-border)] p-2 text-sm ${GRID}`} data-testid="me-row" data-id={i.workItemId} data-me-status={me.status}>
                  <div role="cell" className="hidden break-words font-medium xl:block">{i.client}</div>
                  <div role="cell" className="min-w-0 break-words">
                    <span className="font-medium xl:font-normal">{i.product}</span>
                    <span className="mt-0.5 block text-xs text-[var(--os-text-muted)] xl:hidden" data-testid="me-meta-compact">{i.client} · {fmtDate(i.plannedDate)} · {SHORT_SECTOR[i.sector] ?? i.sectorLabel} · {i.quantity} {i.unit}</span>
                  </div>
                  <div role="cell" className="hidden whitespace-nowrap xl:block">{fmtDate(i.plannedDate)}{i.plannedDateTo && i.plannedDateTo !== i.plannedDate ? ` → ${fmtDate(i.plannedDateTo)}` : ""}</div>
                  <div role="cell" className="hidden xl:block" title={i.sectorLabel}>{SHORT_SECTOR[i.sector] ?? i.sectorLabel}</div>
                  <div role="cell" className="hidden text-right tabular-nums xl:block">{i.quantity} {i.unit}</div>
                  <div className="flex flex-wrap items-center gap-2 xl:contents">
                    <div role="cell" data-testid="me-state-cell"><MeBadge me={me} /></div>
                    <div role="cell" data-testid="me-actions-cell">
                      {canEdit ? (
                        <div className="flex gap-1" role="group" aria-label={`Estado ME de ${i.product}`}>
                          {ACTIONS.map((a) => (
                            <button key={a.st} type="button" disabled={busy === i.workItemId} aria-pressed={me.status === a.st} title={a.title} data-testid={`me-set-${a.st}`}
                              className={`min-h-10 min-w-[4.5rem] whitespace-nowrap rounded border px-3 text-sm font-semibold ${me.status === a.st ? "border-[var(--os-teal)] bg-[var(--os-teal)]/25" : "border-[var(--os-border)] hover:bg-white/5"}`}
                              onClick={() => void save(i, a.st)}>{a.text}</button>
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs text-[var(--os-text-muted)]" data-testid="me-readonly">Solo consulta</span>
                      )}
                    </div>
                  </div>
                  <div className="xl:col-span-7" data-testid="me-obs-row">
                    {canEdit ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <input className="min-w-[12rem] flex-1 rounded border border-[var(--os-border)] bg-transparent px-2 py-1.5 text-sm" maxLength={ME_MAX_OBSERVATION} placeholder="Observación de Depósito (ej.: Faltan 300 pomos de 200 ml)" aria-label={`Observación de ME de ${i.product}`}
                          value={draft} onChange={(ev) => setDrafts((d) => ({ ...d, [i.workItemId]: ev.target.value }))} onKeyDown={(ev) => { if (ev.key === "Enter") void save(i, me.status); }} data-testid="me-observation-input" />
                        {dirty ? <button type="button" disabled={busy === i.workItemId} className="min-h-9 rounded border border-[var(--os-teal)] px-3 text-xs font-semibold" onClick={() => void save(i, me.status)} data-testid="me-observation-save">Guardar observación</button> : null}
                      </div>
                    ) : me.observation ? (
                      <span className="text-sm text-[var(--os-text-muted)]" data-testid="me-observation-text">Observación: {me.observation}</span>
                    ) : null}
                    {me.updatedBy ? <span className="ml-1 text-[11px] text-[var(--os-text-muted)]">{me.updatedBy}{me.updatedAt ? ` · ${new Date(me.updatedAt).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" })}` : ""}</span> : null}
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    </TwinShell>
  );
}
