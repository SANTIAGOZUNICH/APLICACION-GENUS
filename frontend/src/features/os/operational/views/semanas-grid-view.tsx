"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  GenusGrid,
  type GenusGridCellChange,
  type GenusGridColumn,
  type GenusGridCommitResult,
} from "@/components/data-grid/genus-grid";
import { SemanasTaskList } from "@/features/os/operational/components/semanas-task-list";
import { SemanasTvMode } from "@/features/os/operational/components/semanas-tv-mode";
import type { CalendarCommitChange, CalendarCommitResult } from "@/features/os/operational/components/semanas-calendar-engine";
import { canEditPriorities } from "@/lib/semanas-sheet/priorities-permissions";
import type { Priority } from "@/lib/semanas-sheet/priorities";
import { PLAN_SECTORS } from "@/lib/semanas-sheet/plan-tasks";
import type { LinkActions } from "@/features/os/operational/components/semanas-link-panel";
import { AssignWorkDialog } from "@/features/os/operational/components/assign-work-dialog";
import type { PlanTask } from "@/lib/semanas-sheet/plan-tasks";
import { usePreviewSession } from "@/features/os/session/preview-context";
import { TwinShell } from "@/features/os/shell/twin-shell";
import { useRequiredWorkspace } from "@/features/os/workspace/workspace-provider";
import { deleteTaskLink, fetchLinkCandidates, postTaskLink, patchTaskPriority, fetchPriorityHistory, fetchPreviewSource, fetchSemanasView, patchSemanasCells, resetPreviewSource, uploadPreviewSource, type PreviewSourceStatus, type SemanasViewResponse } from "@/lib/semanas-sheet/semanas-client";
import { SEMANAS_TABS, type SemanasTabKey } from "@/lib/semanas-sheet/semanas-tabs";
import type { CalendarRow } from "@/lib/semanas-sheet/calendar-model";
import type { FlatRow } from "@/lib/semanas-sheet/flat-model";

const TAB_ORDER: SemanasTabKey[] = ["ELABORACION", "ACONDICIONAMIENTO", "CDIA", "ENTREGAS"];
const DAY_LABELS = ["Lun", "Mar", "Mié", "Jue", "Vie"];

/** Fila genérica de la grilla: la fila de la Sheet + sus celdas (valor, A1, protección). */
interface SheetGridRow {
  id: string;
  rowNumber: number;
  structural: boolean;
  /** Fecha ISO de la celda/fila (para exigir motivo en ediciones históricas). */
  date: string | null;
  cells: Array<{ a1: string; value: string; protection: string | null; date?: string | null }>;
}

function toRows(view: SemanasViewResponse, weekId: string | null): SheetGridRow[] {
  if (view.kind === "CALENDAR") {
    const week = view.weeks?.find((w) => w.id === weekId) ?? view.weeks?.[0];
    return (week?.rows ?? []).map((r: CalendarRow) => ({
      id: `${view.tab}!${r.rowNumber}`,
      rowNumber: r.rowNumber,
      structural: r.role === "structural",
      date: null,
      cells: r.cells.map((c) => ({ a1: c.a1, value: c.value, protection: c.protection, date: c.date })),
    }));
  }
  return (view.table?.rows ?? []).map((r: FlatRow) => ({
    id: `${view.tab}!${r.rowNumber}`,
    rowNumber: r.rowNumber,
    structural: r.role === "structural",
    date: r.date,
    cells: r.cells.map((c) => ({ a1: c.a1, value: c.value, protection: c.protection, date: r.date })),
  }));
}

/** Producción → Semanas: planilla editable fiel a SEMANAS 2026 (la Sheet es la fuente de verdad). */
export function SemanasGridView() {
  const workspace = useRequiredWorkspace();
  const { email, sectorId } = usePreviewSession();
  const session = useMemo(
    () => ({ email: email ?? workspace.context.email, sector: sectorId ?? workspace.context.sectorId }),
    [email, sectorId, workspace.context.email, workspace.context.sectorId]
  );
  const [tab, setTab] = useState<SemanasTabKey>("ELABORACION");
  const [view, setView] = useState<SemanasViewResponse | null>(null);
  const [weekId, setWeekId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // null = automático: en la copia de Preview se muestran todas las semanas (para revisar el diseño completo).
  const [showFoldedChoice, setShowFolded] = useState<boolean | null>(null);
  const [previewInfo, setPreviewInfo] = useState<PreviewSourceStatus | null>(null);
  const [previewMsg, setPreviewMsg] = useState<string | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);

  const load = useCallback(
    async (key: SemanasTabKey, keepWeek = false) => {
      setLoading(true);
      setError(null);
      try {
        const v = await fetchSemanasView(session, key);
        setView(v);
        if (v.kind === "CALENDAR" && !keepWeek) {
          // Semana en curso (la primera cuyo viernes ≥ hoy) o la última.
          const today = v.today ?? new Date().toISOString().slice(0, 10);
          // Semanas plegadas en la Sheet original no cuentan como «actual» (no se muestran por defecto).
          const shown = (v.weeks ?? []).filter((w) => !w.hidden);
          const pool = shown.length > 0 ? shown : (v.weeks ?? []);
          const current = pool.find((w) => (w.dates[4] ?? "") >= today) ?? pool[pool.length - 1];
          setWeekId(current?.id ?? null);
        }
      } catch (e) {
        setView(null);
        setError(e instanceof Error ? e.message : "No se pudo leer la planilla.");
      } finally {
        setLoading(false);
      }
    },
    [session]
  );

  useEffect(() => {
    // Carga inicial/cambio de pestaña (mismo patrón que el resto de las vistas operativas).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(tab);
  }, [load, tab]);

  const isPreviewSource = view?.source === "PREVIEW_XLSX";
  useEffect(() => {
    if (!isPreviewSource) return;
    void fetchPreviewSource(session)
      .then((r) => setPreviewInfo(r.status ?? null))
      .catch(() => setPreviewInfo(null));
  }, [isPreviewSource, session]);

  const runPreviewAction = async (action: () => Promise<{ status?: PreviewSourceStatus; persisted?: boolean }>, okMsg: string) => {
    setPreviewBusy(true);
    setPreviewMsg(null);
    try {
      const r = await action();
      setPreviewInfo(r.status ?? null);
      setPreviewMsg(r.persisted === false ? `${okMsg} (queda solo en memoria de esta instancia: no hay almacenamiento privado configurado).` : okMsg);
      await load(tab);
    } catch (e) {
      setPreviewMsg(e instanceof Error ? e.message : "No se pudo cargar el archivo.");
    } finally {
      setPreviewBusy(false);
    }
  };

  const rows = useMemo(() => (view ? toRows(view, weekId) : []), [view, weekId]);
  const week = view?.kind === "CALENDAR" ? (view.weeks?.find((w) => w.id === weekId) ?? view.weeks?.[0]) : undefined;

  const columns = useMemo<GenusGridColumn<SheetGridRow>[]>(() => {
    if (!view) return [];
    const validate = (raw: string) => (raw.trim().startsWith("=") ? "No se permiten fórmulas." : raw.length > 300 ? "Máximo 300 caracteres." : null);
    const rowCol: GenusGridColumn<SheetGridRow> = {
      key: "__row",
      title: "Fila",
      basis: 64,
      minWidth: 56,
      getValue: (r) => String(r.rowNumber),
      protection: () => "Número de fila de la Sheet.",
    };
    if (view.kind === "CALENDAR") {
      return [
        rowCol,
        ...DAY_LABELS.map((label, i) => ({
          key: `c${i}`,
          title: `${label} ${week?.dates[i] ? `${week.dates[i]!.slice(8)}/${week.dates[i]!.slice(5, 7)}` : ""}`.trim(),
          basis: 190,
          getValue: (r: SheetGridRow) => r.cells[i]?.value ?? "",
          protection: (r: SheetGridRow) => r.cells[i]?.protection ?? null,
          validate,
        })),
      ];
    }
    return [
      rowCol,
      ...(view.table?.columns ?? []).map((c, i) => ({
        key: `c${i}`,
        title: c.title,
        basis: c.title.toLowerCase() === "producto" ? 260 : 150,
        getValue: (r: SheetGridRow) => r.cells[i]?.value ?? "",
        protection: (r: SheetGridRow) => r.cells[i]?.protection ?? null,
        validate,
      })),
    ];
  }, [view, week]);

  const onCommit = useCallback(
    async (changes: GenusGridCellChange[]): Promise<GenusGridCommitResult> => {
      if (!view) return { ok: false, message: "Sin datos." };
      const byId = new Map(rows.map((r) => [r.id, r] as const));
      const edits = changes.map((c) => {
        const idx = Number(c.columnKey.slice(1));
        const a1 = byId.get(c.rowId)?.cells[idx]?.a1 ?? "";
        return { tabKey: view.tabKey, a1, expectedValue: c.oldValue, value: c.newValue, reason: c.reason };
      });
      const res = await patchSemanasCells(session, edits);
      const failures = res.results.flatMap((r, i) =>
        r.ok ? [] : [{ rowId: changes[i]!.rowId, columnKey: changes[i]!.columnKey, message: r.message ?? "No se guardó." }]
      );
      // Siempre se relee la Sheet: lo mostrado es lo que Google confirma (nunca un valor optimista).
      await load(view.tabKey, true);
      if (res.ok && failures.length === 0) return { ok: true };
      return { ok: false, message: res.error ?? failures[0]?.message, failures };
    },
    [view, rows, session, load]
  );

  const onCalendarCommit = useCallback(
    async (changes: CalendarCommitChange[]): Promise<CalendarCommitResult> => {
      if (!view) return { ok: false, failures: [], message: "Sin datos." };
      const res = await patchSemanasCells(
        session,
        changes.map((c) => ({ tabKey: view.tabKey, a1: c.a1, expectedValue: c.oldValue, value: c.newValue, reason: c.reason }))
      );
      const failures = res.results.flatMap((r, i) => (r.ok ? [] : [{ a1: changes[i]!.a1, message: r.message ?? "No se guardó." }]));
      // Siempre se relee la Sheet: lo mostrado es lo que Google confirma.
      await load(view.tabKey, true);
      return { ok: res.ok && failures.length === 0, message: res.error, failures };
    },
    [view, session, load]
  );

  const [tvOpen, setTvOpen] = useState(false);
  const openTv = () => {
    setTvOpen(true);
    // Pantalla completa del navegador (si el navegador lo permite); el Modo TV funciona igual sin ella.
    void document.documentElement.requestFullscreen?.().catch(() => undefined);
  };
  const closeTv = useCallback(() => {
    setTvOpen(false);
    if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => undefined);
  }, []);

  const priorityLock = !canEditPriorities(session.sector as never)
    ? "Solo Producción puede cambiar prioridades."
    : view?.priorities && !view.priorities.available
      ? "Las prioridades no están habilitadas en esta base (migración 0041 pendiente)."
      : null;
  const onPriorityChange = useCallback(
    async (taskKey: string, next: Priority) => {
      if (!view) return;
      const cur = view.priorities?.byTask[taskKey];
      setError(null);
      try {
        const stored = await patchTaskPriority(session, { tabKey: view.tabKey, taskKey, priority: next, expectedVersion: cur?.version ?? 0 });
        // Se refleja lo que la base confirmó (no un valor optimista).
        setView((v) => (v ? { ...v, priorities: { available: true, byTask: { ...(v.priorities?.byTask ?? {}), [taskKey]: stored } } } : v));
      } catch (e) {
        setError(e instanceof Error ? e.message : "No se pudo guardar la prioridad.");
        await load(view.tabKey, true); // trae la prioridad vigente (p. ej. si otro usuario la cambió)
      }
    },
    [view, session, load]
  );

  const showFolded = showFoldedChoice ?? view?.source === "PREVIEW_XLSX";
  const calendarWeeks = useMemo(() => (view?.weeks ?? []).filter((w) => showFolded || !w.hidden), [view, showFolded]);
  const foldedCount = (view?.weeks ?? []).filter((w) => w.hidden).length;
  const isCalendar = view?.kind === "CALENDAR";
  const listWeek = isCalendar ? (calendarWeeks.find((w) => w.id === weekId) ?? calendarWeeks[calendarWeeks.length - 1]) : undefined;
  const loadHistory = useCallback((taskKey: string) => (view ? fetchPriorityHistory(session, view.tabKey, taskKey) : Promise.resolve({ events: [], linkEvents: [] })), [view, session]);
  // Vínculos tarea ↔ trabajo operativo: cada cambio se relee del servidor (nunca un estado optimista).
  const viewTabKey = view?.tabKey;
  const canLink = Boolean(view?.canLink);
  const [createFor, setCreateFor] = useState<PlanTask | null>(null);
  const linkActions = useMemo<LinkActions | undefined>(() => {
    if (!viewTabKey) return undefined;
    return {
      canLink,
      loadCandidates: (taskKey) => fetchLinkCandidates(session, viewTabKey, taskKey),
      link: async (taskKey, workItemId, replace, reason) => {
        await postTaskLink(session, { tabKey: viewTabKey, taskKey, workItemId, replace, reason });
        await load(viewTabKey, true);
      },
      unlink: async (linkId, expectedVersion, reason) => {
        await deleteTaskLink(session, { linkId, expectedVersion, reason });
        await load(viewTabKey, true);
      },
      createFromTask: (task) => setCreateFor(task),
    };
  }, [viewTabKey, canLink, session, load]);

  const canEdit = Boolean(view?.canEdit);
  // Trazabilidad: editar una fecha anterior a hoy exige motivo (el servidor lo vuelve a exigir).
  const reasonRequired = useCallback(
    (changes: GenusGridCellChange[]) => {
      if (!view) return null;
      const byId = new Map(rows.map((r) => [r.id, r] as const));
      const historic = changes.some((c) => {
        const cell = byId.get(c.rowId)?.cells[Number(c.columnKey.slice(1))];
        return Boolean(cell?.date && cell.date < view.reasonRequiredBefore!);
      });
      if (!historic) return null;
      return view.tabKey === "CDIA"
        ? "Estás editando un registro histórico. Puede alterar los indicadores del dashboard DB: indicá el motivo."
        : "Estás editando una fecha anterior a hoy. Indicá el motivo (queda auditado).";
    },
    [view, rows]
  );

  return (
    <TwinShell title="Semanas">
      <div className="space-y-4">
        <header className="space-y-1">
          <h2 className="text-2xl font-semibold tracking-tight">Semanas 2026</h2>
          <p className="text-sm text-[var(--os-text-muted)]">
            Planificación semanal de Producción. Cada línea es una celda de SEMANAS 2026: editá en el lugar y se guarda solo esa celda. La prioridad es un dato de GENUS y no se escribe en la planilla.
          </p>
        </header>

        <div className="flex flex-wrap items-center gap-2" role="tablist">
          {TAB_ORDER.map((key) => (
            <Button
              key={key}
              type="button"
              variant={tab === key ? "primary" : "secondary"}
              onClick={() => setTab(key)}
              data-testid={`semanas-tab-${key}`}
            >
              {SEMANAS_TABS[key].label}
            </Button>
          ))}
          <Button type="button" variant="secondary" onClick={() => void load(tab, true)} disabled={loading} data-testid="semanas-reload">
            <RefreshCw className="size-4" aria-hidden="true" />
            Recargar
          </Button>
          {isCalendar && (
            <select
              value={listWeek?.id ?? ""}
              onChange={(e) => setWeekId(e.target.value)}
              className="rounded-[var(--os-radius-sm)] border border-[var(--os-border)] bg-[var(--os-surface)] px-3 py-2 text-sm"
              data-testid="semanas-week"
              aria-label="Semana"
            >
              {calendarWeeks.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.label}
                </option>
              ))}
            </select>
          )}
          {isCalendar && foldedCount > 0 && (
            <label className="flex items-center gap-1 text-xs text-[var(--os-text-muted)]">
              <input type="checkbox" checked={showFolded} onChange={(e) => setShowFolded(e.target.checked)} data-testid="semanas-show-folded" />
              Semanas plegadas en la Sheet ({foldedCount})
            </label>
          )}
          <Button type="button" variant="secondary" onClick={openTv} data-testid="semanas-tv-open" className="ml-auto">
            📺 Modo TV
          </Button>
        </div>

        {isPreviewSource && (
          <div className="space-y-2 rounded-[var(--os-radius-sm)] border border-[var(--genus-warning)]/40 bg-[var(--genus-warning-soft)] px-3 py-2 text-sm" data-testid="semanas-preview-banner">
            <p>
              <b>Vista de prueba (Preview).</b> Datos de una <b>copia XLSX</b> de SEMANAS 2026, solo lectura: no se lee ni se escribe la planilla original de Google ni la base.
              {previewInfo && (
                <>
                  {" "}Origen: {previewInfo.origin === "BUNDLED" ? "copia incluida en el deploy" : "archivo cargado"} · {previewInfo.weeks.ELABORACION ?? 0} semanas en ELABORACION, {previewInfo.weeks.ACONDICIONAMIENTO ?? 0} en ACONDICIONAMIENTO · sha {previewInfo.sha256.slice(0, 8)}.
                </>
              )}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded border border-[var(--os-border)] bg-[var(--os-surface)] px-3 py-1.5">
                <span>Cargar otro .xlsx de SEMANAS 2026</span>
                <input
                  type="file"
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  className="sr-only"
                  disabled={previewBusy}
                  data-testid="semanas-preview-upload"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) void runPreviewAction(() => uploadPreviewSource(session, f), `Se cargó «${f.name}».`);
                  }}
                />
              </label>
              {previewInfo && previewInfo.origin !== "BUNDLED" && (
                <Button type="button" variant="secondary" disabled={previewBusy} onClick={() => void runPreviewAction(() => resetPreviewSource(session), "Se restauró la copia incluida.")} data-testid="semanas-preview-reset">
                  Volver a la copia incluida
                </Button>
              )}
              {previewBusy && <span>Validando y cargando…</span>}
            </div>
            {previewMsg && <p role="status" data-testid="semanas-preview-msg">{previewMsg}</p>}
          </div>
        )}
        {view && !view.canEdit && !isPreviewSource && (
          <p className="rounded-[var(--os-radius-sm)] border border-[var(--os-border)] bg-[var(--os-surface)] px-3 py-2 text-sm text-[var(--os-text-muted)]" data-testid="semanas-readonly">
            Solo lectura: la escritura a esta planilla no está habilitada desde GENUS (solo copias de prueba autorizadas).
          </p>
        )}
        {view && view.locksKnown === false && (view.tabKey === "ENTREGAS" || view.tabKey === "CDIA") && (
          <p className="rounded-[var(--os-radius-sm)] border border-[var(--genus-error)]/40 bg-[var(--genus-error-soft)] px-3 py-2 text-sm text-[var(--genus-error)]" role="alert" data-testid="semanas-locks-unknown">
            No se pudo verificar el estado operativo (entregas / cierres) en GENUS: esta pestaña queda en solo lectura por seguridad.
          </p>
        )}
        {error && (
          <p className="rounded-[var(--os-radius-sm)] border border-[var(--genus-error)]/40 bg-[var(--genus-error-soft)] px-3 py-2 text-sm text-[var(--genus-error)]" role="alert">
            {error}
          </p>
        )}

        {view?.links && view.links.orphans.length > 0 && (
          <div className="rounded-[var(--os-radius-sm)] border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-sm text-amber-100" role="status" data-testid="semanas-link-orphans">
            <b>{view.links.orphans.length} vínculo(s) sin tarea:</b> la tarea ya no está en la planilla, así que esos trabajos no muestran prioridad en «Mi trabajo». Revisalos:
            <ul className="mt-1 list-disc pl-5">
              {view.links.orphans.slice(0, 8).map((o) => (
                <li key={o.linkId}>
                  {o.workItem ? `${o.workItem.product} · ${o.workItem.quantity} ${o.workItem.unit}` : "Trabajo inexistente"} — antes vinculado a «{o.summary}»{" "}
                  <button
                    type="button"
                    className="ml-1 underline underline-offset-2"
                    onClick={() => {
                      const reason = window.prompt("Motivo para quitar el vínculo (mín. 8 caracteres):") ?? "";
                      if (reason.trim().length >= 8) void linkActions?.unlink(o.linkId, o.version, reason.trim()).catch((e) => setError(e instanceof Error ? e.message : "No se pudo quitar."));
                    }}
                  >
                    Quitar vínculo
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {view && isCalendar && listWeek && (view.tabKey === "ELABORACION" || view.tabKey === "ACONDICIONAMIENTO") && (
          <SemanasTaskList
            key={`${view.tabKey}:${listWeek.id}`}
            tabKey={view.tabKey}
            tab={view.tab}
            week={listWeek}
            today={view.today ?? new Date().toISOString().slice(0, 10)}
            canEdit={canEdit}
            reasonRequiredBefore={view.reasonRequiredBefore ?? ""}
            priorities={view.priorities}
            priorityLock={priorityLock}
            onPriorityChange={onPriorityChange}
            onCommit={onCalendarCommit}
            loadHistory={loadHistory}
            links={view.links}
            linkActions={linkActions}
            footnote={`Leído de ${view.source === "PREVIEW_XLSX" ? "la copia XLSX de Preview" : view.source === "LOCAL_FIXTURE" ? "la copia local" : "Google"}: ${new Date(view.readAt).toLocaleTimeString("es-AR")}.${canEdit ? " Las fechas anteriores a hoy se corrigen con motivo; encabezados, fórmulas y registros cerrados son de solo lectura." : ""}`}
          />
        )}
        {createFor && createFor.sector && view && (
          <AssignWorkDialog
            sector={createFor.sector}
            initialPlannedDate={createFor.date ?? undefined}
            initialValues={{
              client: createFor.client ?? "",
              product: createFor.products[0] ?? "",
              // Solo una cantidad explícita de la planilla (renglón propio); si está dentro del texto, se completa a mano.
              quantity: (createFor.quantities[0]?.match(/\d+(?:[.,]\d+)?/)?.[0] ?? "").replace(",", "."),
              ownerPerson: createFor.assignee?.kind === "RESPONSABLE" ? createFor.assignee.value : undefined,
              notes: createFor.notes.join(" · "),
            }}
            semanasTask={{ tabKey: createFor.tabKey, taskKey: createFor.key, summary: createFor.lines.map((l) => l.value).join(" / ") }}
            onClose={() => setCreateFor(null)}
            onAssigned={() => void load(view.tabKey, true)}
          />
        )}
        {tvOpen && <SemanasTvMode session={session} sectors={[...PLAN_SECTORS]} initialSector={view?.tabKey === "ACONDICIONAMIENTO" ? "ENVASADO_MASIVO" : "ELABORACION"} onExit={closeTv} />}
        {view && !isCalendar && rows.length > 0 && (
          <GenusGrid<SheetGridRow>
            key={`${view.tabKey}:${weekId ?? ""}`}
            rows={rows}
            rowId={(r) => r.id}
            rowVersion={(r) => r.cells.map((c) => c.value).join("\u0001")}
            rowLabel={(r) => `Fila ${r.rowNumber}`}
            columns={columns}
            onCommit={onCommit}
            canEdit={canEdit}
            reasonRequired={reasonRequired}
            onReload={() => void load(tab, true)}
            maxHeight={640}
            testId="semanas-grid"
            hint={
              <>
                Son de solo lectura los encabezados de día, las celdas combinadas no ancladas, las fórmulas y los registros cerrados en GENUS (entregas confirmadas / remitos / envasado cerrado). Las fechas anteriores a hoy se pueden corregir con motivo. No se crean ni eliminan filas
                desde acá. Leído de Google: {new Date(view.readAt).toLocaleTimeString("es-AR")}.
              </>
            }
          />
        )}
        {view && rows.length === 0 && !loading && <p className="text-sm text-[var(--os-text-muted)]">Sin datos en esta pestaña.</p>}
      </div>
    </TwinShell>
  );
}
