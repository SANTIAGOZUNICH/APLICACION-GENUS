"use client";

/**
 * Producción → Semanas: vínculo EXPLÍCITO de una tarea con sus trabajos operativos («Mi trabajo» de cada sector).
 * Nunca se vincula solo: se muestran sugerencias de la misma semana y sector (con qué coincide cada una) y Producción
 * confirma. Corregir un vínculo de otra tarea o quitarlo exige motivo; todo queda en el historial.
 * Se edita en un panel EN LÍNEA debajo de la fila (sin ventanas flotantes).
 */
import { useEffect, useState } from "react";
import { AlertTriangle, Link2, Unlink } from "lucide-react";
import { formatDay, PLAN_SECTOR_LABEL, type PlanTask } from "@/lib/semanas-sheet/plan-tasks";
import type { LinkSuggestionsDto } from "@/lib/semanas-sheet/semanas-client";
import { MIN_LINK_REASON, type LinkCandidate, type LinkView, type WorkItemBrief } from "@/lib/semanas-sheet/task-links";

const SECTOR_LABEL: Record<string, string> = { ...PLAN_SECTOR_LABEL, CODIFICADO: "Codificado" };
const HINT_LABEL: Record<LinkCandidate["hints"][number], string> = { MISMO_DIA: "mismo día", CLIENTE: "cliente", PRODUCTO: "producto" };

export interface LinkActions {
  canLink: boolean;
  loadCandidates: (taskKey: string) => Promise<LinkSuggestionsDto>;
  link: (taskKey: string, workItemId: string, replace?: { linkId: string; expectedVersion: number }, reason?: string) => Promise<void>;
  unlink: (linkId: string, expectedVersion: number, reason: string) => Promise<void>;
}

function itemLine(wi: WorkItemBrief | null): string {
  if (!wi) return "Trabajo inexistente";
  return `${wi.product} · ${wi.quantity} ${wi.unit}`;
}

/** Celda de la Lista: trabajos vinculados (o «Sin vincular»). Clic → abre el panel en línea. */
export function LinkCell({ links, open, onToggle, available }: { links: LinkView[]; open: boolean; onToggle: () => void; available: boolean }) {
  if (!available) return <span className="text-xs text-[var(--os-text-muted)]" title="Requiere planificación nativa (base de datos) y la migración 0042.">No disponible</span>;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      data-testid="list-link-cell"
      data-linked={links.length}
      className={`w-full rounded-lg border px-2 py-1 text-left text-xs transition-colors ${open ? "border-[var(--os-teal)] bg-[var(--os-teal-soft)]" : "border-[var(--os-border)] hover:border-[var(--os-teal)]"}`}
    >
      {links.length === 0 ? (
        <span className="inline-flex items-center gap-1 font-semibold text-[var(--os-text-muted)]">
          <Link2 className="size-3.5" aria-hidden="true" /> Sin vincular
        </span>
      ) : (
        links.map((l) => (
          <span key={l.linkId} className="flex items-center gap-1 font-semibold text-[var(--os-text)]" data-testid="list-link-chip">
            {l.warnings.length > 0 ? <AlertTriangle className="size-3.5 shrink-0 text-amber-300" aria-label="Revisar" /> : <Link2 className="size-3.5 shrink-0 text-[var(--os-teal)]" aria-hidden="true" />}
            <span className="truncate">{itemLine(l.workItem)}</span>
          </span>
        ))
      )}
    </button>
  );
}

function ReasonForm({ label, onConfirm, onCancel, busy, testId }: { label: string; onConfirm: (reason: string) => void; onCancel: () => void; busy: boolean; testId: string }) {
  const [reason, setReason] = useState("");
  const ok = reason.trim().length >= MIN_LINK_REASON;
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-2">
      <input
        autoFocus
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && ok) onConfirm(reason.trim());
          if (e.key === "Escape") onCancel();
          e.stopPropagation();
        }}
        placeholder={`Motivo (mín. ${MIN_LINK_REASON} caracteres, queda auditado)`}
        className="min-w-[16rem] flex-1 rounded-md border border-[var(--os-border)] bg-[var(--os-bg)] px-2 py-1 text-xs"
        data-testid={`${testId}-reason`}
      />
      <button type="button" disabled={!ok || busy} onClick={() => onConfirm(reason.trim())} className="rounded-md bg-[var(--os-teal)] px-2.5 py-1 text-xs font-bold text-[#04201e] disabled:opacity-50" data-testid={`${testId}-confirm`}>
        {label}
      </button>
      <button type="button" onClick={onCancel} className="rounded-md border border-[var(--os-border)] px-2.5 py-1 text-xs">
        Cancelar
      </button>
    </div>
  );
}

function ItemSummary({ wi, hints }: { wi: WorkItemBrief | null; hints?: LinkCandidate["hints"] }) {
  if (!wi) return <span className="text-[var(--os-text-muted)]">El trabajo ya no existe.</span>;
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-bold text-white">{wi.product}</span>
        <span className="font-extrabold tabular-nums text-[#5eead4]">
          {wi.quantity} {wi.unit}
        </span>
      </div>
      <div className="text-[var(--os-text-muted)]">
        {wi.client} · {formatDay(wi.plannedDate)}
        {wi.plannedDateTo && wi.plannedDateTo !== wi.plannedDate ? ` → ${formatDay(wi.plannedDateTo)}` : ""} · {SECTOR_LABEL[wi.sector] ?? wi.sector}
        {wi.line ? ` · ${wi.line}` : wi.branchOwner ? ` · ${wi.branchOwner}` : ""}
        {wi.orderNumber ? ` · ${wi.orderNumber}` : ""}
      </div>
      {hints && (
        <div className="mt-0.5 flex flex-wrap gap-1">
          {hints.length === 0 ? (
            <span className="rounded bg-white/5 px-1.5 text-[10px] uppercase tracking-wide text-[var(--os-text-muted)]">sin coincidencias</span>
          ) : (
            hints.map((h) => (
              <span key={h} className="rounded bg-[var(--os-teal-soft)] px-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--os-text)]">
                coincide {HINT_LABEL[h]}
              </span>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/** Panel en línea (fila expandida) con los vínculos de la tarea, sugerencias y correcciones. */
export function LinkPanel({ task, links, actions, colSpan }: { task: PlanTask; links: LinkView[]; actions: LinkActions; colSpan: number }) {
  const [data, setData] = useState<LinkSuggestionsDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState<string | null>(null); // linkId a quitar o workItemId a mover
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!actions.canLink) return;
    let alive = true;
    actions
      .loadCandidates(task.key)
      .then((d) => alive && (setData(d), setError(null)))
      .catch((e) => alive && setError(e instanceof Error ? e.message : "No se pudieron leer los trabajos."));
    return () => {
      alive = false;
    };
  }, [actions, task.key, reload]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setAsking(null);
      setData(null); // nunca mostrar sugerencias viejas mientras se releen
      setReload((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <tr data-testid="list-link-row">
      <td colSpan={colSpan} className="border-b border-[var(--os-border)] bg-[#0b2233] px-4 py-3 text-xs">
        <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
          <section aria-label="Trabajos vinculados">
            <h4 className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--os-text-muted)]">Trabajos vinculados ({links.length})</h4>
            <p className="mb-2 text-[var(--os-text-muted)]">El sector ve la prioridad de esta tarea en «Mi trabajo» solo en estos trabajos.</p>
            {links.length === 0 && <p className="text-[var(--os-text-muted)]">Ninguno todavía.</p>}
            <ul className="space-y-2">
              {links.map((l) => (
                <li key={l.linkId} className="rounded-lg border border-white/10 bg-[#10304a] p-2" data-testid="link-current">
                  <div className="flex items-start justify-between gap-2">
                    <ItemSummary wi={l.workItem} />
                    {actions.canLink && asking !== l.linkId && (
                      <button type="button" onClick={() => setAsking(l.linkId)} className="inline-flex shrink-0 items-center gap-1 rounded-md border border-[var(--os-border)] px-2 py-1 hover:border-red-400" data-testid="link-unlink">
                        <Unlink className="size-3.5" aria-hidden="true" /> Quitar
                      </button>
                    )}
                  </div>
                  {l.warnings.map((w) => (
                    <p key={w} className="mt-1 text-amber-200">⚠ {w}</p>
                  ))}
                  <p className="mt-1 text-[var(--os-text-muted)]">
                    Vinculado por {l.linkedByName || l.linkedBy} · {new Date(l.createdAt).toLocaleString("es-AR")}
                    {l.relinked ? " · la tarea cambió de texto o de día y el vínculo la siguió" : ""}
                  </p>
                  {asking === l.linkId && <ReasonForm label="Quitar vínculo" busy={busy} testId="link-unlink" onCancel={() => setAsking(null)} onConfirm={(reason) => void run(() => actions.unlink(l.linkId, l.version, reason))} />}
                </li>
              ))}
            </ul>
          </section>

          <section aria-label="Sugerencias">
            <h4 className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--os-text-muted)]">Trabajos de la semana · {task.sector ? PLAN_SECTOR_LABEL[task.sector] : "sin sector"}</h4>
            <p className="mb-2 text-[var(--os-text-muted)]">Sugerencias ordenadas por parecido: GENUS no vincula nada solo. Confirmá solo si es el mismo trabajo.</p>
            {!actions.canLink && <p className="text-[var(--os-text-muted)]">Solo Producción puede vincular.</p>}
            {error && <p className="mb-2 rounded border border-red-400/40 bg-red-500/10 px-2 py-1 text-red-200" role="alert" data-testid="link-error">{error}</p>}
            {actions.canLink && !data && !error && <p className="text-[var(--os-text-muted)]">Buscando trabajos…</p>}
            {data && data.candidates.length === 0 && <p className="text-[var(--os-text-muted)]">No hay trabajos libres de este sector en esta semana.</p>}
            <ul className="space-y-1.5">
              {data?.candidates.map((c) => (
                <li key={c.workItem.id} className="flex items-start justify-between gap-2 rounded-lg border border-white/10 bg-[#0e2a40] p-2" data-testid="link-candidate">
                  <ItemSummary wi={c.workItem} hints={c.hints} />
                  <button type="button" disabled={busy} onClick={() => void run(() => actions.link(task.key, c.workItem.id))} className="shrink-0 rounded-md bg-[var(--os-teal)] px-2.5 py-1 font-bold text-[#04201e] disabled:opacity-50" data-testid="link-confirm">
                    Vincular
                  </button>
                </li>
              ))}
            </ul>
            {data && data.linkedElsewhere.length > 0 && (
              <details className="mt-3" data-testid="link-elsewhere">
                <summary className="cursor-pointer font-semibold text-[var(--os-text-muted)]">Ya vinculados a otra tarea ({data.linkedElsewhere.length}) — corregir un vínculo equivocado</summary>
                <ul className="mt-1.5 space-y-1.5">
                  {data.linkedElsewhere.map((c) => (
                    <li key={c.workItem.id} className="rounded-lg border border-white/10 bg-[#0e2a40] p-2">
                      <div className="flex items-start justify-between gap-2">
                        <ItemSummary wi={c.workItem} hints={c.hints} />
                        {asking !== c.workItem.id && (
                          <button type="button" onClick={() => setAsking(c.workItem.id)} className="shrink-0 rounded-md border border-[var(--os-border)] px-2.5 py-1 font-semibold hover:border-[var(--os-teal)]" data-testid="link-move">
                            Mover aquí
                          </button>
                        )}
                      </div>
                      <p className="mt-1 text-[var(--os-text-muted)]">Hoy vinculado a: {c.link.summary}</p>
                      {asking === c.workItem.id && (
                        <ReasonForm label="Mover vínculo" busy={busy} testId="link-move" onCancel={() => setAsking(null)} onConfirm={(reason) => void run(() => actions.link(task.key, c.workItem.id, { linkId: c.link.linkId, expectedVersion: c.link.version }, reason))} />
                      )}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </section>
        </div>
      </td>
    </tr>
  );
}
