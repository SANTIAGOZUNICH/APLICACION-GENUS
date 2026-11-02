"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { TwinShell } from "@/features/os/shell/twin-shell";
import { usePreviewSession } from "@/features/os/session/preview-context";
import { addMonths, monthLabel, monthStartOf } from "@/lib/operational/month-grid";
import { todayInBuenosAires, weekStartMonday } from "@/lib/operational/operational-calendar";
import { OperationalMonthBoard } from "../components/operational-month-board";
import { MonthlyJobCard } from "../components/monthly-job-card";
import { useSharedWeeklyPlan } from "../hooks/use-shared-weekly-plan";

type FloorSector = "ENVASADO_PREMIUM" | "ENVASADO_MASIVO" | "ELABORACION";
const TABS: ReadonlyArray<{ id: FloorSector; label: string }> = [
  { id: "ENVASADO_PREMIUM", label: "Envasado Premium" },
  { id: "ENVASADO_MASIVO", label: "Envasado Masivo" },
  { id: "ELABORACION", label: "Elaboración" },
];

/**
 * Vista mensual compartida: el MISMO calendario mensual de la planificación (OperationalMonthBoard) para todos los sectores,
 * eligiendo qué sector ver (Premium | Masivo | Elaboración). Es SOLO LECTURA: consultar no da permiso de asignar ni editar
 * (las ediciones siguen en las vistas de cada sector, con sus permisos). Los datos salen de la planificación real
 * (`/api/v1/weekly-plans`, RBAC en el servidor) y se actualizan solos cuando Producción asigna, mueve, cambia o cancela.
 */
export function VistaMensualView() {
  const { sectorId } = usePreviewSession();
  const today = useMemo(() => todayInBuenosAires(), []);
  // Arranca en el sector propio si es uno de los tres; si no, en Envasado Premium.
  const [tab, setTab] = useState<FloorSector>(() => (TABS.some((t) => t.id === sectorId) ? (sectorId as FloorSector) : "ENVASADO_PREMIUM"));
  const [monthAnchor, setMonthAnchor] = useState(monthStartOf(today));

  const { items, uniqueCount, loading, error, updatedAgoLabel, refresh } = useSharedWeeklyPlan({
    weekStart: weekStartMonday(monthAnchor),
    planSector: tab,
    monthStart: monthAnchor,
  });
  const monthItems = useMemo(
    () => items.map((i) => ({ id: i.workItemId, product: i.product, client: i.client, quantity: i.quantity, unit: i.unit, plannedDate: i.plannedDate, plannedDateTo: i.plannedDateTo })),
    [items]
  );

  const byId = useMemo(() => new Map(items.map((i) => [i.workItemId, i])), [items]);

  return (
    <TwinShell title="Vista mensual">
      <div className="mx-auto w-full max-w-[var(--os-content-max,1200px)] space-y-4 overflow-x-hidden" data-testid="vista-mensual" data-tab={tab} data-month={monthAnchor}>
        <header>
          <h2 className="text-2xl font-semibold tracking-tight">Vista mensual</h2>
          <p className="text-sm text-[var(--os-text-muted)]">Planificación del mes por sector · solo consulta · tocá un trabajo para ver su detalle</p>
        </header>

        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Sector">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              data-testid={`vm-tab-${t.id}`}
              className={`min-h-10 rounded px-3 text-sm ${tab === t.id ? "bg-[var(--os-teal)] font-medium text-[var(--os-navy)]" : "border border-[var(--os-border)] text-[var(--os-text)]"}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="inline-flex min-h-10 items-center gap-1 rounded border border-[var(--os-border)] px-3 text-sm" onClick={() => setMonthAnchor((m) => addMonths(m, -1))} aria-label="Mes anterior" data-testid="vm-prev">
            <ChevronLeft className="size-4" aria-hidden="true" /> Mes anterior
          </button>
          <button type="button" className="min-h-10 rounded border border-[var(--os-border)] px-3 text-sm" onClick={() => setMonthAnchor(monthStartOf(today))} data-testid="vm-today">Mes actual</button>
          <button type="button" className="inline-flex min-h-10 items-center gap-1 rounded border border-[var(--os-border)] px-3 text-sm" onClick={() => setMonthAnchor((m) => addMonths(m, 1))} aria-label="Mes siguiente" data-testid="vm-next">
            Mes siguiente <ChevronRight className="size-4" aria-hidden="true" />
          </button>
          <h3 className="px-1 text-lg font-semibold capitalize" data-testid="vm-title">{monthLabel(monthAnchor)}</h3>
          <span className="text-sm text-[var(--os-text-muted)]" data-testid="vm-count">{loading ? "Cargando…" : `${uniqueCount} trabajo${uniqueCount === 1 ? "" : "s"}`}</span>
          <button type="button" className="ml-auto inline-flex min-h-10 items-center gap-1 rounded border border-[var(--os-border)] px-3 text-sm" onClick={() => refresh()} data-testid="vm-refresh">
            <RefreshCw className="size-4" aria-hidden="true" /> Actualizar
          </button>
          <span className="text-xs text-[var(--os-text-muted)]">Actualizado {updatedAgoLabel}</span>
        </div>

        {error ? (
          <div role="alert" className="rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-[var(--os-text)]">
            No pudimos actualizar el plan{items.length > 0 ? " — se conserva la última vista correcta." : "."}
          </div>
        ) : null}

        <OperationalMonthBoard monthStart={monthAnchor} today={today} items={monthItems} allItems={[]} canEdit={false} showUndated={false} onSelectItem={() => undefined} renderDetail={(it) => (byId.get(it.id) ? <MonthlyJobCard job={byId.get(it.id)!} /> : null)} />
      </div>
    </TwinShell>
  );
}
