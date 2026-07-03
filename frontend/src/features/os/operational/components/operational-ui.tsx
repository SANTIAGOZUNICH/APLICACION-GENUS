"use client";

import type { ReactNode } from "react";

export interface OperationalTab {
  id: string;
  label: string;
  count?: number;
}

interface OperationalTabsProps {
  tabs: OperationalTab[];
  activeId: string;
  onChange: (id: string) => void;
}

/** Pestañas operativas — estilo planilla, sin decoración premium. */
export function OperationalTabs({ tabs, activeId, onChange }: OperationalTabsProps) {
  return (
    <div
      role="tablist"
      className="flex flex-wrap gap-1 border-b border-[var(--os-border)]"
    >
      {tabs.map((tab) => {
        const active = tab.id === activeId;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.id)}
            className={`-mb-px rounded-t-[var(--os-radius-sm)] px-4 py-2.5 text-sm font-medium transition-colors ${
              active
                ? "border border-b-[var(--os-surface)] border-[var(--os-border)] bg-[var(--os-surface)] text-[var(--os-text)]"
                : "text-[var(--os-text-muted)] hover:text-[var(--os-text)]"
            }`}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span className="ml-1.5 text-xs text-[var(--os-text-muted)]">({tab.count})</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export interface OperationalTableColumn<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  className?: string;
}

interface OperationalTableProps<T> {
  columns: OperationalTableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  emptyMessage?: string;
}

/** Tabla funcional tipo Sheets — filas densas, legibles. */
export function OperationalTable<T>({
  columns,
  rows,
  rowKey,
  emptyMessage = "Sin registros.",
}: OperationalTableProps<T>) {
  if (rows.length === 0) {
    return (
      <p className="rounded-[var(--os-radius-sm)] border border-dashed border-[var(--os-border)] px-4 py-8 text-center text-sm text-[var(--os-text-muted)]">
        {emptyMessage}
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-[var(--os-radius-sm)] border border-[var(--os-border)]">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-[var(--os-border)] bg-[var(--os-bg)]">
            {columns.map((col) => (
              <th
                key={col.key}
                className={`px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-[var(--os-text-muted)] ${col.className ?? ""}`}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              className="border-b border-[var(--os-border-subtle)] last:border-b-0 hover:bg-[var(--os-bg)]/60"
            >
              {columns.map((col) => (
                <td key={col.key} className={`px-3 py-2.5 align-top ${col.className ?? ""}`}>
                  {col.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface SyncStatusBarProps {
  source: "drive" | "demo";
  lastRefreshAt: Date | null;
  loading?: boolean;
  onRefresh?: () => void;
}

export function SyncStatusBar({ source, lastRefreshAt, loading, onRefresh }: SyncStatusBarProps) {
  const timeLabel = lastRefreshAt
    ? lastRefreshAt.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })
    : "—";

  const isReal = source === "drive";

  return (
    <div className="flex flex-wrap items-center gap-3 text-xs">
      <span
        className={`inline-flex items-center rounded-full px-2.5 py-0.5 font-medium ${
          isReal
            ? "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200"
            : "bg-amber-50 text-amber-900 ring-1 ring-amber-200"
        }`}
      >
        {isReal ? "Datos reales" : "Demo"}
      </span>
      <span className="text-[var(--os-text-muted)]">
        {isReal ? "SEMANAS 2026 · Google Sheets" : "Planificación demo · fallback automático"}
      </span>
      <span className="text-[var(--os-text-muted)]">·</span>
      <span className="text-[var(--os-text-muted)]">Última sync: {timeLabel}</span>
      <span className="text-[var(--os-text-muted)]">·</span>
      <span className="text-[var(--os-text-muted)]">Auto-refresh 30s</span>
      {loading && <span className="text-[var(--os-teal)]">Actualizando…</span>}
      {onRefresh && (
        <button
          type="button"
          onClick={onRefresh}
          className="rounded border border-[var(--os-border)] bg-[var(--os-surface)] px-3 py-1 font-medium text-[var(--os-text)] hover:border-[var(--os-teal)] hover:text-[var(--os-teal)]"
        >
          Refrescar
        </button>
      )}
    </div>
  );
}

interface ActionButtonProps {
  label: string;
  variant: "approve" | "reject" | "neutral";
  onClick: () => void;
  disabled?: boolean;
}

export function ActionButton({ label, variant, onClick, disabled }: ActionButtonProps) {
  const styles =
    variant === "approve"
      ? "border-emerald-300 text-emerald-800 hover:bg-emerald-50"
      : variant === "reject"
        ? "border-rose-300 text-rose-800 hover:bg-rose-50"
        : "border-[var(--os-border)] text-[var(--os-text-muted)] hover:border-[var(--os-teal)]";

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`rounded-[var(--os-radius-sm)] border px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${styles}`}
    >
      {label}
    </button>
  );
}

export function StatusChip({ status }: { status: string }) {
  const normalized = status.toLowerCase();
  let cls = "bg-[var(--os-bg)] text-[var(--os-text-muted)]";

  if (normalized === "aprobado" || normalized === "completo") {
    cls = "bg-emerald-50 text-emerald-800";
  } else if (normalized === "rechazado" || normalized === "bloqueado") {
    cls = "bg-rose-50 text-rose-800";
  } else if (normalized === "pendiente" || normalized === "en_curso") {
    cls = "bg-amber-50 text-amber-900";
  }

  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium capitalize ${cls}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}
