"use client";

import type { ReactNode } from "react";
import { isWorkTransferredStatus, WORK_TRANSFER } from "../lib/work-transfer-labels";

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
  source: "drive" | "demo" | "native";
  lastRefreshAt: Date | null;
  updatedAgoLabel?: string;
  liveConnected?: boolean;
  loading?: boolean;
  /** Mensaje diagnóstico de la API (modo demo, permisos, índice Drive). */
  detailMessage?: string | null;
}

function buildLabel(): string {
  const sha =
    process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ??
    process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7);
  return sha ? `build ${sha}` : "build local";
}

export function SyncStatusBar({
  source,
  lastRefreshAt,
  updatedAgoLabel,
  liveConnected,
  loading,
  detailMessage,
}: SyncStatusBarProps) {
  const timeLabel = updatedAgoLabel ?? (lastRefreshAt
    ? lastRefreshAt.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })
    : "—");

  const isNative = source === "native";
  const isSheets = source === "drive";

  const badgeClass = isNative || isSheets
    ? "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200"
    : "bg-amber-50 text-amber-900 ring-1 ring-amber-200";

  const badgeLabel = isNative
    ? "Genus OS"
    : isSheets
      ? "Datos reales"
      : "Demo / sin conexión";

  const sourceLabel = isNative
    ? "Planificación publicada"
    : isSheets
      ? "SEMANAS 2026 · Google Sheets"
      : "Sin datos de Sheets — revisar GENUS_DATA_MODE y Drive";

  // Native: nunca mostrar banners técnicos ni menciones a Sheets/Postgres.
  const showDetail =
    Boolean(detailMessage) &&
    !isNative &&
    !/sheets|postgres|database_url|genus_data_mode/i.test(detailMessage ?? "");

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 font-medium ${badgeClass}`}
        >
          {badgeLabel}
        </span>
        <span className="text-[var(--os-text-muted)]">{sourceLabel}</span>
        <span className="font-mono text-[10px] text-[var(--os-text-muted)]">{buildLabel()}</span>
        <span className="text-[var(--os-text-muted)]">·</span>
        <span className="text-[var(--os-text-muted)]">
          Actualizado {timeLabel}
        </span>
        {(isSheets || isNative) && (
          <>
            <span className="text-[var(--os-text-muted)]">·</span>
            <span
              className={`inline-flex items-center gap-1 ${
                liveConnected || isNative
                  ? "text-emerald-700"
                  : "text-[var(--os-text-muted)]"
              }`}
            >
              <span
                className={`inline-block h-1.5 w-1.5 rounded-full ${
                  liveConnected || isNative ? "bg-emerald-500" : "bg-gray-300"
                }`}
              />
              {isNative
                ? "En planta"
                : liveConnected
                  ? "En vivo"
                  : "Reconectando…"}
            </span>
          </>
        )}
        {loading && <span className="text-[var(--os-teal)]">Actualizando…</span>}
      </div>
      {showDetail && (
        <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
          {detailMessage}
        </p>
      )}
      {isSheets && (
        <p className="text-[11px] leading-relaxed text-[var(--os-text-muted)]">
          Trabajo operativo desde SEMANAS 2026. Enriquecimiento PEDIDOS / Dashboard KPI
          pendiente: convertir PEDIDOS 2026 de Office .xlsx a Google Sheets nativo.
        </p>
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

export function StatusChip({
  status,
  transferredInbox,
}: {
  status: string;
  /** Ítem en bandeja Calidad recibido por transferencia. */
  transferredInbox?: boolean;
}) {
  const normalized = status.toLowerCase();
  let cls = "bg-[var(--os-bg)] text-[var(--os-text-muted)]";
  let label = status.replace(/_/g, " ");

  if (transferredInbox && normalized === "pendiente") {
    cls = "bg-[var(--os-teal-soft)] text-[var(--os-teal)]";
    label = WORK_TRANSFER.awaitingApproval;
  } else if (normalized === "aprobado") {
    cls = "bg-emerald-50 text-emerald-800";
  } else if (isWorkTransferredStatus(normalized) || normalized === "revision") {
    cls = "bg-[var(--os-teal-soft)] text-[var(--os-teal)]";
    label = WORK_TRANSFER.pendingReview;
  } else if (normalized === "completo") {
    cls = "bg-[var(--os-teal-soft)] text-[var(--os-teal)]";
    label = WORK_TRANSFER.pendingReview;
  } else if (normalized === "rechazado" || normalized === "bloqueado") {
    cls = "bg-rose-50 text-rose-800";
  } else if (normalized === "pendiente" || normalized === "en_curso") {
    cls = "bg-amber-50 text-amber-900";
  }

  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium capitalize ${cls}`}>
      {label}
    </span>
  );
}
