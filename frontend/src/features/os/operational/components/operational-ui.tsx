"use client";

import { Fragment, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  SelectionCheckbox,
  selectedRowClassName,
} from "@/features/os/operational/components/list-selection-mode";
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

/** Pestañas operativas — Industrial Glass, indicador animado. */
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
            className={`relative -mb-px rounded-t-[var(--os-radius-sm)] px-4 py-2.5 text-sm font-medium transition-[color,background-color,border-color] duration-[var(--genus-duration-hover,140ms)] ${
              active
                ? "border border-b-[var(--os-surface)] border-[var(--os-border)] bg-[var(--os-surface-glass)] text-[var(--os-text)] shadow-[var(--os-shadow-sm)]"
                : "text-[var(--os-text-muted)] hover:text-[var(--os-text)]"
            }`}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span className="ml-1.5 text-xs text-[var(--os-text-muted)]">({tab.count})</span>
            )}
            <span
              aria-hidden="true"
              className={`pointer-events-none absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-[var(--os-teal)] transition-opacity duration-[var(--genus-duration-hover,140ms)] ${
                active ? "opacity-100" : "opacity-0"
              }`}
            />
          </button>
        );
      })}
    </div>
  );
}

export interface OperationalTableColumn<T> {
  key: string;
  header: string;
  headerTitle?: string;
  render: (row: T) => ReactNode;
  className?: string;
  /**
   * Columna secundaria: se oculta bajo el breakpoint y pasa a “Más datos”.
   * true ≡ collapseBelow "md".
   * Usar "lg"/"xl"/"2xl" en tablas anchas (laptop → desktop amplio).
   */
  hideOnMobile?: boolean | "md" | "lg" | "xl" | "2xl";
}

type CollapseBelow = "md" | "lg" | "xl" | "2xl";

function resolveCollapse(hideOnMobile?: boolean | CollapseBelow): CollapseBelow | null {
  if (!hideOnMobile) return null;
  if (hideOnMobile === true) return "md";
  return hideOnMobile;
}

function hideColClass(bp: CollapseBelow): string {
  if (bp === "2xl") return "hidden 2xl:table-cell";
  if (bp === "xl") return "hidden xl:table-cell";
  if (bp === "lg") return "hidden lg:table-cell";
  return "hidden md:table-cell";
}

function moreToggleClass(bp: CollapseBelow): string {
  if (bp === "2xl") return "2xl:hidden";
  if (bp === "xl") return "xl:hidden";
  if (bp === "lg") return "lg:hidden";
  return "md:hidden";
}

interface OperationalTableSelection {
  active: boolean;
  isSelected: (id: string) => boolean;
  onToggle: (id: string) => void;
}

interface OperationalTableProps<T> {
  columns: OperationalTableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  emptyMessage?: string;
  /** Modo selección explícito (checkboxes solo si active). */
  selection?: OperationalTableSelection;
}

/** Tabla funcional — sin scroll horizontal; secundarios en “Más datos”. */
export function OperationalTable<T>({
  columns,
  rows,
  rowKey,
  emptyMessage = "Sin registros.",
  selection,
}: OperationalTableProps<T>) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const secondaryMeta = columns
    .map((c) => ({ col: c, bp: resolveCollapse(c.hideOnMobile) }))
    .filter((x): x is { col: OperationalTableColumn<T>; bp: CollapseBelow } => x.bp != null);
  const hasSecondary = secondaryMeta.length > 0;
  const selectionActive = Boolean(selection?.active);
  /** Breakpoint más amplio entre secundarias → el chevron se muestra hasta ahí. */
  const expanderBp: CollapseBelow = secondaryMeta.reduce<CollapseBelow>((acc, x) => {
    const order = { md: 0, lg: 1, xl: 2, "2xl": 3 } as const;
    return order[x.bp] > order[acc] ? x.bp : acc;
  }, "md");
  const primaryCount = columns.filter((c) => !resolveCollapse(c.hideOnMobile)).length;
  const visibleColCount =
    primaryCount + (hasSecondary ? 1 : 0) + (selectionActive ? 1 : 0);

  if (rows.length === 0) {
    return (
      <p className="rounded-[var(--os-radius-sm)] border border-dashed border-[var(--os-border)] px-4 py-8 text-center text-sm text-[var(--os-text-muted)]">
        {emptyMessage}
      </p>
    );
  }

  return (
    <div className="os-table-wrap max-w-full min-w-0 overflow-x-clip rounded-[var(--os-radius-sm)] border border-[var(--os-border)] bg-[var(--os-surface)] shadow-[var(--os-shadow-sm)]">
      <table className="os-table w-full max-w-full table-fixed border-collapse text-[length:var(--os-table-font,12.75px)]">
        <thead className="sticky top-0 z-[1]">
          <tr className="border-b border-[var(--os-border)] bg-[var(--os-surface-glass)] backdrop-blur-md">
            {selectionActive ? (
              <th
                className="w-10 px-2 py-[var(--os-density-table-padding-y)]"
                aria-label="Selección"
              />
            ) : null}
            {hasSecondary ? (
              <th
                className={`w-8 px-1 py-[var(--os-density-table-padding-y)] ${moreToggleClass(expanderBp)}`}
                aria-label="Más datos"
              />
            ) : null}
            {columns.map((col) => {
              const bp = resolveCollapse(col.hideOnMobile);
              return (
                <th
                  key={col.key}
                  title={col.headerTitle ?? col.header}
                  className={`os-table-th min-w-0 ${bp ? hideColClass(bp) : ""} ${col.className ?? ""}`}
                >
                  <span className="block truncate">{col.header}</span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const id = rowKey(row);
            const isOpen = Boolean(expanded[id]);
            const rowSelected = Boolean(selectionActive && selection?.isSelected(id));
            return (
              <Fragment key={id}>
                <tr
                  className={`border-b border-[var(--os-border-subtle)] last:border-b-0 transition-colors hover:bg-[var(--os-teal-soft)]/40 hover:shadow-[inset_3px_0_0_0_rgb(18_191_183_/_0.45)] ${selectedRowClassName(rowSelected)}`}
                >
                  {selectionActive && selection ? (
                    <td className="w-10 px-2 py-[var(--os-density-table-padding-y)] align-middle">
                      <SelectionCheckbox
                        checked={rowSelected}
                        onChange={() => selection.onToggle(id)}
                        label={`Seleccionar fila ${id}`}
                      />
                    </td>
                  ) : null}
                  {hasSecondary ? (
                    <td
                      className={`w-8 px-1 py-[var(--os-density-table-padding-y)] align-middle ${moreToggleClass(expanderBp)}`}
                    >
                      <button
                        type="button"
                        className="inline-flex size-7 items-center justify-center rounded text-[var(--os-text-muted)] hover:bg-[var(--os-teal-soft)]/50"
                        aria-expanded={isOpen}
                        aria-label={isOpen ? "Ocultar más datos" : "Más datos"}
                        data-testid={`os-table-more-${id}`}
                        onClick={() =>
                          setExpanded((prev) => ({ ...prev, [id]: !prev[id] }))
                        }
                      >
                        {isOpen ? (
                          <ChevronDown className="size-4" />
                        ) : (
                          <ChevronRight className="size-4" />
                        )}
                      </button>
                    </td>
                  ) : null}
                  {columns.map((col) => {
                    const bp = resolveCollapse(col.hideOnMobile);
                    return (
                      <td
                        key={col.key}
                        className={`os-table-td ${bp ? hideColClass(bp) : ""} ${col.className ?? ""}`}
                      >
                        {col.render(row)}
                      </td>
                    );
                  })}
                </tr>
                {hasSecondary && isOpen ? (
                  <tr className={`border-b border-[var(--os-border-subtle)] ${moreToggleClass(expanderBp)}`}>
                    <td
                      colSpan={visibleColCount}
                      className="bg-[var(--os-surface-glass)] px-3 py-2"
                      data-testid={`os-table-more-panel-${id}`}
                    >
                      <dl className="grid gap-2 text-[length:var(--os-table-font-secondary,11.5px)] sm:grid-cols-2">
                        {secondaryMeta.map(({ col }) => (
                          <div key={col.key} className="min-w-0">
                            <dt className="font-semibold uppercase tracking-wide text-[var(--os-text-muted)]">
                              {col.headerTitle ?? col.header}
                            </dt>
                            <dd className="mt-0.5 text-[var(--os-text)]">{col.render(row)}</dd>
                          </div>
                        ))}
                      </dl>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
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
  /** Actualización manual (poll / work-items). */
  onRefresh?: () => void;
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
  onRefresh,
}: SyncStatusBarProps) {
  const timeLabel = updatedAgoLabel ?? (lastRefreshAt
    ? lastRefreshAt.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })
    : "—");

  const isNative = source === "native";
  const isSheets = source === "drive";

  const badgeClass = isNative || isSheets
    ? "bg-[var(--genus-success-soft)] text-[var(--genus-success)] ring-1 ring-[var(--genus-success)]/20"
    : "bg-[var(--genus-warning-soft)] text-[var(--genus-warning)] ring-1 ring-[var(--genus-warning)]/20";

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
                  ? "text-[var(--genus-success)]"
                  : "text-[var(--os-text-muted)]"
              }`}
            >
              <span
                className={`inline-block h-1.5 w-1.5 rounded-full ${
                  liveConnected || isNative ? "bg-[var(--genus-success)]" : "bg-[var(--os-border)]"
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
        {onRefresh ? (
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="rounded-[var(--os-radius-sm)] border border-[var(--os-border)] bg-[var(--os-surface)] px-2 py-0.5 font-medium text-[var(--os-text)] transition-colors hover:bg-[var(--os-bg)] disabled:opacity-50"
            data-testid="sync-status-refresh"
          >
            Actualizar
          </button>
        ) : null}
      </div>
      {showDetail && (
        <p className="rounded-[var(--os-radius-sm)] border border-[var(--genus-warning)]/25 bg-[var(--genus-warning-soft)] px-3 py-2 text-xs text-[var(--genus-warning)]">
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
  title?: string;
}

export function ActionButton({ label, variant, onClick, disabled, title }: ActionButtonProps) {
  const styles =
    variant === "approve"
      ? "border-[var(--genus-success)]/35 text-[var(--genus-success)] hover:bg-[var(--genus-success-soft)]"
      : variant === "reject"
        ? "border-[var(--genus-error)]/35 text-[var(--genus-error)] hover:bg-[var(--genus-error-soft)]"
        : "border-[var(--os-border)] text-[var(--os-text-muted)] hover:border-[var(--os-teal)]";

  return (
    <button
      type="button"
      disabled={disabled}
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
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
  } else if (normalized === "en_codificado") {
    cls = "bg-[var(--genus-info-soft,var(--os-teal-soft))] text-[var(--genus-info,var(--os-teal))]";
    label = WORK_TRANSFER.inCodificado;
  } else if (normalized === "codificado_completo") {
    cls = "bg-[var(--os-teal-soft)] text-[var(--os-teal)]";
    label = "Codificado completo";
  } else if (normalized === "aprobado") {
    cls = "bg-[var(--genus-success-soft)] text-[var(--genus-success)]";
  } else if (isWorkTransferredStatus(normalized) || normalized === "revision") {
    cls = "bg-[var(--os-teal-soft)] text-[var(--os-teal)]";
    label = WORK_TRANSFER.pendingReview;
  } else if (normalized === "completo") {
    cls = "bg-[var(--os-teal-soft)] text-[var(--os-teal)]";
    label = WORK_TRANSFER.pendingReview;
  } else if (normalized === "rechazado" || normalized === "bloqueado") {
    cls = "bg-[var(--genus-error-soft)] text-[var(--genus-error)]";
  } else if (normalized === "entregado" || normalized === "en_fecha") {
    cls = "bg-[var(--genus-success-soft)] text-[var(--genus-success)]";
    label = normalized === "en_fecha" ? "En fecha" : "Entregado";
  } else if (normalized === "fuera_fecha") {
    cls = "bg-[var(--genus-warning-soft)] text-[var(--genus-warning)]";
    label = "Fuera de fecha";
  } else if (normalized === "cancelado") {
    cls = "bg-[var(--os-surface-muted)] text-[var(--os-text-muted)]";
    label = "Cancelado";
  } else if (normalized === "pendiente" || normalized === "en_curso") {
    cls = "bg-[var(--genus-warning-soft)] text-[var(--genus-warning)]";
  }

  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${cls}`}>
      {label}
    </span>
  );
}
