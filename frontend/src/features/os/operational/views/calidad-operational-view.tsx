"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TwinShell } from "@/features/os/shell/twin-shell";
import { useRequiredWorkspace } from "@/features/os/workspace/workspace-provider";
import { usePreviewContext, usePreviewSession } from "@/features/os/session/preview-context";
import { displayField } from "@/lib/operational/display-fields";
import {
  formatOperationalIdCompact,
  formatOperationalIdFull,
} from "@/lib/orders/format-operational-id";
import { SECTOR_LABELS } from "@/types/operational/sector";
import { Button } from "@/components/ui/button";
import {
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerBody,
  DrawerCloseButton,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { getLatestDocumentByRef } from "../adapters/order-documents-repository";
import { pushNotification } from "@/features/os/feedback/notifications-store";
import { applyQualityDecisionsToItems } from "../adapters/operational-sheets-adapter";
import {
  OperationalTabs,
  OperationalTable,
  StatusChip,
  SyncStatusBar,
  type OperationalTableColumn,
} from "../components/operational-ui";
import { DeliveryDateBadge } from "../components/delivery-date-badge";
import { useRemitoAprobadosActions } from "../components/remito-aprobados-actions";
import { useOperationalPlan } from "../hooks/use-operational-plan";
import { filterQualityByKind, filterQualityByStatus } from "../lib/operational-filters";
import {
  canDecideQuality,
  QUALITY_DECISION_DENIED_MESSAGE,
} from "../lib/quality-decision-rbac";
import { WORK_TRANSFER } from "../lib/work-transfer-labels";
import { useOperationalStore } from "../store/operational-store-context";
import type { QualityItem } from "../types";
import { canAccessRemitos } from "@/lib/remitos/types";
import { isPackagingQualityItem } from "@/lib/remitos/from-quality";
import { CodificadoTracePanel } from "../components/codificado-trace-panel";
import { WorkItemWarningBadge } from "../components/work-item-warning-badge";
import { useListSelectionMode } from "../components/list-selection-mode";
import { getWorkItemWarnings } from "@/lib/planning/work-item-warnings";
import { resolveWorkItemForQualityItem } from "../lib/resolve-quality-work-item";
import type { QualityBatchItemResult } from "../types";
import { FormulasAdminPanel } from "../components/formulas-admin-panel";
import { LifecycleRowActions } from "../components/lifecycle-row-actions";
import { syntheticLifecycleItem } from "../components/lifecycle-synthetic";
import { normalizeOptionalReason } from "@/lib/lifecycle";
import { postReworkWork } from "@/lib/api/live-sync-client";
import { SortSelect } from "../components/sort-select";
import { useSortPreference } from "../lib/use-sort-preference";
import {
  applySort,
  compareDates,
  compareNumericField,
  compareStrings,
  type SortOption,
} from "@/lib/sorting/sort-contract";

/**
 * Aprobados/Rechazados son un archivo histórico de decisiones ya tomadas —
 * sin límite de crecimiento y, hasta ahora, sin ningún ordenamiento
 * seleccionable (usaban sortReceivedFirst, la misma heurística de
 * prioridad de cola pensada para Pendientes, que no tiene sentido en un
 * archivo ya resuelto). Default: más recientes primero (fecha de decisión).
 */
export const CALIDAD_DECISION_SORT_OPTIONS: SortOption<QualityItem>[] = [
  {
    key: "completado_desc",
    label: "Más recientes",
    compare: (a, b) => compareDates(a.completedAt, b.completedAt, "desc"),
  },
  {
    key: "completado_asc",
    label: "Más antiguos",
    compare: (a, b) => compareDates(a.completedAt, b.completedAt, "asc"),
  },
  {
    key: "producto_asc",
    label: "Producto A-Z",
    compare: (a, b) => compareStrings(a.product, b.product, "asc"),
  },
  {
    key: "producto_desc",
    label: "Producto Z-A",
    compare: (a, b) => compareStrings(a.product, b.product, "desc"),
  },
  {
    key: "cliente_asc",
    label: "Cliente A-Z",
    compare: (a, b) => compareStrings(a.client, b.client, "asc"),
  },
  {
    key: "cliente_desc",
    label: "Cliente Z-A",
    compare: (a, b) => compareStrings(a.client, b.client, "desc"),
  },
  {
    key: "cantidad_desc",
    label: "Cantidad mayor a menor",
    compare: (a, b) => compareNumericField(a.quantity, b.quantity, "desc"),
  },
  {
    key: "cantidad_asc",
    label: "Cantidad menor a mayor",
    compare: (a, b) => compareNumericField(a.quantity, b.quantity, "asc"),
  },
  {
    key: "entrega_asc",
    label: "Entrega más próxima",
    compare: (a, b) => compareDates(a.deliveryDate, b.deliveryDate, "asc"),
  },
];
const CALIDAD_DECISION_SORT_KEYS = CALIDAD_DECISION_SORT_OPTIONS.map((o) => o.key);

const TOP_TABS = [
  { id: "pendientes", label: "Pendientes" },
  { id: "aprobados", label: "Aprobados" },
  { id: "rechazados", label: "Rechazados" },
] as const;

type TopTabId = (typeof TOP_TABS)[number]["id"];

const PENDING_SUB_TABS = [
  { id: "elaboracion", label: "Elaboraciones" },
  { id: "acondicionamiento", label: "Envasados" },
] as const;

type PendingSubTabId = (typeof PENDING_SUB_TABS)[number]["id"];

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

interface CalidadOperationalViewProps {
  initialTab?: TopTabId;
}

/** Calidad — Pendientes (Elaboraciones/Envasados) · Aprobados · Rechazados. */
export function CalidadOperationalView({ initialTab = "pendientes" }: CalidadOperationalViewProps) {
  const workspace = useRequiredWorkspace();
  const { sectorId, email } = usePreviewSession();
  const { showToast } = usePreviewContext();
  const canDecide = canDecideQuality(sectorId);
  const {
    getQualityStatus,
    getQualityObservation,
    approveQualityItem,
    rejectQualityItem,
    annulQualityItem,
    approveQualityItemsBatch,
    progressMap,
  } = useOperationalStore();
  const { data, loading, error, lastRefreshAt, updatedAgoLabel, liveConnected, refresh } =
    useOperationalPlan("CALIDAD");
  const [topTab, setTopTab] = useState<TopTabId>(initialTab);
  const [subTab, setSubTab] = useState<PendingSubTabId>("elaboracion");
  const [reviewItem, setReviewItem] = useState<QualityItem | null>(null);
  const [calidadObservation, setCalidadObservation] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [showRejectField, setShowRejectField] = useState(false);
  const [rejectError, setRejectError] = useState<string | null>(null);
  const [confirmApprove, setConfirmApprove] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showReworkField, setShowReworkField] = useState(false);
  const [reworkReason, setReworkReason] = useState("");
  const [reworkBusy, setReworkBusy] = useState(false);
  const [annulTarget, setAnnulTarget] = useState<QualityItem | null>(null);
  const [annulReason, setAnnulReason] = useState("");
  const [annulError, setAnnulError] = useState<string | null>(null);
  const formulaSession = useMemo(
    () => ({ email: email ?? "", sector: sectorId }),
    [email, sectorId]
  );

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

  /**
   * Selección múltiple para aprobación masiva — reusa useListSelectionMode
   * (mismo mecanismo que las otras pantallas con selección) forzado siempre
   * activo (nunca hay un botón "Entrar en modo selección" acá: el checkbox
   * de cada fila ya está siempre disponible para Calidad). SOLO sobre los
   * registros efectivamente visibles en la sub-pestaña actual (Elaboraciones
   * o Envasados) — el propio hook recorta la selección cada vez que
   * `currentVisibleIds` cambia (cambio de sub-pestaña, filtro o un ítem que
   * deja de estar pendiente), nunca arrastra selección invisible.
   */
  const currentPendingList = subTab === "elaboracion" ? granelesPendientes : salidasPendientes;
  const currentVisibleIds = useMemo(
    () => currentPendingList.map((row) => row.id),
    [currentPendingList]
  );
  const sel = useListSelectionMode(currentVisibleIds);
  const {
    active: selectionActive,
    enter: enterSelection,
    isSelected: isRowSelected,
    toggle: toggleRow,
    selectAllVisible,
    deselectAll,
    selectedIds: selectedIdSet,
  } = sel;
  useEffect(() => {
    if (!selectionActive) enterSelection();
  }, [selectionActive, enterSelection]);

  const allVisibleSelected =
    currentVisibleIds.length > 0 && currentVisibleIds.every((id) => isRowSelected(id));
  const someVisibleSelected = currentVisibleIds.some((id) => isRowSelected(id));
  const selectAllCheckboxRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (selectAllCheckboxRef.current) {
      selectAllCheckboxRef.current.indeterminate = someVisibleSelected && !allVisibleSelected;
    }
  }, [someVisibleSelected, allVisibleSelected]);

  const selectedQualityItems = useMemo(
    () => currentPendingList.filter((row) => selectedIdSet.has(row.id)),
    [currentPendingList, selectedIdSet]
  );

  const [showApproveConfirm, setShowApproveConfirm] = useState(false);
  const [approveBatchBusy, setApproveBatchBusy] = useState(false);
  const [approveBatchError, setApproveBatchError] = useState<string | null>(null);
  const [approveBatchResult, setApproveBatchResult] = useState<QualityBatchItemResult[] | null>(
    null
  );

  const handleApproveBatch = useCallback(async () => {
    if (selectedQualityItems.length === 0) return;
    if (!canDecideQuality(sectorId)) {
      setApproveBatchError(QUALITY_DECISION_DENIED_MESSAGE);
      showToast(QUALITY_DECISION_DENIED_MESSAGE, "info");
      return;
    }
    setApproveBatchBusy(true);
    setApproveBatchError(null);
    const ids = selectedQualityItems.map((row) => row.id);
    const result = await approveQualityItemsBatch(ids, {
      actorSectorId: sectorId,
      decidedBy: workspace.context.displayName,
    });
    setApproveBatchBusy(false);
    if (!result.ok) {
      setApproveBatchError(result.error);
      showToast(result.error, "info");
      return;
    }
    const okCount = result.results.filter((r) => r.status === "ok").length;
    const alreadyCount = result.results.filter((r) => r.status === "already").length;
    const errorCount = result.results.filter((r) => r.status === "error").length;
    // Limpia selección solo de los procesados (ok/already) — los que
    // fallaron quedan seleccionados en Pendientes para reintentar/revisar.
    for (const r of result.results) {
      if (r.status !== "error" && isRowSelected(r.id)) toggleRow(r.id);
    }
    setApproveBatchResult(result.results);
    setShowApproveConfirm(false);
    const parts = [`${okCount} aprobado${okCount === 1 ? "" : "s"}`];
    if (alreadyCount > 0) parts.push(`${alreadyCount} ya estaba${alreadyCount === 1 ? "" : "n"} aprobado${alreadyCount === 1 ? "" : "s"}`);
    if (errorCount > 0) parts.push(`${errorCount} no pudo${errorCount === 1 ? "" : "ieron"} procesarse`);
    showToast(parts.join(" · "));
    await refresh();
  }, [
    selectedQualityItems,
    sectorId,
    approveQualityItemsBatch,
    workspace.context.displayName,
    showToast,
    refresh,
    isRowSelected,
    toggleRow,
  ]);

  const [aprobadosSort, setAprobadosSort] = useSortPreference(
    "calidad-aprobados",
    "completado_desc",
    CALIDAD_DECISION_SORT_KEYS
  );
  const [rechazadosSort, setRechazadosSort] = useSortPreference(
    "calidad-rechazados",
    "completado_desc",
    CALIDAD_DECISION_SORT_KEYS
  );
  const aprobados = useMemo(
    () =>
      applySort(
        filterQualityByStatus(qualityItems, "aprobado"),
        CALIDAD_DECISION_SORT_OPTIONS,
        aprobadosSort
      ),
    [qualityItems, aprobadosSort]
  );
  const rechazados = useMemo(
    () =>
      applySort(
        filterQualityByStatus(qualityItems, "rechazado"),
        CALIDAD_DECISION_SORT_OPTIONS,
        rechazadosSort
      ),
    [qualityItems, rechazadosSort]
  );

  const workItems = useMemo(() => data?.workItems ?? [], [data?.workItems]);

  const selectedItemsWithWarnings = useMemo(
    () =>
      selectedQualityItems.map((row) => {
        const wi = resolveWorkItemForQualityItem(workItems, row);
        return { row, warnings: wi ? getWorkItemWarnings(wi) : [] };
      }),
    [selectedQualityItems, workItems]
  );
  const selectedWithWarningsCount = selectedItemsWithWarnings.filter(
    (x) => x.warnings.length > 0
  ).length;

  const canShowRemitos = canAccessRemitos(sectorId);
  const remitoActions = useRemitoAprobadosActions({
    aprobados,
    workItems,
    enabled: canShowRemitos && topTab === "aprobados",
  });

  const transferidosCount = useMemo(
    () =>
      filterQualityByStatus(qualityItems, "pendiente").filter((item) => item.receivedFrom).length,
    [qualityItems]
  );

  const openReview = useCallback(
    (item: QualityItem) => {
      setReviewItem(item);
      setCalidadObservation(getQualityObservation(item.id) || item.observation || "");
      setRejectReason("");
      setShowRejectField(false);
      setRejectError(null);
      setActionError(null);
      setShowReworkField(false);
      setReworkReason("");
    },
    [getQualityObservation]
  );

  const notifyOrigin = useCallback((item: QualityItem, approved: boolean) => {
    if (!item.receivedFrom) return;
    const sectors = new Set([item.receivedFrom]);
    if (!approved) {
      // Rechazo: Codificado + Envasado de origen si vino vía Codificado
      const progress = progressMap[item.relatedWorkItemId ?? ""];
      if (progress?.viaCodificado) {
        sectors.add("CODIFICADO");
        if (progress.codificadoOriginSector) {
          sectors.add(progress.codificadoOriginSector as typeof item.receivedFrom);
        }
      }
    }
    pushNotification({
      kind: approved ? "calidad_aprobado" : "calidad_rechazado",
      title: approved ? "Calidad aprobó tu trabajo" : "Calidad rechazó tu trabajo",
      message: `${item.product} · ${item.client}${approved ? "" : " — revisá el motivo del rechazo"}`,
      sectors: [...sectors],
    });
  }, [progressMap]);

  const handleApprove = useCallback(async () => {
    if (!reviewItem) return;
    if (!canDecideQuality(sectorId)) {
      setActionError(QUALITY_DECISION_DENIED_MESSAGE);
      showToast(QUALITY_DECISION_DENIED_MESSAGE, "info");
      setConfirmApprove(false);
      return;
    }
    const result = await approveQualityItem(reviewItem.id, {
      actorSectorId: sectorId,
      decidedBy: workspace.context.displayName,
      observation: calidadObservation,
      itemSnapshot: reviewItem,
    });
    if (!result.ok) {
      setActionError(result.error);
      showToast(result.error, "info");
      setConfirmApprove(false);
      return;
    }
    notifyOrigin(reviewItem, true);
    showToast("Trabajo aprobado.");
    setConfirmApprove(false);
    setReviewItem(null);
  }, [
    reviewItem,
    sectorId,
    approveQualityItem,
    workspace.context.displayName,
    calidadObservation,
    notifyOrigin,
    showToast,
  ]);

  const handleReject = useCallback(async () => {
    if (!reviewItem) return;
    if (!canDecideQuality(sectorId)) {
      setActionError(QUALITY_DECISION_DENIED_MESSAGE);
      showToast(QUALITY_DECISION_DENIED_MESSAGE, "info");
      return;
    }
    if (!showRejectField) {
      setShowRejectField(true);
      return;
    }
    const result = await rejectQualityItem(reviewItem.id, {
      actorSectorId: sectorId,
      decidedBy: workspace.context.displayName,
      observation: normalizeOptionalReason(rejectReason),
    });
    if (!result.ok) {
      setActionError(result.error);
      showToast(result.error, "info");
      return;
    }
    notifyOrigin(reviewItem, false);
    showToast("Trabajo rechazado.");
    setReviewItem(null);
  }, [
    reviewItem,
    sectorId,
    showRejectField,
    rejectReason,
    rejectQualityItem,
    workspace.context.displayName,
    notifyOrigin,
    showToast,
  ]);

  /**
   * Rehacer — tercera decisión, distinta de Rechazar: devuelve el trabajo al
   * sector que lo envió (reviewItem.receivedFrom / relatedWorkItemId, ver
   * native-projector.ts#projectQualityItem), editable, sin tocar OA/lote/
   * VTO/historial. Reutiliza el mismo RBAC que Aprobar/Rechazar
   * (quality-decision-rbac.ts) en el servidor.
   */
  const handleRework = useCallback(async () => {
    if (!reviewItem?.relatedWorkItemId) return;
    if (!canDecideQuality(sectorId)) {
      setActionError(QUALITY_DECISION_DENIED_MESSAGE);
      showToast(QUALITY_DECISION_DENIED_MESSAGE, "info");
      return;
    }
    if (!showReworkField) {
      setShowReworkField(true);
      return;
    }
    setReworkBusy(true);
    setActionError(null);
    const response = await postReworkWork({
      itemId: reviewItem.relatedWorkItemId,
      reason: normalizeOptionalReason(reworkReason),
      requestedBy: workspace.context.displayName,
      actorSectorId: sectorId,
    });
    setReworkBusy(false);
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      const message = body.error ?? "No se pudo procesar el Rehacer.";
      setActionError(message);
      showToast(message, "info");
      return;
    }
    showToast(
      `Rehacer solicitado — vuelve a ${reviewItem.receivedFrom ? SECTOR_LABELS[reviewItem.receivedFrom] : "su sector"}.`
    );
    setReviewItem(null);
    await refresh();
  }, [reviewItem, sectorId, showReworkField, reworkReason, workspace.context.displayName, showToast, refresh]);

  const openAnnul = useCallback((item: QualityItem) => {
    setAnnulTarget(item);
    setAnnulReason("");
    setAnnulError(null);
  }, []);

  const handleAnnul = useCallback(async () => {
    if (!annulTarget) return;
    if (!canDecideQuality(sectorId)) {
      setAnnulError(QUALITY_DECISION_DENIED_MESSAGE);
      showToast(QUALITY_DECISION_DENIED_MESSAGE, "info");
      return;
    }
    const result = await annulQualityItem(annulTarget.id, {
      reason: annulReason,
      actorSectorId: sectorId,
      actorName: workspace.context.displayName,
      actorEmail: email ?? undefined,
    });
    if (!result.ok) {
      setAnnulError(result.error);
      showToast(result.error, "info");
      return;
    }
    showToast("Decisión anulada — el trabajo vuelve a Pendientes.");
    setAnnulTarget(null);
    setAnnulReason("");
  }, [
    annulTarget,
    annulReason,
    sectorId,
    email,
    annulQualityItem,
    workspace.context.displayName,
    showToast,
  ]);

  const buildColumns = useCallback(
    (kind: "granel" | "salida"): OperationalTableColumn<QualityItem>[] => {
      const base: OperationalTableColumn<QualityItem>[] =
        kind === "granel"
          ? [
              {
                key: "received",
                header: "Sector de origen",
                hideOnMobile: "xl" as const,
                render: (row) => (
                  <span className="text-xs font-medium text-[var(--os-teal)]">
                    {row.receivedFrom ? SECTOR_LABELS[row.receivedFrom] : "Planilla"}
                  </span>
                ),
              },
              { key: "lote", header: "Lote / Granel", render: (row) => <span className="font-mono text-xs font-medium text-[var(--os-teal)]">{displayField(row.lote)}</span> },
              { key: "product", header: "Producto", render: (row) => displayField(row.product) },
              { key: "client", header: "Cliente", hideOnMobile: "xl" as const, render: (row) => displayField(row.client) },
              { key: "deliveryDate", header: "Fecha de entrega", hideOnMobile: "xl" as const, render: (row) => <DeliveryDateBadge deliveryDate={row.deliveryDate} /> },
              { key: "quantity", header: "Cantidad", hideOnMobile: "xl" as const, render: (row) => displayField(row.quantity) },
              { key: "oe", header: "OE", hideOnMobile: "xl" as const, render: (row) => {
                const raw = displayField(row.oe);
                return (
                  <span className="os-mono-id" title={formatOperationalIdFull(row.oe) || raw}>
                    {formatOperationalIdCompact(row.oe) || raw}
                  </span>
                );
              } },
            ]
          : [
              {
                key: "received",
                header: "Sector de origen",
                hideOnMobile: "xl" as const,
                render: (row) => (
                  <span className="text-xs font-medium text-[var(--os-teal)]">
                    {row.receivedFrom ? SECTOR_LABELS[row.receivedFrom] : "Planilla"}
                    {row.line ? ` · ${row.line}` : ""}
                  </span>
                ),
              },
              { key: "product", header: "Producto", render: (row) => displayField(row.product) },
              { key: "client", header: "Cliente", hideOnMobile: "xl" as const, render: (row) => displayField(row.client) },
              { key: "deliveryDate", header: "Fecha de entrega", hideOnMobile: "xl" as const, render: (row) => <DeliveryDateBadge deliveryDate={row.deliveryDate} /> },
              { key: "quantity", header: "Cantidad", hideOnMobile: "xl" as const, render: (row) => displayField(row.quantity) },
              { key: "oa", header: "OA", hideOnMobile: "xl" as const, render: (row) => {
                const raw = displayField(row.oa);
                return (
                  <span className="os-mono-id" title={formatOperationalIdFull(row.oa) || raw}>
                    {formatOperationalIdCompact(row.oa) || raw}
                  </span>
                );
              } },
            ];

      return [
        ...base,
        { key: "status", header: "Estado", render: (row) => <StatusChip status={row.status} transferredInbox={Boolean(row.receivedFrom)} /> },
        {
          key: "warning",
          header: "",
          render: (row) => {
            const wi = resolveWorkItemForQualityItem(workItems, row);
            return wi ? <WorkItemWarningBadge item={wi} onSelectField={() => openReview(row)} /> : null;
          },
        },
        {
          key: "actions",
          header: "Acción",
          render: (row) =>
            row.status === "pendiente" ? (
              <Button size="sm" variant="secondary" onClick={() => openReview(row)}>
                {canDecide ? "Revisar" : "Ver detalle"}
              </Button>
            ) : (
              <span className="text-xs text-[var(--os-text-muted)]">—</span>
            ),
        },
      ];
    },
    [canDecide, openReview, workItems]
  );

  const granelColumns = useMemo(() => buildColumns("granel"), [buildColumns]);
  const salidaColumns = useMemo(() => buildColumns("salida"), [buildColumns]);

  const decidedColumns = useMemo<OperationalTableColumn<QualityItem>[]>(
    () => [
      {
        key: "tipo",
        header: "Sector de origen",
        render: (row) => (
          <span className="text-xs font-medium text-[var(--os-teal)]">
            {row.receivedFrom ? SECTOR_LABELS[row.receivedFrom] : "Planilla"}
            {row.kind === "salida" && row.line ? ` · ${row.line}` : ""}
          </span>
        ),
      },
      { key: "product", header: "Producto", render: (row) => displayField(row.product) },
      { key: "client", header: "Cliente", render: (row) => displayField(row.client) },
      {
        key: "deliveryDate",
        header: "Fecha de entrega",
        render: (row) => <DeliveryDateBadge deliveryDate={row.deliveryDate} />,
      },
      { key: "quantity", header: "Cantidad", render: (row) => displayField(row.quantity) },
      {
        key: "ref",
        header: "OE / OA",
        render: (row) => (
          <span
            className="os-mono-id"
            title={formatOperationalIdFull(row.kind === "granel" ? row.oe : row.oa) || undefined}
          >
            {formatOperationalIdCompact(row.kind === "granel" ? row.oe : row.oa) ||
              displayField(row.kind === "granel" ? row.oe : row.oa)}
          </span>
        ),
      },
      { key: "status", header: "Estado", render: (row) => <StatusChip status={row.status} /> },
      {
        key: "warning",
        header: "",
        render: (row) => {
          const wi = resolveWorkItemForQualityItem(workItems, row);
          return wi ? <WorkItemWarningBadge item={wi} onSelectField={() => openReview(row)} /> : null;
        },
      },
      {
        key: "obs",
        header: "Observación de Calidad",
        render: (row) => (
          <span className="text-xs text-[var(--os-text-muted)]">
            {displayField(getQualityObservation(row.id))}
          </span>
        ),
      },
      ...(remitoActions.canRemitos && topTab === "aprobados"
        ? [
            {
              key: "remito",
              header: "Remito",
              render: (row: QualityItem) =>
                isPackagingQualityItem(row)
                  ? remitoActions.renderRemitoAction(row)
                  : (
                      <span className="text-xs text-[var(--os-text-muted)]">—</span>
                    ),
            } satisfies OperationalTableColumn<QualityItem>,
          ]
        : []),
      ...(canDecide && (topTab === "aprobados" || topTab === "rechazados")
        ? [
            {
              key: "actions",
              header: "Acciones",
              className: "w-[7.5rem]",
              render: (row: QualityItem) => (
                <LifecycleRowActions
                  items={[
                    syntheticLifecycleItem(
                      "anular",
                      "Anular decisión",
                      "El trabajo volverá a Pendientes. El motivo es opcional."
                    ),
                  ]}
                  onPrimary={() => openReview(row)}
                  primaryLabel="Ver"
                  entityLabel={displayField(row.product)}
                  entityStatus={row.status}
                  onAction={async (_action, reason) => {
                    if (!canDecideQuality(sectorId)) {
                      throw new Error(QUALITY_DECISION_DENIED_MESSAGE);
                    }
                    const result = await annulQualityItem(row.id, {
                      reason,
                      actorSectorId: sectorId,
                      actorName: workspace.context.displayName,
                      actorEmail: email ?? undefined,
                    });
                    if (!result.ok) throw new Error(result.error);
                    showToast("Decisión anulada — el trabajo vuelve a Pendientes.");
                  }}
                />
              ),
            } satisfies OperationalTableColumn<QualityItem>,
          ]
        : []),
    ],
    [
      getQualityObservation,
      remitoActions,
      topTab,
      canDecide,
      openReview,
      sectorId,
      workspace.context.displayName,
      email,
      showToast,
      workItems,
    ]
  );

  const topTabsWithCount = TOP_TABS.map((tab) => ({
    ...tab,
    count:
      tab.id === "pendientes"
        ? granelesPendientes.length + salidasPendientes.length
        : tab.id === "aprobados"
          ? aprobados.length
          : rechazados.length,
  }));

  const reviewDoc = reviewItem
    ? getLatestDocumentByRef(reviewItem.kind === "granel" ? reviewItem.oe : reviewItem.oa)
    : null;
  const reviewWorkItem = reviewItem ? resolveWorkItemForQualityItem(workItems, reviewItem) : null;

  return (
    <TwinShell title="Calidad">
      <header className="mb-6 space-y-2">
        <h2 className="text-2xl font-semibold tracking-tight">
          Hola, {workspace.context.displayName}
        </h2>
        <p className="text-sm text-[var(--os-text-muted)]">
          {canDecide
            ? `Calidad · ${workspace.context.jobTitle}`
            : `Consulta de Calidad · sesión ${SECTOR_LABELS[sectorId] ?? sectorId} (solo lectura)`}
        </p>
        <SyncStatusBar
          source={data?.source ?? "demo"}
          lastRefreshAt={lastRefreshAt}
          updatedAgoLabel={updatedAgoLabel}
          liveConnected={liveConnected}
          loading={loading}
          detailMessage={data?.source === "native" ? null : data?.message}
          onRefresh={refresh}
        />
      </header>

      {!canDecide && (
        <div
          role="status"
          className="mb-4 rounded-[var(--os-radius-sm)] border border-[var(--os-border)] bg-[var(--os-surface)] px-4 py-3 text-sm text-[var(--os-text)]"
        >
          Vista de consulta: podés ver pendientes, aprobados y rechazados. Solo el sector Calidad
          puede aprobar o rechazar.
        </div>
      )}

      {topTab === "pendientes" && transferidosCount > 0 && (
        <div className="mb-4 rounded-[var(--os-radius-sm)] border border-[var(--os-teal)]/30 bg-[var(--os-teal-soft)] px-4 py-3 text-sm text-[var(--os-text)]">
          <strong>{WORK_TRANSFER.inboxBannerTitle}:</strong> {transferidosCount} trabajo
          {transferidosCount === 1 ? "" : "s"} entregado
          {transferidosCount === 1 ? "" : "s"} desde planta — {WORK_TRANSFER.awaitingApproval.toLowerCase()}.
        </div>
      )}

      {error && (
        <div className="mb-4 rounded border border-[var(--genus-error)]/25 bg-[var(--genus-error-soft)] px-4 py-3 text-sm text-[var(--genus-error)]">
          {error}
        </div>
      )}

      <OperationalTabs tabs={topTabsWithCount} activeId={topTab} onChange={(id) => setTopTab(id as TopTabId)} />

      <div className="mt-4">
        {topTab === "pendientes" && (
          <div className="space-y-4">
            <OperationalTabs
              tabs={PENDING_SUB_TABS.map((t) => ({
                ...t,
                count: t.id === "elaboracion" ? granelesPendientes.length : salidasPendientes.length,
              }))}
              activeId={subTab}
              onChange={(id) => setSubTab(id as PendingSubTabId)}
            />
            {approveBatchResult && approveBatchResult.some((r) => r.status === "error") && (
              <div
                className="rounded-[var(--os-radius-sm)] border border-[var(--genus-error)]/25 bg-[var(--genus-error-soft)] px-4 py-3 text-sm text-[var(--genus-error)]"
                data-testid="calidad-batch-result-errors"
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <strong>
                    {approveBatchResult.filter((r) => r.status === "error").length} trabajo
                    {approveBatchResult.filter((r) => r.status === "error").length === 1 ? "" : "s"} no{" "}
                    {approveBatchResult.filter((r) => r.status === "error").length === 1 ? "pudo" : "pudieron"} procesarse:
                  </strong>
                  <button
                    type="button"
                    className="text-xs underline"
                    onClick={() => setApproveBatchResult(null)}
                  >
                    Descartar
                  </button>
                </div>
                <ul className="list-disc space-y-0.5 pl-4">
                  {approveBatchResult
                    .filter((r) => r.status === "error")
                    .map((r) => {
                      const item = qualityItems.find((qi) => qi.id === r.id);
                      return (
                        <li key={r.id}>
                          {item ? displayField(item.product) : r.id}: {r.message}
                        </li>
                      );
                    })}
                </ul>
              </div>
            )}
            {canDecide && (
              <div
                className="flex flex-wrap items-center gap-3 rounded-[var(--os-radius-sm)] border border-[var(--os-border)] bg-[var(--os-surface)] px-3 py-2"
                data-testid="calidad-bulk-toolbar"
              >
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input
                    ref={selectAllCheckboxRef}
                    type="checkbox"
                    className="size-4 accent-[var(--os-teal)]"
                    checked={allVisibleSelected}
                    disabled={currentVisibleIds.length === 0}
                    onChange={() => (allVisibleSelected ? deselectAll() : selectAllVisible())}
                    data-testid="calidad-select-all"
                  />
                  Seleccionar todos
                </label>
                <span className="text-sm text-[var(--os-text-muted)]" data-testid="calidad-selected-count">
                  {selectedQualityItems.length} seleccionado{selectedQualityItems.length === 1 ? "" : "s"}
                </span>
                <Button
                  type="button"
                  size="sm"
                  disabled={selectedQualityItems.length === 0 || approveBatchBusy}
                  onClick={() => setShowApproveConfirm(true)}
                  data-testid="calidad-approve-selected"
                >
                  Aprobar seleccionados
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={selectedQualityItems.length === 0 || approveBatchBusy}
                  onClick={deselectAll}
                >
                  Quitar selección
                </Button>
                {approveBatchError && (
                  <span role="alert" className="text-xs text-[var(--genus-error)]">
                    {approveBatchError}
                  </span>
                )}
              </div>
            )}
            {subTab === "elaboracion" && (
              <OperationalTable
                columns={granelColumns}
                rows={granelesPendientes}
                rowKey={(row) => row.id}
                emptyMessage="Sin graneles pendientes de revisión."
                selection={
                  canDecide
                    ? { active: true, isSelected: isRowSelected, onToggle: toggleRow }
                    : undefined
                }
              />
            )}
            {subTab === "acondicionamiento" && (
              <OperationalTable
                columns={salidaColumns}
                rows={salidasPendientes}
                rowKey={(row) => row.id}
                emptyMessage="Sin salidas pendientes de aprobación."
                selection={
                  canDecide
                    ? { active: true, isSelected: isRowSelected, onToggle: toggleRow }
                    : undefined
                }
              />
            )}
          </div>
        )}

        {topTab === "aprobados" && (
          <>
            {remitoActions.canRemitos ? (
              <p className="mb-2 text-xs text-[var(--os-text-muted)]">
                Envasados aprobados: usá GENERAR REMITO para agrupar por cliente y fecha.
              </p>
            ) : null}
            <div className="mb-2 flex justify-end">
              <SortSelect
                value={aprobadosSort}
                onChange={setAprobadosSort}
                options={CALIDAD_DECISION_SORT_OPTIONS}
                testId="calidad-aprobados-sort"
              />
            </div>
            <OperationalTable
              columns={decidedColumns}
              rows={aprobados}
              rowKey={(row) => row.id}
              emptyMessage="Todavía no hay trabajos aprobados."
            />
            {remitoActions.modals}
          </>
        )}

        {topTab === "rechazados" && (
          <>
            <div className="mb-2 flex justify-end">
              <SortSelect
                value={rechazadosSort}
                onChange={setRechazadosSort}
                options={CALIDAD_DECISION_SORT_OPTIONS}
                testId="calidad-rechazados-sort"
              />
            </div>
            <OperationalTable
              columns={decidedColumns}
              rows={rechazados}
              rowKey={(row) => row.id}
              emptyMessage="Todavía no hay trabajos rechazados."
            />
          </>
        )}
      </div>

      <Drawer open={reviewItem !== null} onOpenChange={(open) => !open && setReviewItem(null)}>
        <DrawerContent aria-describedby={undefined}>
          {reviewItem && (
            <>
              <DrawerHeader>
                <div>
                  <DrawerTitle>{displayField(reviewItem.product)}</DrawerTitle>
                  <p className="mt-1 text-sm text-[var(--os-text-muted)]">
                    {displayField(reviewItem.client)}
                  </p>
                  {reviewWorkItem ? (
                    <div className="mt-2">
                      <WorkItemWarningBadge item={reviewWorkItem} />
                    </div>
                  ) : null}
                </div>
                <DrawerCloseButton />
              </DrawerHeader>
              <DrawerBody className="space-y-5">
                <dl className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <dt className="text-xs uppercase text-[var(--os-text-muted)]">
                      {reviewItem.kind === "granel" ? "OE" : "OA"}
                    </dt>
                    <dd className="font-mono font-medium">
                      {displayField(reviewItem.kind === "granel" ? reviewItem.oe : reviewItem.oa)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase text-[var(--os-text-muted)]">Sector de origen</dt>
                    <dd className="font-medium">
                      {reviewItem.receivedFrom ? SECTOR_LABELS[reviewItem.receivedFrom] : "Planilla"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase text-[var(--os-text-muted)]">Cantidad final</dt>
                    <dd className="font-medium tabular-nums">{displayField(reviewItem.quantity)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase text-[var(--os-text-muted)]">Responsable / línea</dt>
                    <dd className="font-medium">
                      {displayField(reviewItem.completedBy ?? reviewItem.line)}
                    </dd>
                  </div>
                </dl>

                {reviewItem.kind === "salida" ? (
                  <CodificadoTracePanel
                    workItem={reviewWorkItem}
                    progress={
                      progressMap[
                        reviewItem.relatedWorkItemId ??
                          (reviewItem.id.startsWith("qc:")
                            ? reviewItem.id.slice(3)
                            : reviewItem.id)
                      ] ?? null
                    }
                    fallbackQuantity={reviewItem.quantity}
                  />
                ) : null}

                <div>
                  <p className="mb-1.5 text-xs uppercase text-[var(--os-text-muted)]">Archivo</p>
                  {reviewDoc ? (
                    <a
                      href={reviewDoc.fileDataUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm text-[var(--os-teal)] hover:underline"
                    >
                      {reviewDoc.fileName}
                    </a>
                  ) : (
                    <p className="text-xs text-[var(--os-text-muted)]">Sin archivo cargado.</p>
                  )}
                </div>

                <div>
                  <p className="mb-1.5 text-xs uppercase text-[var(--os-text-muted)]">
                    Observaciones del sector
                  </p>
                  <p className="text-sm">{reviewItem.observation || "Sin observaciones."}</p>
                </div>

                <div className="space-y-2">
                  <label htmlFor="calidad-obs" className="text-sm font-medium text-[var(--os-text)]">
                    Observación de Calidad
                  </label>
                  <textarea
                    id="calidad-obs"
                    value={calidadObservation}
                    onChange={(e) => setCalidadObservation(e.target.value)}
                    rows={2}
                    readOnly={!canDecide}
                    disabled={!canDecide}
                    className="w-full rounded-[var(--os-radius-sm)] border border-[var(--os-border)] bg-[var(--os-surface)] px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-70"
                  />
                </div>

                {canDecide && showRejectField && (
                  <div className="space-y-2">
                    <label htmlFor="reject-reason" className="text-sm font-medium text-[var(--genus-error)]">
                      Motivo de rechazo (opcional)
                    </label>
                    <textarea
                      id="reject-reason"
                      value={rejectReason}
                      onChange={(e) => {
                        setRejectReason(e.target.value);
                        if (e.target.value.trim()) setRejectError(null);
                      }}
                      rows={2}
                      aria-invalid={Boolean(rejectError)}
                      className="w-full rounded-[var(--os-radius-sm)] border border-[var(--genus-error)]/35 bg-[var(--os-surface)] px-3 py-2 text-sm"
                      placeholder="Si no informás motivo, se registrará “Sin motivo informado”."
                    />
                    {rejectError && (
                      <p role="alert" className="text-xs text-[var(--genus-error)]">
                        {rejectError}
                      </p>
                    )}
                  </div>
                )}

                {canDecide && showReworkField && (
                  <div className="space-y-2">
                    <label htmlFor="rework-reason" className="text-sm font-medium text-[var(--os-text)]">
                      Motivo del Rehacer (opcional)
                    </label>
                    <textarea
                      id="rework-reason"
                      value={reworkReason}
                      onChange={(e) => setReworkReason(e.target.value)}
                      rows={2}
                      className="w-full rounded-[var(--os-radius-sm)] border border-[var(--os-border)] bg-[var(--os-surface)] px-3 py-2 text-sm"
                      placeholder="Ej: corregir codificación de VTO en cajas. Si no informás motivo, se registrará “Sin motivo informado”."
                    />
                    <p className="text-xs text-[var(--os-text-muted)]">
                      El trabajo vuelve editable a{" "}
                      {reviewItem.receivedFrom ? SECTOR_LABELS[reviewItem.receivedFrom] : "su sector"} —
                      conserva OA, lote, VTO y el resto del historial.
                    </p>
                  </div>
                )}

                {actionError && (
                  <p role="alert" className="text-sm text-[var(--genus-error)]">
                    {actionError}
                  </p>
                )}
              </DrawerBody>
              {canDecide ? (
                <DrawerFooter>
                  <Button variant="destructive" onClick={handleReject} disabled={showReworkField}>
                    {showRejectField ? "Confirmar rechazo" : "Rechazar"}
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => void handleRework()}
                    disabled={showRejectField || reworkBusy}
                  >
                    {reworkBusy ? "Rehaciendo…" : showReworkField ? "Confirmar Rehacer" : "Rehacer"}
                  </Button>
                  <Button
                    variant="primary"
                    onClick={() => setConfirmApprove(true)}
                    disabled={showRejectField || showReworkField}
                  >
                    Aprobar
                  </Button>
                </DrawerFooter>
              ) : (
                <DrawerFooter>
                  <Button variant="secondary" onClick={() => setReviewItem(null)}>
                    Cerrar
                  </Button>
                </DrawerFooter>
              )}
            </>
          )}
        </DrawerContent>
      </Drawer>

      <ConfirmDialog
        open={confirmApprove}
        onOpenChange={setConfirmApprove}
        title="Aprobar trabajo"
        description={`${displayField(reviewItem?.product)} quedará marcado como aprobado y ${reviewItem?.receivedFrom ? SECTOR_LABELS[reviewItem.receivedFrom] : "el sector de origen"} va a ser notificado. ¿Confirmás la aprobación?`}
        confirmLabel="Sí, aprobar"
        cancelLabel="Cancelar"
        onConfirm={handleApprove}
      />

      <Dialog
        open={showApproveConfirm}
        onOpenChange={(open) => {
          if (!approveBatchBusy) setShowApproveConfirm(open);
        }}
      >
        <DialogContent data-testid="calidad-approve-batch-dialog">
          <DialogHeader>
            <DialogTitle>APROBAR {selectedItemsWithWarnings.length} TRABAJO{selectedItemsWithWarnings.length === 1 ? "" : "S"}</DialogTitle>
            <DialogDescription>
              {selectedItemsWithWarnings.length} seleccionado{selectedItemsWithWarnings.length === 1 ? "" : "s"} ·{" "}
              {selectedItemsWithWarnings.length - selectedWithWarningsCount} sin advertencias ·{" "}
              {selectedWithWarningsCount} con datos faltantes
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-80 space-y-2 overflow-y-auto">
            {selectedItemsWithWarnings.map(({ row, warnings }) => (
              <div
                key={row.id}
                className="rounded-[var(--os-radius-sm)] border border-[var(--os-border)] px-3 py-2 text-sm"
                data-testid="calidad-approve-batch-row"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="font-medium">{displayField(row.product)}</span>
                  <span className="text-xs text-[var(--os-text-muted)]">{displayField(row.client)}</span>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-[var(--os-text-muted)]">
                  <span>Lote: {displayField(row.lote)}</span>
                  <span>VTO: {displayField(row.vto)}</span>
                  <span>Cantidad final: {displayField(row.finishedQty ?? row.quantity)}</span>
                </div>
                {warnings.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {warnings.map((w) => (
                      <span
                        key={w.code}
                        className="inline-flex items-center gap-1 rounded-full bg-[var(--genus-error-soft)] px-2 py-0.5 text-xs font-semibold text-[var(--genus-error)]"
                      >
                        <span aria-hidden="true">🔴</span>
                        {w.label}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
          {selectedWithWarningsCount > 0 && (
            <p className="text-xs text-[var(--os-text-muted)]">
              Los datos faltantes no bloquean la aprobación — Calidad puede aprobar igual.
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              disabled={approveBatchBusy}
              onClick={() => setShowApproveConfirm(false)}
            >
              Cancelar
            </Button>
            <Button type="button" disabled={approveBatchBusy} onClick={() => void handleApproveBatch()}>
              {approveBatchBusy
                ? "Aprobando…"
                : `Confirmar aprobación de ${selectedItemsWithWarnings.length}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={annulTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setAnnulTarget(null);
            setAnnulReason("");
            setAnnulError(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Anular decisión</DialogTitle>
            <DialogDescription>
              {annulTarget
                ? `${displayField(annulTarget.product)} volverá a Pendientes. El motivo es opcional.`
                : null}
            </DialogDescription>
          </DialogHeader>
          <label htmlFor="annul-reason" className="block text-sm">
            Motivo (opcional)
            <textarea
              id="annul-reason"
              value={annulReason}
              onChange={(e) => {
                setAnnulReason(e.target.value);
                if (e.target.value.trim()) setAnnulError(null);
              }}
              rows={3}
              className="mt-1 w-full rounded-[var(--os-radius-sm)] border border-[var(--os-border)] bg-[var(--os-surface)] px-3 py-2 text-sm"
              placeholder="Si no informás motivo, se registrará “Sin motivo informado”."
            />
          </label>
          {annulError ? (
            <p role="alert" className="text-sm text-[var(--genus-error)]">
              {annulError}
            </p>
          ) : null}
          <DialogFooter>
            <Button variant="secondary" onClick={() => setAnnulTarget(null)}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleAnnul}>
              Anular decisión
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="mt-6">
        <FormulasAdminPanel session={formulaSession} sectorId={sectorId} />
      </div>
    </TwinShell>
  );
}
