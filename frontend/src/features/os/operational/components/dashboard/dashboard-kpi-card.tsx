"use client";

import { Info } from "lucide-react";
import { useId, useState } from "react";
import { DASHBOARD_KPI_DEFINITIONS } from "@/lib/dashboard/kpi-definitions";
import { fmtDays, fmtDec1, fmtInt, fmtPercent } from "@/lib/dashboard/format";
import { DATE_BASIS_LABELS, isNotAvailable, type DashboardKpi, type NotAvailable } from "@/lib/dashboard/types";

export function formatKpiValue(kpi: DashboardKpi): string {
  if (kpi.value == null) return "";
  if (kpi.valueLabel) return kpi.valueLabel;
  switch (kpi.unit) {
    case "percent":
      return fmtPercent(kpi.value);
    case "days":
      return fmtDays(kpi.value);
    case "decimal":
      return fmtDec1(kpi.value);
    default:
      return fmtInt(kpi.value);
  }
}

const ACCURACY_LABEL = {
  exacto: "Dato exacto",
  adaptado: "Criterio propuesto",
  sin_datos: "Sin datos suficientes",
} as const;

/** Mensaje compartido: «Sin datos suficientes» con motivo y qué habría que registrar. */
export function InsufficientData({ reason, toRecord }: { reason: string | null; toRecord: string | null }) {
  return (
    <div data-testid="sin-datos-suficientes" className="space-y-1">
      <p className="text-base font-semibold text-[var(--os-text)]">Sin datos suficientes</p>
      {reason ? <p className="text-xs leading-snug text-[var(--os-text-muted)]">{reason}</p> : null}
      {toRecord ? (
        <p className="text-xs leading-snug text-[var(--os-text-muted)]">
          <span className="font-semibold text-[var(--os-text)]">Para calcularlo: </span>
          {toRecord}
        </p>
      ) : null}
    </div>
  );
}

export function NotAvailableCard({ title, block }: { title: string; block: NotAvailable }) {
  return (
    <article
      className="flex min-w-0 flex-col gap-2 rounded-[var(--os-radius)] border border-dashed border-[var(--os-border)] bg-[var(--os-surface)]/60 p-4"
      data-testid="kpi-not-available"
    >
      <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--os-text-muted)]">{title}</h3>
      <p className="text-sm font-medium text-[var(--os-text)]">No disponible para tu sector</p>
      <p className="text-xs text-[var(--os-text-muted)]">{block.reason}</p>
    </article>
  );
}

type Props = {
  kpi: DashboardKpi;
  /** Aclaración corta debajo del valor (p. ej. «En proceso + ingresados»). */
  caption?: string;
  /** Resalta el valor (indicador principal). */
  emphasis?: boolean;
  testId?: string;
  /** Color de acento de la tarjeta (tarjetas coloreadas de productividad). Funciona en tema claro y oscuro. */
  accent?: string;
};

/** Tarjeta de indicador: valor, período, tipo de fecha, muestra y criterio desplegable. */
export function DashboardKpiCard({ kpi, caption, emphasis, testId, accent }: Props) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const def = DASHBOARD_KPI_DEFINITIONS[kpi.key];
  const hasValue = kpi.value != null;
  const filterHints: string[] = [];
  if (kpi.appliedFilters.sector === false) filterHints.push("sector no aplica");

  return (
    <article
      className="flex min-w-0 flex-col gap-2 rounded-[var(--os-radius)] border border-[var(--os-border)] bg-[var(--os-surface)] p-4 shadow-[var(--os-shadow-sm)]"
      style={
        accent
          ? {
              background: `color-mix(in srgb, ${accent} 13%, var(--os-surface))`,
              borderColor: `color-mix(in srgb, ${accent} 45%, var(--os-border))`,
              borderTopWidth: 3,
              borderTopColor: accent,
            }
          : undefined
      }
      data-testid={testId ?? `kpi-${kpi.key}`}
      data-has-value={hasValue ? "1" : "0"}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="min-w-0 text-xs font-semibold uppercase tracking-wide text-[var(--os-text-muted)]">{kpi.label}</h3>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={panelId}
          className="inline-flex size-6 shrink-0 items-center justify-center rounded-full text-[var(--os-text-muted)] hover:bg-white/10 hover:text-[var(--os-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--os-teal)]"
          aria-label={`Ver criterio de ${kpi.label}`}
        >
          <Info className="size-4" aria-hidden="true" />
        </button>
      </div>

      {hasValue ? (
        <div>
          <p
            className={`${emphasis ? "text-3xl" : "text-2xl"} font-bold leading-tight tabular-nums text-[var(--os-text)]`}
            data-testid={`${testId ?? `kpi-${kpi.key}`}-value`}
          >
            {formatKpiValue(kpi)}
          </p>
          {caption ? <p className="mt-0.5 text-xs text-[var(--os-text-muted)]">{caption}</p> : null}
        </div>
      ) : (
        <InsufficientData reason={kpi.reason} toRecord={kpi.toRecord} />
      )}

      <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] leading-tight text-[var(--os-text-muted)]">
        <span className="rounded bg-white/[0.06] px-1.5 py-0.5" data-testid="kpi-date-basis">
          {DATE_BASIS_LABELS[kpi.dateBasis]}
        </span>
        <span data-testid="kpi-period">{kpi.periodLabel}</span>
        {hasValue && kpi.sampleSize > 0 ? <span>· n = {fmtInt(kpi.sampleSize)}</span> : null}
        {hasValue ? <span>· {ACCURACY_LABEL[kpi.accuracy]}</span> : null}
        {filterHints.length ? <span>· {filterHints.join(", ")}</span> : null}
      </div>

      {open ? (
        <div id={panelId} className="space-y-2 rounded-[var(--os-radius-sm)] bg-black/20 p-2.5 text-xs leading-snug text-[var(--os-text-muted)]">
          <p>
            <span className="font-semibold text-[var(--os-text)]">Criterio: </span>
            {def.criterion}
          </p>
          <p>
            <span className="font-semibold text-[var(--os-text)]">Fuente: </span>
            {def.source}
          </p>
          <p className="italic">{def.footnote ?? "Criterio propuesto, pendiente de validar contra la planilla."}</p>
          {kpi.notes.length ? (
            <ul className="list-disc space-y-0.5 pl-4">
              {kpi.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

/** Renderiza un KPI que puede venir recortado por permisos. */
export function KpiOrBlocked({ title, kpi, ...rest }: { title: string; kpi: DashboardKpi | NotAvailable } & Omit<Props, "kpi">) {
  if (isNotAvailable(kpi)) return <NotAvailableCard title={title} block={kpi} />;
  return <DashboardKpiCard kpi={kpi} {...rest} />;
}
