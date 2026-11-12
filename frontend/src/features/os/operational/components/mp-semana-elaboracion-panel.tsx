"use client";

import { useMemo, useState } from "react";
import { addDaysIso, parseIsoDate, todayInBuenosAires, weekStartMonday, workWeekDays } from "@/lib/operational/operational-calendar";
import type { WeeklyPlanItemDto } from "@/lib/planning/weekly-plan-dto";
import { useSharedWeeklyPlan } from "../hooks/use-shared-weekly-plan";
import { planItemToWorkItem } from "../lib/plan-dto-to-work-item";
import { ElaboracionReadOnlyDetail } from "./elaboracion-readonly-detail";
import { OperationalWeekBoard } from "./operational-week-board";

/**
 * Materias Primas → «Semana de Elaboración»: la MISMA planificación semanal que ve Elaboración (mismo tablero, mismas tarjetas, mismos
 * trabajos), de SOLO LECTURA. Los datos salen del plan compartido de piso (`/api/v1/weekly-plans`, RBAC en el servidor, solo GET)
 * y se refrescan solos: lo que Elaboración avanza, entrega, corrige o cancela y lo que Producción reprograma se ve acá sin duplicar nada.
 */
export function MpSemanaElaboracionPanel() {
  const today = useMemo(() => todayInBuenosAires(), []);
  const [anchor, setAnchor] = useState(today);
  const weekStart = useMemo(() => weekStartMonday(anchor), [anchor]);
  const weekDays = useMemo(() => workWeekDays(weekStart), [weekStart]);
  const [detailId, setDetailId] = useState<string | null>(null);

  const { items, loading, error, updatedAgoLabel, refresh } = useSharedWeeklyPlan({ weekStart, planSector: "ELABORACION" });
  const workItems = useMemo(() => items.map(planItemToWorkItem), [items]);
  const dtoById = useMemo(() => new Map<string, WeeklyPlanItemDto>(items.map((i) => [i.workItemId, i])), [items]);
  const detail = detailId ? (dtoById.get(detailId) ?? null) : null;

  const s = parseIsoDate(weekStart);
  const e = parseIsoDate(weekDays[weekDays.length - 1] ?? weekStart);
  const isCurrent = weekStart === weekStartMonday(today);

  return (
    <div className="space-y-4" data-testid="mp-semana-elaboracion" data-week-start={weekStart}>
      <div className="rounded border border-[var(--os-border)] bg-[var(--os-surface)]/40 px-3 py-2 text-sm text-[var(--os-text)]">
        Planificación semanal de Elaboración — <strong>solo lectura</strong>: no podés crear, editar, reprogramar ni registrar elaboración o entregas.
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="min-h-10 rounded border border-[var(--os-border)] px-3 text-sm" onClick={() => setAnchor(addDaysIso(weekStart, -7))} data-testid="mp-sem-prev">Semana anterior</button>
        <button type="button" className={`min-h-10 rounded border px-3 text-sm ${isCurrent ? "border-[var(--os-teal)] text-[var(--os-teal)]" : "border-[var(--os-border)]"}`} onClick={() => setAnchor(today)} data-testid="mp-sem-today">Semana actual</button>
        <button type="button" className="min-h-10 rounded border border-[var(--os-border)] px-3 text-sm" onClick={() => setAnchor(addDaysIso(weekStart, 7))} data-testid="mp-sem-next">Semana siguiente</button>
        <p className="px-1 text-base font-semibold" data-testid="mp-sem-range">
          {s?.day}/{s?.month} – {e?.day}/{e?.month}
          <span className="ml-2 text-sm font-normal text-[var(--os-text-muted)]" data-testid="mp-sem-count">{loading ? "Cargando…" : `${items.length} trabajo${items.length === 1 ? "" : "s"}`}</span>
        </p>
        <button type="button" className="ml-auto min-h-10 rounded border border-[var(--os-border)] px-3 text-sm" onClick={() => refresh()} data-testid="mp-sem-refresh">Actualizar</button>
        <span className="text-xs text-[var(--os-text-muted)]">Actualizado {updatedAgoLabel}</span>
      </div>

      {error ? (
        <div role="alert" className="rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-[var(--os-text)]">
          No pudimos actualizar el plan{items.length > 0 ? " — se conserva la última vista correcta." : "."}
        </div>
      ) : null}

      {loading && items.length === 0 ? <div className="os-skeleton h-40 rounded-[var(--os-radius)]" /> : (
        <OperationalWeekBoard
          weekDays={weekDays}
          today={today}
          selectedDate={today}
          items={workItems}
          onSelectDay={() => undefined}
          cards={{
            variant: "elaboracion",
            listMode: "active",
            readOnly: true,
            getFinishedQty: (id) => workItems.find((w) => w.id === id)?.finishedQty ?? "",
            getObservation: () => "",
            elaboracionFigures: (id) => dtoById.get(id)?.elaboracion ?? null,
            onSelectItem: (item) => setDetailId(item.id),
          }}
          hideHeader
          draggable={false}
          dropZoneId="mp-elaboracion"
          canCreate={false}
        />
      )}

      <ElaboracionReadOnlyDetail job={detail} onClose={() => setDetailId(null)} />
    </div>
  );
}
