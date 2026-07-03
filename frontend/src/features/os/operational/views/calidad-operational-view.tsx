"use client";

import { useCallback, useMemo, useState } from "react";
import { TwinShell } from "@/features/os/shell/twin-shell";
import { useRequiredWorkspace } from "@/features/os/workspace/workspace-provider";
import { displayField } from "@/lib/operational/display-fields";
import { SECTOR_LABELS } from "@/types/operational/sector";
import { applyQualityDecisionsToItems } from "../adapters/operational-sheets-adapter";
import {
  ActionButton,
  OperationalTabs,
  OperationalTable,
  StatusChip,
  SyncStatusBar,
  type OperationalTableColumn,
} from "../components/operational-ui";
import { useOperationalPlan } from "../hooks/use-operational-plan";
import { filterQualityByKind, filterQualityByStatus } from "../lib/operational-filters";
import { WORK_TRANSFER } from "../lib/work-transfer-labels";
import { useOperationalStore } from "../store/operational-store-context";
import type { QualityItem } from "../types";

const CALIDAD_TABS = [
  { id: "elaboracion", label: "Elaboración" },
  { id: "acondicionamiento", label: "Acondicionamiento" },
] as const;

type CalidadTabId = (typeof CALIDAD_TABS)[number]["id"];

function sortReceivedFirst(items: QualityItem[]): QualityItem[] {
  return [...items].sort((a, b) => {
    const aScore = a.receivedFrom ? 1 : 0;
    const bScore = b.receivedFrom ? 1 : 0;
    if (bScore !== aScore) return bScore - aScore;
    const aTime = a.completedAt ? new Date(a.completedAt).getTime() : 0;
    const bTime = b.completedAt ? new Date(b.completedAt).getTime() : 0;
    return bTime - aTime;
  });
}

/** Calidad — bandeja de trabajos transferidos + aprobar/rechazar. */
export function CalidadOperationalView() {
  const workspace = useRequiredWorkspace();
  const {
    getQualityStatus,
    getQualityObservation,
    approveQualityItem,
    rejectQualityItem,
    refreshDecisions,
  } = useOperationalStore();
  const { data, loading, error, lastRefreshAt, refresh } = useOperationalPlan("CALIDAD");
  const [activeTab, setActiveTab] = useState<CalidadTabId>("elaboracion");
  const [observationDrafts, setObservationDrafts] = useState<Record<string, string>>({});

  const qualityItems = useMemo(() => {
    const seed = data?.qualityItems ?? [];
    return applyQualityDecisionsToItems(seed, getQualityStatus);
  }, [data?.qualityItems, getQualityStatus]);

  const granelesPendientes = useMemo(
    () =>
      sortReceivedFirst(
        filterQualityByKind(qualityItems, "granel").filter((item) => item.status === "pendiente")
      ),
    [qualityItems]
  );

  const salidasPendientes = useMemo(
    () =>
      sortReceivedFirst(
        filterQualityByKind(qualityItems, "salida").filter((item) => item.status === "pendiente")
      ),
    [qualityItems]
  );

  const transferidosCount = useMemo(
    () =>
      filterQualityByStatus(qualityItems, "pendiente").filter((item) => item.receivedFrom).length,
    [qualityItems]
  );

  const getObservationForRow = useCallback(
    (item: QualityItem) =>
      observationDrafts[item.id] ??
      getQualityObservation(item.id) ??
      item.observation ??
      "",
    [observationDrafts, getQualityObservation]
  );

  const handleApprove = useCallback(
    (item: QualityItem) => {
      approveQualityItem(item.id, {
        decidedBy: workspace.context.displayName,
        observation: getObservationForRow(item),
      });
      refreshDecisions();
      refresh();
    },
    [
      approveQualityItem,
      refreshDecisions,
      refresh,
      workspace.context.displayName,
      getObservationForRow,
    ]
  );

  const handleReject = useCallback(
    (item: QualityItem) => {
      rejectQualityItem(item.id, {
        decidedBy: workspace.context.displayName,
        observation: getObservationForRow(item),
      });
      refreshDecisions();
      refresh();
    },
    [
      rejectQualityItem,
      refreshDecisions,
      refresh,
      workspace.context.displayName,
      getObservationForRow,
    ]
  );

  const buildColumns = useCallback(
    (kind: "granel" | "salida"): OperationalTableColumn<QualityItem>[] => {
      const base: OperationalTableColumn<QualityItem>[] =
        kind === "granel"
          ? [
              {
                key: "received",
                header: "Entregado por",
                render: (row) =>
                  row.receivedFrom ? (
                    <span className="text-xs font-medium text-[var(--os-teal)]">
                      {SECTOR_LABELS[row.receivedFrom]}
                      {row.completedBy ? ` · ${row.completedBy}` : ""}
                    </span>
                  ) : (
                    <span className="text-xs text-[var(--os-text-muted)]">Planilla</span>
                  ),
              },
              {
                key: "lote",
                header: "Lote / Granel",
                render: (row) => (
                  <span className="font-mono text-xs font-medium text-[var(--os-teal)]">
                    {displayField(row.lote)}
                  </span>
                ),
              },
              { key: "product", header: "Producto", render: (row) => displayField(row.product) },
              { key: "client", header: "Cliente", render: (row) => displayField(row.client) },
              { key: "quantity", header: "Cantidad", render: (row) => displayField(row.quantity) },
              {
                key: "oe",
                header: "OE",
                render: (row) => (
                  <span className="font-mono text-xs">{displayField(row.oe)}</span>
                ),
              },
            ]
          : [
              {
                key: "received",
                header: "Entregado por",
                render: (row) =>
                  row.receivedFrom ? (
                    <span className="text-xs font-medium text-[var(--os-teal)]">
                      {SECTOR_LABELS[row.receivedFrom]}
                      {row.line ? ` · ${row.line}` : ""}
                    </span>
                  ) : (
                    <span className="text-xs text-[var(--os-text-muted)]">Planilla</span>
                  ),
              },
              { key: "line", header: "Línea", render: (row) => displayField(row.line) },
              { key: "product", header: "Producto", render: (row) => displayField(row.product) },
              { key: "client", header: "Cliente", render: (row) => displayField(row.client) },
              { key: "quantity", header: "Cantidad", render: (row) => displayField(row.quantity) },
              {
                key: "oa",
                header: "OA",
                render: (row) => (
                  <span className="font-mono text-xs">{displayField(row.oa)}</span>
                ),
              },
            ];

      return [
        ...base,
        {
          key: "status",
          header: "Estado",
          render: (row) => (
            <StatusChip status={row.status} transferredInbox={Boolean(row.receivedFrom)} />
          ),
        },
        {
          key: "observation",
          header: "Observación",
          render: (row) =>
            row.status === "pendiente" ? (
              <input
                type="text"
                value={getObservationForRow(row)}
                onChange={(e) =>
                  setObservationDrafts((prev) => ({ ...prev, [row.id]: e.target.value }))
                }
                placeholder={row.observation ?? "Observación…"}
                className="min-w-[140px] rounded border border-[var(--os-border)] bg-[var(--os-surface)] px-2 py-1 text-sm"
              />
            ) : (
              <span className="text-sm text-[var(--os-text-muted)]">
                {displayField(getQualityObservation(row.id))}
              </span>
            ),
        },
        {
          key: "actions",
          header: "Acciones",
          render: (row) =>
            row.status === "pendiente" ? (
              <div className="flex flex-wrap gap-2">
                <ActionButton label="Aprobar" variant="approve" onClick={() => handleApprove(row)} />
                <ActionButton label="Rechazar" variant="reject" onClick={() => handleReject(row)} />
              </div>
            ) : (
              <span className="text-xs text-[var(--os-text-muted)]">—</span>
            ),
        },
      ];
    },
    [getObservationForRow, getQualityObservation, handleApprove, handleReject]
  );

  const granelColumns = useMemo(() => buildColumns("granel"), [buildColumns]);
  const salidaColumns = useMemo(() => buildColumns("salida"), [buildColumns]);

  const tabs = CALIDAD_TABS.map((tab) => ({
    ...tab,
    count: tab.id === "elaboracion" ? granelesPendientes.length : salidasPendientes.length,
  }));

  return (
    <TwinShell title="Calidad">
      <header className="mb-6 space-y-2">
        <h2 className="text-2xl font-semibold tracking-tight">Calidad</h2>
        <p className="text-sm text-[var(--os-text-muted)]">{workspace.subtitle}</p>
        <SyncStatusBar
          source={data?.source ?? "demo"}
          lastRefreshAt={lastRefreshAt}
          loading={loading}
          onRefresh={refresh}
        />
      </header>

      {transferidosCount > 0 && (
        <div className="mb-4 rounded-[var(--os-radius-sm)] border border-[var(--os-teal)]/30 bg-[var(--os-teal-soft)] px-4 py-3 text-sm text-[var(--os-text)]">
          <strong>{WORK_TRANSFER.inboxBannerTitle}:</strong> {transferidosCount} trabajo
          {transferidosCount === 1 ? "" : "s"} entregado
          {transferidosCount === 1 ? "" : "s"} desde planta — {WORK_TRANSFER.awaitingApproval.toLowerCase()}.
        </div>
      )}

      {error && (
        <div className="mb-4 rounded border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          {error}
        </div>
      )}

      <OperationalTabs tabs={tabs} activeId={activeTab} onChange={(id) => setActiveTab(id as CalidadTabId)} />

      <div className="mt-4">
        {activeTab === "elaboracion" && (
          <OperationalTable
            columns={granelColumns}
            rows={granelesPendientes}
            rowKey={(row) => row.id}
            emptyMessage="Sin graneles pendientes de revisión."
          />
        )}
        {activeTab === "acondicionamiento" && (
          <OperationalTable
            columns={salidaColumns}
            rows={salidasPendientes}
            rowKey={(row) => row.id}
            emptyMessage="Sin salidas pendientes de aprobación."
          />
        )}
      </div>
    </TwinShell>
  );
}
