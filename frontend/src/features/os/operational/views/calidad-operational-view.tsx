"use client";

import { useCallback, useMemo, useState } from "react";
import { TwinShell } from "@/features/os/shell/twin-shell";
import { useRequiredWorkspace } from "@/features/os/workspace/workspace-provider";
import { usePreviewContext } from "@/features/os/session/preview-context";
import { displayField } from "@/lib/operational/display-fields";
import { SECTOR_LABELS } from "@/types/operational/sector";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
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
import { useOperationalPlan } from "../hooks/use-operational-plan";
import { filterQualityByKind, filterQualityByStatus } from "../lib/operational-filters";
import { WORK_TRANSFER } from "../lib/work-transfer-labels";
import { useOperationalStore } from "../store/operational-store-context";
import type { QualityItem } from "../types";

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
  const { showToast } = usePreviewContext();
  const {
    getQualityStatus,
    getQualityObservation,
    approveQualityItem,
    rejectQualityItem,
  } = useOperationalStore();
  const { data, loading, error, lastRefreshAt, updatedAgoLabel, liveConnected } =
    useOperationalPlan("CALIDAD");
  const [topTab, setTopTab] = useState<TopTabId>(initialTab);
  const [subTab, setSubTab] = useState<PendingSubTabId>("elaboracion");
  const [reviewItem, setReviewItem] = useState<QualityItem | null>(null);
  const [calidadObservation, setCalidadObservation] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [showRejectField, setShowRejectField] = useState(false);
  const [rejectError, setRejectError] = useState<string | null>(null);
  const [confirmApprove, setConfirmApprove] = useState(false);

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

  const aprobados = useMemo(
    () => sortReceivedFirst(filterQualityByStatus(qualityItems, "aprobado")),
    [qualityItems]
  );
  const rechazados = useMemo(
    () => sortReceivedFirst(filterQualityByStatus(qualityItems, "rechazado")),
    [qualityItems]
  );

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
    },
    [getQualityObservation]
  );

  const notifyOrigin = useCallback((item: QualityItem, approved: boolean) => {
    if (!item.receivedFrom) return;
    pushNotification({
      kind: approved ? "calidad_aprobado" : "calidad_rechazado",
      title: approved ? "Calidad aprobó tu trabajo" : "Calidad rechazó tu trabajo",
      message: `${item.product} · ${item.client}${approved ? "" : " — revisá el motivo del rechazo"}`,
      sectors: [item.receivedFrom],
    });
  }, []);

  const handleApprove = useCallback(() => {
    if (!reviewItem) return;
    approveQualityItem(reviewItem.id, {
      decidedBy: workspace.context.displayName,
      observation: calidadObservation,
    });
    notifyOrigin(reviewItem, true);
    showToast("Trabajo aprobado.");
    setConfirmApprove(false);
    setReviewItem(null);
  }, [reviewItem, approveQualityItem, workspace.context.displayName, calidadObservation, notifyOrigin, showToast]);

  const handleReject = useCallback(() => {
    if (!reviewItem) return;
    if (!showRejectField) {
      setShowRejectField(true);
      return;
    }
    if (!rejectReason.trim()) {
      setRejectError("El motivo de rechazo es obligatorio.");
      return;
    }
    rejectQualityItem(reviewItem.id, {
      decidedBy: workspace.context.displayName,
      observation: rejectReason.trim(),
    });
    notifyOrigin(reviewItem, false);
    showToast("Trabajo rechazado.");
    setReviewItem(null);
  }, [reviewItem, showRejectField, rejectReason, rejectQualityItem, workspace.context.displayName, notifyOrigin, showToast]);

  const buildColumns = useCallback(
    (kind: "granel" | "salida"): OperationalTableColumn<QualityItem>[] => {
      const base: OperationalTableColumn<QualityItem>[] =
        kind === "granel"
          ? [
              {
                key: "received",
                header: "Sector de origen",
                render: (row) => (
                  <span className="text-xs font-medium text-[var(--os-teal)]">
                    {row.receivedFrom ? SECTOR_LABELS[row.receivedFrom] : "Planilla"}
                  </span>
                ),
              },
              { key: "lote", header: "Lote / Granel", render: (row) => <span className="font-mono text-xs font-medium text-[var(--os-teal)]">{displayField(row.lote)}</span> },
              { key: "product", header: "Producto", render: (row) => displayField(row.product) },
              { key: "client", header: "Cliente", render: (row) => displayField(row.client) },
              { key: "quantity", header: "Cantidad", render: (row) => displayField(row.quantity) },
              { key: "oe", header: "OE", render: (row) => <span className="font-mono text-xs">{displayField(row.oe)}</span> },
            ]
          : [
              {
                key: "received",
                header: "Sector de origen",
                render: (row) => (
                  <span className="text-xs font-medium text-[var(--os-teal)]">
                    {row.receivedFrom ? SECTOR_LABELS[row.receivedFrom] : "Planilla"}
                    {row.line ? ` · ${row.line}` : ""}
                  </span>
                ),
              },
              { key: "product", header: "Producto", render: (row) => displayField(row.product) },
              { key: "client", header: "Cliente", render: (row) => displayField(row.client) },
              { key: "quantity", header: "Cantidad", render: (row) => displayField(row.quantity) },
              { key: "oa", header: "OA", render: (row) => <span className="font-mono text-xs">{displayField(row.oa)}</span> },
            ];

      return [
        ...base,
        { key: "status", header: "Estado", render: (row) => <StatusChip status={row.status} transferredInbox={Boolean(row.receivedFrom)} /> },
        {
          key: "actions",
          header: "Acción",
          render: (row) =>
            row.status === "pendiente" ? (
              <Button size="sm" variant="secondary" onClick={() => openReview(row)}>
                Revisar
              </Button>
            ) : (
              <span className="text-xs text-[var(--os-text-muted)]">—</span>
            ),
        },
      ];
    },
    [getQualityObservation, openReview]
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
      { key: "quantity", header: "Cantidad", render: (row) => displayField(row.quantity) },
      {
        key: "ref",
        header: "OE / OA",
        render: (row) => (
          <span className="font-mono text-xs">{displayField(row.kind === "granel" ? row.oe : row.oa)}</span>
        ),
      },
      { key: "status", header: "Estado", render: (row) => <StatusChip status={row.status} /> },
      {
        key: "obs",
        header: "Observación de Calidad",
        render: (row) => (
          <span className="text-xs text-[var(--os-text-muted)]">
            {displayField(getQualityObservation(row.id))}
          </span>
        ),
      },
    ],
    [getQualityObservation]
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

  return (
    <TwinShell title="Calidad">
      <header className="mb-6 space-y-2">
        <h2 className="text-2xl font-semibold tracking-tight">
          Hola, {workspace.context.displayName}
        </h2>
        <p className="text-sm text-[var(--os-text-muted)]">
          Calidad · {workspace.context.jobTitle}
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

      {topTab === "pendientes" && transferidosCount > 0 && (
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
            {subTab === "elaboracion" && (
              <OperationalTable
                columns={granelColumns}
                rows={granelesPendientes}
                rowKey={(row) => row.id}
                emptyMessage="Sin graneles pendientes de revisión."
              />
            )}
            {subTab === "acondicionamiento" && (
              <OperationalTable
                columns={salidaColumns}
                rows={salidasPendientes}
                rowKey={(row) => row.id}
                emptyMessage="Sin salidas pendientes de aprobación."
              />
            )}
          </div>
        )}

        {topTab === "aprobados" && (
          <OperationalTable
            columns={decidedColumns}
            rows={aprobados}
            rowKey={(row) => row.id}
            emptyMessage="Todavía no hay trabajos aprobados."
          />
        )}

        {topTab === "rechazados" && (
          <OperationalTable
            columns={decidedColumns}
            rows={rechazados}
            rowKey={(row) => row.id}
            emptyMessage="Todavía no hay trabajos rechazados."
          />
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
                    className="w-full rounded-[var(--os-radius-sm)] border border-[var(--os-border)] bg-[var(--os-surface)] px-3 py-2 text-sm"
                  />
                </div>

                {showRejectField && (
                  <div className="space-y-2">
                    <label htmlFor="reject-reason" className="text-sm font-medium text-rose-700">
                      Motivo de rechazo (obligatorio)
                    </label>
                    <textarea
                      id="reject-reason"
                      value={rejectReason}
                      onChange={(e) => {
                        setRejectReason(e.target.value);
                        if (e.target.value.trim()) setRejectError(null);
                      }}
                      rows={2}
                      required
                      aria-invalid={Boolean(rejectError)}
                      className="w-full rounded-[var(--os-radius-sm)] border border-rose-300 bg-[var(--os-surface)] px-3 py-2 text-sm"
                    />
                    {rejectError && (
                      <p role="alert" className="text-xs text-rose-700">
                        {rejectError}
                      </p>
                    )}
                  </div>
                )}
              </DrawerBody>
              <DrawerFooter>
                <Button variant="destructive" onClick={handleReject}>
                  {showRejectField ? "Confirmar rechazo" : "Rechazar"}
                </Button>
                <Button
                  variant="primary"
                  onClick={() => setConfirmApprove(true)}
                  disabled={showRejectField}
                >
                  Aprobar
                </Button>
              </DrawerFooter>
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
    </TwinShell>
  );
}
