"use client";

import { useMemo } from "react";
import { TwinShell } from "@/features/os/shell/twin-shell";
import { SectionLabel } from "@/features/work/components/section-label";
import { usePreviewContext } from "@/features/os/session/preview-context";
import { useMultiSectorWorkItems, TWIN_DATA_SECTORS } from "@/features/work/hooks/use-multi-sector-work-items";
import { SECTOR_LABELS, type SectorId } from "@/types/operational/sector";
import { startOfDay } from "@/features/work/lib/calendar";
import { filterWorkItemsForDate } from "@/features/work/lib/work-items-day-view";

const DISPLAY_SECTORS: SectorId[] = [
  "ELABORACION",
  "ENVASADO_MASIVO",
  "ENVASADO_PREMIUM",
  "CODIFICADO",
  "CALIDAD",
  "DEPOSITO",
];

function SectorStatusCard({
  sectorId,
  fill,
  delayed,
  stopped,
  blocked,
  urgent,
}: {
  sectorId: SectorId;
  fill: number;
  delayed?: boolean;
  stopped?: boolean;
  blocked: number;
  urgent: number;
}) {
  const bars = Math.min(6, Math.max(0, fill));
  const empty = 6 - bars;

  return (
    <div className="rounded-[var(--os-radius)] border border-[var(--os-border)] bg-[var(--os-surface)] px-6 py-5 transition-shadow hover:shadow-[var(--os-shadow-card)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-[var(--os-text)]">{SECTOR_LABELS[sectorId]}</p>
          <p className="mt-1 font-mono text-xl tracking-tight text-[var(--os-teal)]">
            {"█".repeat(bars)}
            <span className="text-[var(--os-border)]">{"░".repeat(empty)}</span>
          </p>
        </div>
        <div className="text-right text-xs">
          {urgent > 0 && <p className="font-medium text-amber-700">{urgent} urgente(s)</p>}
          {blocked > 0 && <p className="font-medium text-rose-600">{blocked} bloqueo(s)</p>}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {delayed && (
          <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-800">
            Atrasado
          </span>
        )}
        {stopped && (
          <span className="rounded-full bg-rose-50 px-2.5 py-0.5 text-xs font-medium text-rose-700">
            Detenida
          </span>
        )}
        {!delayed && !stopped && blocked === 0 && (
          <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-800">
            En flujo
          </span>
        )}
      </div>
    </div>
  );
}

/** Centro de control de planta — estado por sector desde WorkItems reales. */
export function WireframeProduccion() {
  const { applyEffectiveStatus, openConsulta } = usePreviewContext();
  const { items, loading, scannedAt } = useMultiSectorWorkItems(TWIN_DATA_SECTORS);
  const today = useMemo(() => startOfDay(new Date()), []);

  const workItems = useMemo(() => applyEffectiveStatus(items), [items, applyEffectiveStatus]);

  const sectorStats = useMemo(() => {
    return DISPLAY_SECTORS.map((sectorId) => {
      const sectorItems = workItems.filter((item) => item.sector === sectorId);
      const todayItems = filterWorkItemsForDate(sectorItems, today, today);
      const blocked = todayItems.filter((i) => i.status === "bloqueado").length;
      const urgent = todayItems.filter(
        (i) => i.priority === "URGENTE" || i.priority === "HOY"
      ).length;
      const inProgress = todayItems.filter((i) => i.status === "en_curso").length;
      const total = todayItems.length;
      const fill = total === 0 ? 0 : Math.min(6, Math.max(1, inProgress + Math.ceil(total / 2)));

      return {
        sectorId,
        fill,
        delayed: urgent > 0 && inProgress === 0,
        stopped: blocked > 0,
        blocked,
        urgent,
        todayItems,
      };
    });
  }, [workItems, today]);

  const problems = useMemo(() => {
    const list: { text: string; type: "urgente" | "accion" | "info" }[] = [];
    for (const stat of sectorStats) {
      if (stat.blocked > 0) {
        list.push({
          text: `${SECTOR_LABELS[stat.sectorId]}: ${stat.blocked} bloqueo(s) activo(s)`,
          type: "urgente",
        });
      }
      if (stat.urgent > 0) {
        list.push({
          text: `${SECTOR_LABELS[stat.sectorId]}: ${stat.urgent} prioridad alta hoy`,
          type: "accion",
        });
      }
    }
    if (list.length === 0) {
      list.push({
        text: "Planta en calma — sin cuellos de botella detectados en WorkItems.",
        type: "info",
      });
    }
    return list.slice(0, 6);
  }, [sectorStats]);

  return (
    <TwinShell
      title="Control de planta"
      syncTime={scannedAt ? new Date(scannedAt) : undefined}
    >
      <header className="mb-10">
        <h2 className="text-3xl font-semibold tracking-tight">Centro de control</h2>
        <p className="mt-2 text-base text-[var(--os-text-muted)]">
          Estado de cada sector · bloqueos · prioridades · flujo
        </p>
      </header>

      <SectionLabel>Problemas y prioridades</SectionLabel>
      <ul className="mb-[var(--os-space-section)] space-y-2">
        {problems.map((p) => (
          <li
            key={p.text}
            className={`rounded-[var(--os-radius-sm)] px-4 py-3 text-sm font-medium os-fade-in ${
              p.type === "urgente"
                ? "bg-red-50 text-red-900"
                : p.type === "accion"
                  ? "bg-[var(--os-teal-soft)] text-[var(--os-teal)]"
                  : "border border-[var(--os-border)] bg-[var(--os-surface)]"
            }`}
          >
            {p.text}
          </li>
        ))}
      </ul>

      <SectionLabel>Hoy · carga por sector</SectionLabel>
      {loading ? (
        <div className="os-skeleton mb-[var(--os-space-section)] h-64 rounded-[var(--os-radius)]" />
      ) : (
        <div className="mb-[var(--os-space-section)] grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sectorStats.map((stat) => (
            <SectorStatusCard key={stat.sectorId} {...stat} />
          ))}
        </div>
      )}

      <SectionLabel>Flujo</SectionLabel>
      <div className="rounded-[var(--os-radius)] border border-[var(--os-border)] bg-[var(--os-surface)] p-6">
        <p className="text-sm text-[var(--os-text-muted)]">
          Comercial → Desarrollo → Planificación → Elaboración → Envasado → Codificado → Calidad →
          Depósito
        </p>
        <button
          type="button"
          onClick={() => openConsulta("")}
          className="mt-4 rounded-[var(--os-radius-sm)] border border-[var(--os-border)] px-4 py-2 text-sm font-medium transition-colors hover:border-[var(--os-teal)] hover:text-[var(--os-teal)]"
        >
          Buscar pedido o lote →
        </button>
      </div>
    </TwinShell>
  );
}
