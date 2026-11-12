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
const fmtDate = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : iso);

/**
 * Depósito → «ME de Envasado»: los trabajos de Envasado programados (la MISMA planificación compartida, sin copias) con el estado del Material de
 * Envase y sus tres botones (Sin info / ✅ / ❌) + observación, para controlar todo sin abrir otras pantallas. Solo Depósito (y Dirección) modifica;
 * el permiso se valida en el servidor. Es informativo: no mueve stock ni bloquea la producción.
 */
export function DepositoMeEnvasadoView() {
  const { sectorId } = usePreviewSession();
  const canEdit = canSetMeStatus(sectorId);
  const today = useMemo(() => todayInBuenosAires(), []);
  const [anchor, setAnchor] = useState(today);
  const weekStart = useMemo(() => weekStartMonday(anchor), [anchor]);
  const days = useMemo(() => workWeekDays(weekStart), [weekStart]);
  const [filter, setFilter] = useState<PlanSectorFilter>("ALL");
  const { items, loading, error, updatedAgoLabel, refresh } = useSharedWeeklyPlan({ weekStart, planSector: filter });
  const [local, setLocal] = useState<Record<string, MeInfo>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const rows = useMemo(
    () => [...items].filter((i) => i.me).sort((a, b) => a.plannedDate.localeCompare(b.plannedDate) || a.client.localeCompare(b.client)),
    [items]
  );
  const meOf = (i: WeeklyPlanItemDto): MeInfo => local[i.workItemId] ?? i.me!;

  async function save(i: WeeklyPlanItemDto, status: MeStatus) {
    if (!canEdit || busy) return;
    const observation = (drafts[i.workItemId] ?? meOf(i).observation ?? "").trim();
    setBusy(i.workItemId);
    setMsg(null);
    try {
      const res = await fetch(`/api/v1/work-items/${i.workItemId}/me`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status, observation: observation || null }) });
      const json = (await res.json().catch(() => ({}))) as { me?: MeInfo; error?: string };
      if (!res.ok || !json.me) throw new Error(json.error ?? "No se pudo guardar el estado de ME.");
      setLocal((l) => ({ ...l, [i.workItemId]: json.me! }));
      setDrafts((d) => { const n = { ...d }; delete n[i.workItemId]; return n; });
      setMsg(`ME de «${i.product}» → ${ME_LABEL[status]}`);
      refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "No se pudo guardar el estado de ME.");
    } finally {
      setBusy(null);
    }
  }

  const s = parseIsoDate(weekStart);
  const e = parseIsoDate(days[days.length - 1] ?? weekStart);
  return (
    <TwinShell title="ME de Envasado">
      <div className="space-y-4" data-testid="deposito-me-envasado" data-week-start={weekStart}>
        <header>
          <h2 className="text-2xl font-semibold tracking-tight">ME de Envasado</h2>
          <p className="text-sm text-[var(--os-text-muted)]">
            Trabajos de Envasado programados (misma planificación de todos los sectores). Marcá si el Material de Envase está <strong>✅ correcto</strong>, <strong>❌ incorrecto o incompleto</strong> o <strong>Sin info</strong>. Es informativo: no mueve stock ni frena la producción.
            {canEdit ? "" : " Tu sector consulta: solo Depósito puede modificarlo."}
          </p>
        </header>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="min-h-10 rounded border border-[var(--os-border)] px-3 text-sm" onClick={() => setAnchor(addDaysIso(weekStart, -7))} data-testid="me-prev">Semana anterior</button>
          <button type="button" className="min-h-10 rounded border border-[var(--os-border)] px-3 text-sm" onClick={() => setAnchor(today)} data-testid="me-today">Semana actual</button>
          <button type="button" className="min-h-10 rounded border border-[var(--os-border)] px-3 text-sm" onClick={() => setAnchor(addDaysIso(weekStart, 7))} data-testid="me-next">Semana siguiente</button>
          <span className="px-1 text-base font-semibold" data-testid="me-range">{s?.day}/{s?.month} – {e?.day}/{e?.month}<span className="ml-2 text-sm font-normal text-[var(--os-text-muted)]">{loading ? "Cargando…" : `${rows.length} trabajo${rows.length === 1 ? "" : "s"}`}</span></span>
          {FILTERS.map((f) => (
            <button key={f.id} type="button" className={`min-h-10 rounded px-3 text-sm ${filter === f.id ? "bg-[var(--os-teal)] text-[var(--os-navy)]" : "border border-[var(--os-border)]"}`} onClick={() => setFilter(f.id)} data-testid={`me-filter-${f.id}`}>{f.label}</button>
          ))}
          <button type="button" className="ml-auto inline-flex min-h-10 items-center gap-1 rounded border border-[var(--os-border)] px-3 text-sm" onClick={() => refresh()} data-testid="me-refresh"><RefreshCw className="size-4" aria-hidden="true" /> Actualizar</button>
          <span className="text-xs text-[var(--os-text-muted)]">Actualizado {updatedAgoLabel}</span>
        </div>
        {error ? <div role="alert" className="rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">No pudimos actualizar el plan.</div> : null}
        {msg ? <p className="rounded border border-[var(--os-border)] px-3 py-2 text-sm" role="status" data-testid="me-msg">{msg}</p> : null}
        {!loading && rows.length === 0 ? <p className="text-sm text-[var(--os-text-muted)]" data-testid="me-empty-week">No hay trabajos de Envasado programados en esta semana.</p> : null}
        {rows.length > 0 ? (
          <div className="overflow-x-auto rounded border border-[var(--os-border)]">
            <table className="os-table w-full min-w-[56rem] text-left text-sm" data-testid="me-envasado-table">
              <thead className="text-xs uppercase text-[var(--os-text-muted)]">
                <tr><th className="p-2">Cliente</th><th className="p-2">Producto</th><th className="p-2">Fecha</th><th className="p-2">Envasado</th><th className="p-2 text-right">Cantidad</th><th className="p-2">Estado ME</th><th className="p-2">Observación de Depósito</th></tr>
              </thead>
              <tbody>
                {rows.map((i) => {
                  const me = meOf(i);
                  const draft = drafts[i.workItemId] ?? me.observation ?? "";
                  return (
                    <tr key={i.workItemId} className="border-t border-[var(--os-border)] align-top" data-testid="me-row" data-id={i.workItemId} data-me-status={me.status}>
                      <td className="p-2 font-medium">{i.client}</td>
                      <td className="p-2">{i.product}</td>
                      <td className="p-2 whitespace-nowrap">{fmtDate(i.plannedDate)}{i.plannedDateTo && i.plannedDateTo !== i.plannedDate ? ` → ${fmtDate(i.plannedDateTo)}` : ""}</td>
                      <td className="p-2">{i.sectorLabel}</td>
                      <td className="p-2 text-right tabular-nums">{i.quantity} {i.unit}</td>
                      <td className="p-2">
                        <div className="mb-1"><MeBadge me={me} /></div>
                        {canEdit ? (
                          <div className="inline-flex gap-1" role="group" aria-label={`Estado ME de ${i.product}`}>
                            {(["SIN_INFO", "OK", "NO_OK"] as const).map((st) => (
                              <button key={st} type="button" disabled={busy === i.workItemId} aria-pressed={me.status === st} data-testid={`me-set-${st}`}
                                className={`min-h-9 rounded border px-2 text-xs font-semibold ${me.status === st ? "border-[var(--os-teal)] bg-[var(--os-teal)]/20" : "border-[var(--os-border)]"}`}
                                onClick={() => void save(i, st)}>{ME_LABEL[st]}</button>
                            ))}
                          </div>
                        ) : null}
                        {me.updatedBy ? <div className="mt-1 text-[11px] text-[var(--os-text-muted)]">{me.updatedBy}{me.updatedAt ? ` · ${new Date(me.updatedAt).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" })}` : ""}</div> : null}
                      </td>
                      <td className="p-2">
                        {canEdit ? (
                          <input className="w-full min-w-[14rem] rounded border border-[var(--os-border)] bg-transparent px-2 py-1.5 text-sm" maxLength={ME_MAX_OBSERVATION} placeholder="Ej.: Faltan 300 pomos de 200 ml" aria-label={`Observación de ME de ${i.product}`}
                            value={draft} onChange={(ev) => setDrafts((d) => ({ ...d, [i.workItemId]: ev.target.value }))} onKeyDown={(ev) => { if (ev.key === "Enter") void save(i, me.status); }} data-testid="me-observation-input" />
                        ) : (
                          <span>{me.observation ?? "—"}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </TwinShell>
  );
}
