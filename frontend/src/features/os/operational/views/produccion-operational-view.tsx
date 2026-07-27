"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { TwinShell } from "@/features/os/shell/twin-shell";
import { useRequiredWorkspace } from "@/features/os/workspace/workspace-provider";
import { usePreviewContext, usePreviewSession } from "@/features/os/session/preview-context";
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
  filterWorkItemsPendingElaboracion,
  filterWorkItemsPendingEnvasado,
  filterWorkItemsTransferredElaboracion,
  filterWorkItemsTransferredEnvasado,
  formatQuantity,
} from "../lib/operational-filters";
import { isWorkTransferredStatus, WORK_TRANSFER } from "../lib/work-transfer-labels";
import { useOperationalStore } from "../store/operational-store-context";
import type { QualityItem } from "../types";
import type { WorkItem } from "@/types/operational/work-item";
import { Button } from "@/components/ui/button";
import {
  collectSameClientDateApprovedPackaging,
  isPackagingQualityItem,
} from "@/lib/remitos/from-quality";
import {
  buildComposeLinesFromQuality,
  composeLineToApprovalInput,
  producedVsBoxedWarning,
  type RemitoComposeLine,
} from "@/lib/remitos/compose-from-quality";
import {
  generateRemitoApi,
  remitoStatusForWorkApi,
  upsertRemitoDraftApi,
} from "@/lib/remitos/remitos-client";
import type { RemitoWorkItemStatus } from "@/lib/remitos/types";
import { RemitoComposeEditor } from "../components/remito-compose-editor";

const PRODUCCION_TABS = [
  { id: "rechazados", label: "Rechazados" },
  { id: "aprobados", label: "Aprobados" },
  { id: "elaboracion", label: "Elaboración" },
  { id: "envasados", label: "Envasados" },
  { id: "kpis", label: "KPIs completos" },
] as const;

type ProduccionTabId = (typeof PRODUCCION_TABS)[number]["id"];

interface ProduccionOperationalViewProps {
  /** Native: CTA para ir a crear/abrir semana de planificación. */
  onCreateWeek?: () => void;
}

function sortWorkItemsTransferredFirst(items: WorkItem[]): WorkItem[] {
  return [...items].sort((a, b) => {
    const aTransferred = isWorkTransferredStatus(a.status) ? 1 : 0;
    const bTransferred = isWorkTransferredStatus(b.status) ? 1 : 0;
    if (bTransferred !== aTransferred) return bTransferred - aTransferred;
    return (a.product ?? "").localeCompare(b.product ?? "", "es", { sensitivity: "base" });
  });
}

function workIdFromQuality(item: QualityItem): string {
  return (
    item.relatedWorkItemId?.trim() ||
    (item.id.startsWith("qc:") ? item.id.slice(3) : item.id)
  );
}

/** Producción / Supervisión — visión general con actividad cross-sector. */
export function ProduccionOperationalView({
  onCreateWeek,
}: ProduccionOperationalViewProps = {}) {
  const workspace = useRequiredWorkspace();
  const { applyEffectiveStatus, navigateTo } = usePreviewContext();
  const { email, sectorId } = usePreviewSession();
  const session = useMemo(
    () => ({ email: email ?? "", sector: sectorId }),
    [email, sectorId]
  );
  const {
    getQualityStatus,
    getQualityObservation,
    applyProgressToWorkItems,
    completionEvents,
    decisionMap,
    getFinishedQty,
  } = useOperationalStore();
  const { data, loading, error, lastRefreshAt, updatedAgoLabel, liveConnected } =
    useOperationalPlan("PRODUCCION");
  const [activeTab, setActiveTab] = useState<ProduccionTabId>("elaboracion");
  const [remitoStatusByWork, setRemitoStatusByWork] = useState<
    Record<string, RemitoWorkItemStatus>
  >({});
  const [remitoBusy, setRemitoBusy] = useState(false);
  const [remitoError, setRemitoError] = useState<string | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeLines, setComposeLines] = useState<RemitoComposeLine[]>([]);
  const [composeClient, setComposeClient] = useState("");
  const [composeDate, setComposeDate] = useState("");
  const [displayNameInput, setDisplayNameInput] = useState("");
  const isNativeEmpty =
    data?.source === "native" && !loading && (data.workItems?.length ?? 0) === 0;

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
          decidedBySector: d.decidedBySector,
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
  const transferidoElaboracion = useMemo(
    () => filterWorkItemsTransferredElaboracion(workItems),
    [workItems]
  );
  const elaboracionRows = useMemo(
    () => sortWorkItemsTransferredFirst([...pendienteElaboracion, ...transferidoElaboracion]),
    [pendienteElaboracion, transferidoElaboracion]
  );
  const pendienteEnvasado = useMemo(
    () => filterWorkItemsPendingEnvasado(workItems),
    [workItems]
  );
  const transferidoEnvasado = useMemo(
    () => filterWorkItemsTransferredEnvasado(workItems),
    [workItems]
  );
  const envasadoRows = useMemo(
    () => sortWorkItemsTransferredFirst([...pendienteEnvasado, ...transferidoEnvasado]),
    [pendienteEnvasado, transferidoEnvasado]
  );
  const overview = useMemo(
    () => buildProductionOverview(workItems, data?.source === "drive" ? "semanas_2026" : "semanas_2026"),
    [workItems, data?.source]
  );

  const entregadosCalidad = useMemo(
    () => workItems.filter((item) => isWorkTransferredStatus(item.status)).length,
    [workItems]
  );
  const enCurso = useMemo(
    () => workItems.filter((item) => item.status === "en_curso").length,
    [workItems]
  );

  const refreshRemitoStatuses = useCallback(async () => {
    if (String(sectorId).toUpperCase() !== "PRODUCCION") return;
    const packaging = aprobados.filter(isPackagingQualityItem);
    if (packaging.length === 0) {
      setRemitoStatusByWork({});
      return;
    }
    const next: Record<string, RemitoWorkItemStatus> = {};
    await Promise.all(
      packaging.map(async (item) => {
        const wid = workIdFromQuality(item);
        try {
          next[wid] = await remitoStatusForWorkApi(session, wid);
        } catch {
          next[wid] = { status: "none", remitoId: null };
        }
      })
    );
    setRemitoStatusByWork(next);
  }, [aprobados, sectorId, session]);

  useEffect(() => {
    if (activeTab === "aprobados") void refreshRemitoStatuses();
  }, [activeTab, refreshRemitoStatuses]);

  function handleGenerarRemito(seed: QualityItem) {
    setRemitoError(null);
    const built = buildComposeLinesFromQuality(seed, aprobados, workItems);
    if (built.lines.length === 0) {
      setRemitoError("No hay productos aptos para remito en este grupo.");
      return;
    }
    setComposeLines(built.lines);
    setComposeClient(built.clientDisplay);
    setComposeDate(built.deliveryDate);
    setDisplayNameInput(built.clientDisplay || seed.client || "Remito");
    setComposeOpen(true);
  }

  async function persistComposeLines(): Promise<string> {
    let remitoId: string | null = null;
    for (const line of composeLines) {
      const input = composeLineToApprovalInput(line, composeClient, composeDate);
      const result = await upsertRemitoDraftApi(session, input);
      remitoId = result.remito.id;
    }
    if (!remitoId) throw new Error("No se pudo crear remito.");
    return remitoId;
  }

  async function saveComposeDraft() {
    setRemitoBusy(true);
    setRemitoError(null);
    try {
      await persistComposeLines();
      setComposeOpen(false);
      await refreshRemitoStatuses();
      navigateTo({ view: "remitos" });
    } catch (e) {
      setRemitoError(e instanceof Error ? e.message : "Error al guardar borrador");
    } finally {
      setRemitoBusy(false);
    }
  }

  async function generateComposeExcel() {
    const warning = producedVsBoxedWarning(composeLines);
    if (warning) {
      const ok = window.confirm(
        `${warning}\n\n¿Generar el Excel con las cantidades del editor de todas formas?`
      );
      if (!ok) return;
    }
    setRemitoBusy(true);
    setRemitoError(null);
    try {
      const remitoId = await persistComposeLines();
      await generateRemitoApi(session, remitoId, { displayName: displayNameInput });
      setComposeOpen(false);
      await refreshRemitoStatuses();
      navigateTo({ view: "remitos" });
    } catch (e) {
      setRemitoError(e instanceof Error ? e.message : "No se pudo generar remito");
    } finally {
      setRemitoBusy(false);
    }
  }

  function cancelCompose() {
    // Cancelar sin persistir: no borrador, no metadata, no Blob.
    setComposeOpen(false);
    setComposeLines([]);
    setRemitoError(null);
  }

  function openRemito(status: RemitoWorkItemStatus) {
    if (!status.remitoId) return;
    navigateTo({ view: "remitos" });
  }

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
      {
        key: "remito",
        header: "Remito",
        render: (row) => {
          if (!isPackagingQualityItem(row) || row.status !== "aprobado") {
            return <span className="text-xs text-[var(--os-text-muted)]">—</span>;
          }
          const wid = workIdFromQuality(row);
          const st = remitoStatusByWork[wid] ?? { status: "none" as const, remitoId: null };
          if (st.status === "draft" && st.remitoId) {
            return (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={remitoBusy}
                onClick={() => openRemito(st)}
                data-testid={`remito-open-draft-${wid}`}
              >
                ABRIR BORRADOR DE REMITO
              </Button>
            );
          }
          if (st.status === "generated" && st.remitoId) {
            return (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={remitoBusy}
                onClick={() => openRemito(st)}
                data-testid={`remito-ver-${wid}`}
              >
                VER REMITO
              </Button>
            );
          }
          return (
            <div className="flex max-w-[12rem] flex-col gap-1">
              <Button
                type="button"
                size="sm"
                disabled={remitoBusy}
                onClick={() => handleGenerarRemito(row)}
                data-testid={`remito-generar-${wid}`}
              >
                GENERAR REMITO
              </Button>
              {(() => {
                const n = collectSameClientDateApprovedPackaging(
                  row,
                  aprobados,
                  workItems
                ).length;
                return n > 1 ? (
                  <span
                    className="text-[10px] text-[var(--os-text-muted)]"
                    data-testid={`remito-group-hint-${wid}`}
                  >
                    {n} productos agrupados (mismo cliente y fecha)
                  </span>
                ) : (
                  <span className="text-[10px] text-[var(--os-text-muted)]">
                    Apto para remito
                  </span>
                );
              })()}
            </div>
          );
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handlers use latest closures
    [getQualityObservation, remitoBusy, remitoStatusByWork, aprobados, workItems]
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
        header: "Planif.",
        render: (row) => formatQuantity(row),
      },
      {
        key: "finished",
        header: "Terminadas",
        render: (row) => displayField(getFinishedQty(row.id) || row.finishedQty),
      },
      {
        key: "status",
        header: "Estado",
        render: (row) => (
          <StatusChip
            status={row.status}
            transferredInbox={isWorkTransferredStatus(row.status)}
          />
        ),
      },
    ],
    [getFinishedQty]
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
        <h2 className="text-2xl font-semibold tracking-tight">
          Hola, {workspace.context.displayName}
        </h2>
        <p className="text-sm text-[var(--os-text-muted)]">
          Supervisión de planta · {workspace.context.jobTitle}
        </p>
        <SyncStatusBar
          source={data?.source ?? "demo"}
          lastRefreshAt={lastRefreshAt}
          updatedAgoLabel={updatedAgoLabel}
          liveConnected={liveConnected}
          loading={loading}
          detailMessage={data?.source === "native" ? null : data?.message}
        />
      </header>

      {isNativeEmpty && (
        <div className="mb-6 rounded-[var(--os-radius)] border border-[var(--os-border)] bg-[var(--os-surface)] px-5 py-6">
          <p className="text-sm text-[var(--os-text)]">
            {data?.message ?? "Todavía no hay una planificación publicada."}
          </p>
          {onCreateWeek && (
            <button
              type="button"
              className="mt-4 rounded bg-[var(--os-teal)] px-4 py-2 text-sm font-medium text-white"
              onClick={onCreateWeek}
            >
              Crear semana
            </button>
          )}
        </div>
      )}

      {completionEvents.length > 0 && (
        <div className="mb-4">
          <OperationalActivityFeed entries={activityFeed} />
        </div>
      )}

      {error && (
        <div className="mb-4 rounded border border-[var(--genus-error)]/25 bg-[var(--genus-error-soft)] px-4 py-3 text-sm text-[var(--genus-error)]">
          {error}
        </div>
      )}
      {remitoError && (
        <div className="mb-4 rounded border border-[var(--genus-warning)]/25 bg-[var(--genus-warning-soft)] px-4 py-3 text-sm text-[var(--genus-warning)]">
          {remitoError}
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
            columns={qualityColumns.filter((c) => c.key !== "remito")}
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
            {transferidoElaboracion.length > 0 && (
              <p className="mb-3 text-sm text-[var(--os-text-muted)]">
                {transferidoElaboracion.length} elaboración
                {transferidoElaboracion.length === 1 ? "" : "es"}{" "}
                {WORK_TRANSFER.deliveredToQuality.toLowerCase()} —{" "}
                {WORK_TRANSFER.pendingReview.toLowerCase()}.
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
            {transferidoEnvasado.length > 0 && (
              <p className="mb-3 text-sm text-[var(--os-text-muted)]">
                {transferidoEnvasado.length} envasado
                {transferidoEnvasado.length === 1 ? "" : "s"}{" "}
                {WORK_TRANSFER.deliveredToQuality.toLowerCase()} —{" "}
                {WORK_TRANSFER.pendingReview.toLowerCase()}.
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
            <div className="rounded-[var(--os-radius-sm)] border border-[var(--genus-warning)]/25 bg-[var(--genus-warning-soft)] px-4 py-3 text-sm text-[var(--genus-warning)]">
              <strong>KPIs provisorios</strong> — calculados desde datos disponibles (SEMANAS +
              acciones locales). Pendiente conexión a pestaña <strong>DASHBOARD</strong> real en
              PEDIDOS 2026.
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <KpiCard label="Total trabajos en plan" value={workItems.length} />
              <KpiCard label={WORK_TRANSFER.kpiDeliveredToQuality} value={entregadosCalidad} />
              <KpiCard label="En curso" value={enCurso} />
              <KpiCard label="Transferencias en bandeja Calidad" value={completionEvents.length} />
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

      {composeOpen ? (
        <RemitoComposeEditor
          title="Generar remito"
          lines={composeLines}
          onChangeLines={setComposeLines}
          clientDisplay={composeClient}
          onClientChange={setComposeClient}
          deliveryDate={composeDate}
          onDeliveryDateChange={setComposeDate}
          displayName={displayNameInput}
          onDisplayNameChange={setDisplayNameInput}
          busy={remitoBusy}
          error={remitoError}
          onCancel={cancelCompose}
          onSaveDraft={() => void saveComposeDraft()}
          onGenerateExcel={() => void generateComposeExcel()}
        />
      ) : null}
    </TwinShell>
  );
}

function KpiCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-[var(--os-radius-sm)] border border-[var(--os-border)] bg-[var(--os-surface)] px-4 py-5">
      <p className="text-xs uppercase tracking-wide text-[var(--os-text-muted)]">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}
