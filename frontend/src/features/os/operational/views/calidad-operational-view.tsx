"use client";

import { useCallback, useMemo, useState } from "react";
import { TwinShell } from "@/features/os/shell/twin-shell";
import { useRequiredWorkspace } from "@/features/os/workspace/workspace-provider";
import { displayField } from "@/lib/operational/display-fields";
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
import {
  filterQualityByKind,
  filterQualityToday,
} from "../lib/operational-filters";
import { useOperationalStore } from "../store/operational-store-context";
import type { QualityItem } from "../types";

const CALIDAD_TABS = [
  { id: "elaboracion", label: "Elaboración" },
  { id: "acondicionamiento", label: "Acondicionamiento" },
] as const;

type CalidadTabId = (typeof CALIDAD_TABS)[number]["id"];

/** Calidad — graneles del día y salidas pendientes con aprobar/rechazar. */
export function CalidadOperationalView() {
  const workspace = useRequiredWorkspace();
  const { getQualityStatus, approveQualityItem, rejectQualityItem, refreshDecisions } =
    useOperationalStore();
  const { data, loading, error, lastRefreshAt, refresh } = useOperationalPlan("CALIDAD");
  const [activeTab, setActiveTab] = useState<CalidadTabId>("elaboracion");

  const qualityItems = useMemo(() => {
    const seed = data?.qualityItems ?? [];
    return applyQualityDecisionsToItems(seed, getQualityStatus);
  }, [data?.qualityItems, getQualityStatus]);

  const granelesHoy = useMemo(() => {
    const graneles = filterQualityByKind(qualityItems, "granel");
    const today = filterQualityToday(graneles);
    return today.filter((item) => item.status === "pendiente");
  }, [qualityItems]);

  const salidasPendientes = useMemo(() => {
    const salidas = filterQualityByKind(qualityItems, "salida");
    return salidas.filter((item) => item.status === "pendiente");
  }, [qualityItems]);

  const handleApprove = useCallback(
    (item: QualityItem) => {
      approveQualityItem(item.id, workspace.context.displayName);
      refreshDecisions();
      refresh();
    },
    [
      approveQualityItem,
      refreshDecisions,
      refresh,
      workspace.context.displayName,
    ]
  );

  const handleReject = useCallback(
    (item: QualityItem) => {
      rejectQualityItem(item.id, workspace.context.displayName);
      refreshDecisions();
      refresh();
    },
    [
      rejectQualityItem,
      refreshDecisions,
      refresh,
      workspace.context.displayName,
    ]
  );

  const granelColumns: OperationalTableColumn<QualityItem>[] = useMemo(
    () => [
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
        render: (row) => <span className="font-mono text-xs">{displayField(row.oe)}</span>,
      },
      {
        key: "status",
        header: "Estado",
        render: (row) => <StatusChip status={row.status} />,
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
    ],
    [handleApprove, handleReject]
  );

  const salidaColumns: OperationalTableColumn<QualityItem>[] = useMemo(
    () => [
      { key: "line", header: "Línea", render: (row) => displayField(row.line) },
      { key: "product", header: "Producto", render: (row) => displayField(row.product) },
      { key: "client", header: "Cliente", render: (row) => displayField(row.client) },
      { key: "quantity", header: "Cantidad", render: (row) => displayField(row.quantity) },
      {
        key: "oa",
        header: "OA",
        render: (row) => <span className="font-mono text-xs">{displayField(row.oa)}</span>,
      },
      {
        key: "status",
        header: "Estado",
        render: (row) => <StatusChip status={row.status} />,
      },
      {
        key: "actions",
        header: "Acciones",
        render: (row) =>
          row.status === "pendiente" ? (
            <div className="flex flex-wrap gap-2">
              <ActionButton
                label="Aprobar salida"
                variant="approve"
                onClick={() => handleApprove(row)}
              />
              <ActionButton
                label="Rechazar salida"
                variant="reject"
                onClick={() => handleReject(row)}
              />
            </div>
          ) : (
            <span className="text-xs text-[var(--os-text-muted)]">—</span>
          ),
      },
    ],
    [handleApprove, handleReject]
  );

  const tabs = CALIDAD_TABS.map((tab) => ({
    ...tab,
    count: tab.id === "elaboracion" ? granelesHoy.length : salidasPendientes.length,
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
            rows={granelesHoy}
            rowKey={(row) => row.id}
            emptyMessage="Sin graneles pendientes para hoy."
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
