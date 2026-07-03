"use client";

import { useMemo, useState } from "react";
import { TwinShell } from "@/features/os/shell/twin-shell";
import { useRequiredWorkspace } from "@/features/os/workspace/workspace-provider";
import { usePreviewContext } from "@/features/os/session/preview-context";
import { buildProductionOverview } from "@/lib/operational/build-production-overview";
import { displayField } from "@/lib/operational/display-fields";
import { SECTOR_LABELS } from "@/types/operational/sector";
import { applyQualityDecisionsToItems } from "../adapters/operational-sheets-adapter";
import { OperationalActivityFeed } from "../components/operational-activity-feed";
import {
  OperationalTabs,
  OperationalTable,
  StatusChip,
  SyncStatusBar,
  type OperationalTableColumn,
} from "../components/operational-ui";
import { useOperationalPlan } from "../hooks/use-operational-plan";
import { buildOperationalActivityFeed } from "../lib/completion-events";
import {
  filterQualityByStatus,
  filterWorkItemsCompletedElaboracion,
  filterWorkItemsCompletedEnvasado,
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

function sortWorkItemsCompletedFirst(items: WorkItem[]): WorkItem[] {
  return [...items].sort((a, b) => {
    const aDone = a.status === "completo" ? 1 : 0;
    const bDone = b.status === "completo" ? 1 : 0;
    if (bDone !== aDone) return bDone - aDone;
    return (a.product ?? "").localeCompare(b.product ?? "", "es", { sensitivity: "base" });
  });
}

/** Producción / Supervisión — visión general con actividad cross-sector. */
export function ProduccionOperationalView() {
  const workspace = useRequiredWorkspace();
  const { applyEffectiveStatus } = usePreviewContext();
  const {
    getQualityStatus,
    getQualityObservation,
    applyProgressToWorkItems,
    completionEvents,
    decisionMap,
  } = useOperationalStore();
  const { data, loading, error, lastRefreshAt, refresh } = useOperationalPlan("PRODUCCION");
  const [activeTab, setActiveTab] = useState<ProduccionTabId>("elaboracion");

  const workItems = useMemo(() => {
    const base = applyEffectiveStatus(data?.workItems ?? []);
    return applyProgressToWorkItems(base);
  }, [data?.workItems, applyEffectiveStatus, applyProgressToWorkItems]);

  const qualityItems = useMemo(() => {
    const seed = data?.qualityItems ?? [];
    return applyQualityDecisionsToItems(seed, getQualityStatus);
  }, [data?.qualityItems, getQualityStatus]);

  const qualityLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of qualityItems) {
      map.set(item.id, item.product);
    }
    return map;
  }, [qualityItems]);

  const activityFeed = useMemo(
    () =>
      buildOperationalActivityFeed({
        completions: completionEvents,
        decisions: Object.values(decisionMap).map((d) => ({
          itemId: d.itemId,
          status: d.status,
          decidedAt: d.decidedAt,
          decidedBy: d.decidedBy,
          observation: d.observation,
          label: qualityLabelById.get(d.itemId) ?? d.itemId,
        })),
      }),
    [completionEvents, decisionMap, qualityLabelById]
  );

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
  const terminadoElaboracion = useMemo(
    () => filterWorkItemsCompletedElaboracion(workItems),
    [workItems]
  );
  const elaboracionRows = useMemo(
    () => sortWorkItemsCompletedFirst([...pendienteElaboracion, ...terminadoElaboracion]),
    [pendienteElaboracion, terminadoElaboracion]
  );
  const pendienteEnvasado = useMemo(
    () => filterWorkItemsPendingEnvasado(workItems),
    [workItems]
  );
  const terminadoEnvasado = useMemo(
    () => filterWorkItemsCompletedEnvasado(workItems),
    [workItems]
  );
  const envasadoRows = useMemo(
    () => sortWorkItemsCompletedFirst([...pendienteEnvasado, ...terminadoEnvasado]),
    [pendienteEnvasado, terminadoEnvasado]
  );
  const overview = useMemo(
    () => buildProductionOverview(workItems, data?.source === "drive" ? "semanas_2026" : "semanas_2026"),
    [workItems, data?.source]
  );

  const completados = useMemo(
    () => workItems.filter((item) => item.status === "completo").length,
    [workItems]
  );
  const enCurso = useMemo(
    () => workItems.filter((item) => item.status === "en_curso").length,
    [workItems]
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
      {
        key: "observation",
        header: "Observación",
        render: (row) => (
          <span className="text-sm text-[var(--os-text-muted)]">
            {displayField(getQualityObservation(row.id))}
          </span>
        ),
      },
    ],
    [getQualityObservation]
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
        count = elaboracionRows.length;
        break;
      case "envasados":
        count = envasadoRows.length;
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

      {completionEvents.length > 0 && (
        <div className="mb-4">
          <OperationalActivityFeed entries={activityFeed} />
        </div>
      )}

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
          <>
            {terminadoElaboracion.length > 0 && (
              <p className="mb-3 text-sm text-[var(--os-text-muted)]">
                {terminadoElaboracion.length} elaboración
                {terminadoElaboracion.length === 1 ? "" : "es"} terminada
                {terminadoElaboracion.length === 1 ? "" : "s"} — pendiente revisión Calidad.
              </p>
            )}
            <OperationalTable
              columns={workColumns}
              rows={elaboracionRows}
              rowKey={(row) => row.id}
              emptyMessage="Sin elaboraciones en plan."
            />
          </>
        )}
        {activeTab === "envasados" && (
          <>
            {terminadoEnvasado.length > 0 && (
              <p className="mb-3 text-sm text-[var(--os-text-muted)]">
                {terminadoEnvasado.length} envasado
                {terminadoEnvasado.length === 1 ? "" : "s"} terminado
                {terminadoEnvasado.length === 1 ? "" : "s"} — pendiente revisión Calidad.
              </p>
            )}
            <OperationalTable
              columns={workColumns}
              rows={envasadoRows}
              rowKey={(row) => row.id}
              emptyMessage="Sin envasados en plan."
            />
          </>
        )}
        {activeTab === "kpis" && (
          <div className="space-y-4">
            <div className="rounded-[var(--os-radius-sm)] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
              <strong>KPIs provisorios</strong> — calculados desde datos disponibles (SEMANAS +
              acciones locales). Pendiente conexión a pestaña <strong>DASHBOARD</strong> real en
              PEDIDOS 2026.
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <KpiCard label="Total trabajos en plan" value={workItems.length} />
              <KpiCard label="Completados" value={completados} />
              <KpiCard label="En curso" value={enCurso} />
              <KpiCard label="Terminados notificados" value={completionEvents.length} />
              <KpiCard label="Aprobados calidad" value={aprobados.length} />
              <KpiCard label="Rechazados calidad" value={rechazados.length} />
              <KpiCard label="Bloqueos" value={overview.blockers.length} />
              <KpiCard label="Sectores activos" value={overview.sectors?.length ?? 0} />
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
