"use client";

import { useMemo, useState } from "react";
import { TwinShell } from "@/features/os/shell/twin-shell";
import { useRequiredWorkspace } from "@/features/os/workspace/workspace-provider";
import { usePreviewContext } from "@/features/os/session/preview-context";
import { buildProductionOverview } from "@/lib/operational/build-production-overview";
import { displayField } from "@/lib/operational/display-fields";
import { SECTOR_LABELS } from "@/types/operational/sector";
import { applyQualityDecisionsToItems } from "../adapters/operational-sheets-adapter";
import {
  OperationalTabs,
  OperationalTable,
  StatusChip,
  SyncStatusBar,
  type OperationalTableColumn,
} from "../components/operational-ui";
import { useOperationalPlan } from "../hooks/use-operational-plan";
import {
  filterQualityByStatus,
  filterWorkItemsPendingElaboracion,
  filterWorkItemsPendingEnvasado,
  formatQuantity,
} from "../lib/operational-filters";
import { useOperationalStore } from "../store/operational-store-context";
import type { QualityItem } from "../types";
import type { WorkItem } from "@/types/operational/work-item";

const PRODUCCION_TABS = [
  { id: "rechazados", label: "Rechazados" },
  { id: "aprobados", label: "Aprobados" },
  { id: "elaboracion", label: "Elaboración" },
  { id: "envasados", label: "Envasados" },
  { id: "kpis", label: "KPIs completos" },
] as const;

type ProduccionTabId = (typeof PRODUCCION_TABS)[number]["id"];

/** Producción / Supervisión — visión general con 5 pestañas operativas. */
export function ProduccionOperationalView() {
  const workspace = useRequiredWorkspace();
  const { applyEffectiveStatus } = usePreviewContext();
  const { getQualityStatus } = useOperationalStore();
  const { data, loading, error, lastRefreshAt, refresh } = useOperationalPlan("PRODUCCION");
  const [activeTab, setActiveTab] = useState<ProduccionTabId>("elaboracion");

  const workItems = useMemo(
    () => applyEffectiveStatus(data?.workItems ?? []),
    [data?.workItems, applyEffectiveStatus]
  );

  const qualityItems = useMemo(() => {
    const seed = data?.qualityItems ?? [];
    return applyQualityDecisionsToItems(seed, getQualityStatus);
  }, [data?.qualityItems, getQualityStatus]);

  const rechazados = useMemo(
    () => filterQualityByStatus(qualityItems, "rechazado"),
    [qualityItems]
  );
  const aprobados = useMemo(
    () => filterQualityByStatus(qualityItems, "aprobado"),
    [qualityItems]
  );
  const pendienteElaboracion = useMemo(
    () => filterWorkItemsPendingElaboracion(workItems),
    [workItems]
  );
  const pendienteEnvasado = useMemo(
    () => filterWorkItemsPendingEnvasado(workItems),
    [workItems]
  );
  const overview = useMemo(
    () => buildProductionOverview(workItems, data?.source === "drive" ? "semanas_2026" : "semanas_2026"),
    [workItems, data?.source]
  );

  const qualityColumns: OperationalTableColumn<QualityItem>[] = useMemo(
    () => [
      {
        key: "kind",
        header: "Tipo",
        render: (row) => (row.kind === "granel" ? "Granel" : "Salida"),
      },
      {
        key: "ref",
        header: "Ref",
        render: (row) => (
          <span className="font-mono text-xs">
            {displayField(row.lote ?? row.oa ?? row.oe)}
          </span>
        ),
      },
      { key: "product", header: "Producto", render: (row) => displayField(row.product) },
      { key: "client", header: "Cliente", render: (row) => displayField(row.client) },
      {
        key: "status",
        header: "Estado",
        render: (row) => <StatusChip status={row.status} />,
      },
    ],
    []
  );

  const workColumns: OperationalTableColumn<WorkItem>[] = useMemo(
    () => [
      {
        key: "sector",
        header: "Sector",
        render: (row) => SECTOR_LABELS[row.sector],
      },
      {
        key: "line",
        header: "Línea / Resp.",
        render: (row) => displayField(row.line ?? row.ownerPerson),
      },
      { key: "client", header: "Cliente", render: (row) => displayField(row.client) },
      {
        key: "product",
        header: "Producto",
        render: (row) => displayField(row.product),
      },
      {
        key: "quantity",
        header: "Cant.",
        render: (row) => formatQuantity(row),
      },
      {
        key: "status",
        header: "Estado",
        render: (row) => <StatusChip status={row.status} />,
      },
    ],
    []
  );

  const tabs = PRODUCCION_TABS.map((tab) => {
    let count: number | undefined;
    switch (tab.id) {
      case "rechazados":
        count = rechazados.length;
        break;
      case "aprobados":
        count = aprobados.length;
        break;
      case "elaboracion":
        count = pendienteElaboracion.length;
        break;
      case "envasados":
        count = pendienteEnvasado.length;
        break;
      default:
        count = undefined;
    }
    return { ...tab, count };
  });

  return (
    <TwinShell title="Producción">
      <header className="mb-6 space-y-2">
        <h2 className="text-2xl font-semibold tracking-tight">Supervisión de planta</h2>
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

      <OperationalTabs
        tabs={tabs}
        activeId={activeTab}
        onChange={(id) => setActiveTab(id as ProduccionTabId)}
      />

      <div className="mt-4">
        {activeTab === "rechazados" && (
          <OperationalTable
            columns={qualityColumns}
            rows={rechazados}
            rowKey={(row) => row.id}
            emptyMessage="Sin rechazos registrados."
          />
        )}
        {activeTab === "aprobados" && (
          <OperationalTable
            columns={qualityColumns}
            rows={aprobados}
            rowKey={(row) => row.id}
            emptyMessage="Sin aprobaciones registradas."
          />
        )}
        {activeTab === "elaboracion" && (
          <OperationalTable
            columns={workColumns}
            rows={pendienteElaboracion}
            rowKey={(row) => row.id}
            emptyMessage="Sin elaboraciones pendientes."
          />
        )}
        {activeTab === "envasados" && (
          <OperationalTable
            columns={workColumns}
            rows={pendienteEnvasado}
            rowKey={(row) => row.id}
            emptyMessage="Sin envasados pendientes."
          />
        )}
        {activeTab === "kpis" && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <KpiCard label="Total WorkItems" value={workItems.length} />
            <KpiCard label="Bloqueos" value={overview.blockers.length} />
            <KpiCard
              label="Sectores activos"
              value={overview.sectors?.length ?? 0}
            />
            {overview.priorities &&
              Object.entries(overview.priorities).map(([priority, count]) => (
                <KpiCard key={priority} label={`Prioridad ${priority}`} value={count} />
              ))}
            {overview.load &&
              Object.entries(overview.load).map(([sector, count]) => (
                <KpiCard
                  key={sector}
                  label={`Carga ${SECTOR_LABELS[sector as keyof typeof SECTOR_LABELS] ?? sector}`}
                  value={count}
                />
              ))}
          </div>
        )}
      </div>
    </TwinShell>
  );
}

function KpiCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-[var(--os-radius-sm)] border border-[var(--os-border)] bg-[var(--os-surface)] px-4 py-5">
      <p className="text-xs font-medium uppercase tracking-wide text-[var(--os-text-muted)]">
        {label}
      </p>
      <p className="mt-2 text-3xl font-semibold tabular-nums text-[var(--os-text)]">{value}</p>
    </div>
  );
}
