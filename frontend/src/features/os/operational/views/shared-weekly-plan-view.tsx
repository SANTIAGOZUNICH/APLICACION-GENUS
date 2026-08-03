"use client";

import { useMemo, useState } from "react";
import { TwinShell } from "@/features/os/shell/twin-shell";
import {
  addDaysIso,
  parseIsoDate,
  weekStartMonday,
  workWeekDays,
  todayInBuenosAires,
} from "@/lib/operational/operational-calendar";
import { useSharedWeeklyPlan, type PlanSectorFilter } from "../hooks/use-shared-weekly-plan";
import { OperationalWeekBoard } from "../components/operational-week-board";

type ViewerKind = "codificado" | "deposito" | "materia_prima";

interface SharedWeeklyPlanViewProps {
  viewer: ViewerKind;
}

const FILTERS: { id: PlanSectorFilter; label: string }[] = [
  { id: "ALL", label: "Todos" },
  { id: "ENVASADO_MASIVO", label: "Envasado Masivo" },
  { id: "ENVASADO_PREMIUM", label: "Envasado Premium" },
];

/**
 * Plan semanal compartido — solo lectura.
 * Siempre montado dentro de TwinShell (sidebar + header + Creamy).
 */
export function SharedWeeklyPlanView({ viewer }: SharedWeeklyPlanViewProps) {
  const today = useMemo(() => todayInBuenosAires(), []);
  const [weekAnchor, setWeekAnchor] = useState(today);
  const weekStart = useMemo(() => weekStartMonday(weekAnchor), [weekAnchor]);
  const weekDays = useMemo(() => workWeekDays(weekStart), [weekStart]);
  const [selectedDate, setSelectedDate] = useState(today);
  const [planSector, setPlanSector] = useState<PlanSectorFilter>(
    viewer === "materia_prima" ? "ELABORACION" : "ALL"
  );

  const { items, uniqueCount, loading, error, updatedAgoLabel, refresh } = useSharedWeeklyPlan({
    weekStart,
    planSector: viewer === "materia_prima" ? "ELABORACION" : planSector,
  });

  const startParts = parseIsoDate(weekStart);
  const endParts = parseIsoDate(weekDays[weekDays.length - 1] ?? weekStart);

  const subtitle =
    viewer === "materia_prima"
      ? "Elaboración — solo lectura"
      : "Envasado Masivo y Premium — solo lectura";

  return (
    <TwinShell title="Plan semanal">
      <div
        data-genus-shared-weekly-plan={viewer}
        className="os-page-pad mx-auto min-h-full w-full max-w-[var(--os-content-max,1200px)] space-y-4 overflow-x-hidden bg-transparent"
      >
        <div className="rounded border border-[var(--os-border)] bg-[var(--os-surface)]/40 px-3 py-2 text-sm text-[var(--os-text)]">
          Plan semanal — Solo lectura: no podés crear, editar, eliminar, finalizar ni aprobar trabajos.
          <span className="mt-1 block text-xs text-[var(--os-text-muted)]">{subtitle}</span>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="min-h-10 rounded border border-[var(--os-border)] px-3 text-sm text-[var(--os-text)]"
              onClick={() => setWeekAnchor((d) => addDaysIso(weekStartMonday(d), -7))}
            >
              Semana anterior
            </button>
            <button
              type="button"
              className="min-h-10 rounded border border-[var(--os-border)] px-3 text-sm text-[var(--os-text)]"
              onClick={() => {
                setWeekAnchor(today);
                setSelectedDate(today);
              }}
            >
              Esta semana
            </button>
            <button
              type="button"
              className="min-h-10 rounded border border-[var(--os-border)] px-3 text-sm text-[var(--os-text)]"
              onClick={() => setWeekAnchor((d) => addDaysIso(weekStartMonday(d), 7))}
            >
              Semana siguiente
            </button>
            <p className="text-sm text-[var(--os-text-muted)]">
              {startParts?.day}/{startParts?.month} – {endParts?.day}/{endParts?.month}
              {loading ? " · Cargando…" : ` · ${uniqueCount} trabajos`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="min-h-10 rounded bg-[var(--os-teal)] px-3 text-sm font-medium text-[var(--os-navy)]"
              onClick={() => refresh()}
            >
              Actualizar
            </button>
            <span className="text-xs text-[var(--os-text-muted)]">Actualizado {updatedAgoLabel}</span>
          </div>
        </div>

        {viewer !== "materia_prima" && (
          <div className="flex flex-wrap gap-2">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                className={`min-h-10 rounded px-3 text-sm ${
                  planSector === f.id
                    ? "bg-[var(--os-teal)] text-[var(--os-navy)]"
                    : "border border-[var(--os-border)] text-[var(--os-text)]"
                }`}
                onClick={() => setPlanSector(f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-[var(--os-text)]"
          >
            No pudimos actualizar el plan
            {items.length > 0 ? " — se conserva la última vista correcta." : "."}
          </div>
        )}

        <OperationalWeekBoard
          mode="consulta"
          weekDays={weekDays}
          today={today}
          selectedDate={selectedDate}
          items={[]}
          consultaItems={items}
          onSelectDay={setSelectedDate}
        />
      </div>
    </TwinShell>
  );
}

export function SharedWeeklyPlanViewForCodificado() {
  return <SharedWeeklyPlanView viewer="codificado" />;
}

export function SharedWeeklyPlanViewForDeposito() {
  return <SharedWeeklyPlanView viewer="deposito" />;
}

export function SharedWeeklyPlanViewForMateriaPrima() {
  return <SharedWeeklyPlanView viewer="materia_prima" />;
}
