"use client";

import { useCallback, useMemo, useState } from "react";
import { MoreVertical } from "lucide-react";
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
import { TwinShell } from "@/features/os/shell/twin-shell";
import { usePreviewContext, usePreviewSession } from "@/features/os/session/preview-context";
import { useRequiredWorkspace } from "@/features/os/workspace/workspace-provider";
import { pushNotification } from "@/features/os/feedback/notifications-store";
import { postAnnulDelivery, postArchiveDelivery, postDeleteDeliveryRecord, postDeliverWork, postRestoreDelivery } from "@/lib/api/live-sync-client";
import { SECTOR_LABELS, type SectorId } from "@/types/operational/sector";
import type { WorkItem } from "@/types/operational/work-item";
import { displayField } from "@/lib/operational/display-fields";
import { OperationalTabs, StatusChip, type OperationalTableColumn } from "../components/operational-ui";
import { applyQualityDecisionsToItems } from "../adapters/operational-sheets-adapter";
import { getAllAsignacionLotes } from "../adapters/asignacion-lotes-repository";
import { listAllManualWorkItems } from "../adapters/manual-work-items-repository";
import {
  annulDelivery,
  archiveDelivery,
  deleteDeliveryRecord,
  deliverWork,
  getDeliveryByWorkItemId,
  listActiveDeliveries,
  listArchivedDeliveries,
  restoreDelivery,
  type DeliveryRecord,
} from "../adapters/delivery-repository";
import { canMutateDeliveries } from "../lib/delivery-rbac";
import { useOperationalPlan } from "../hooks/use-operational-plan";
import { useOperationalStore } from "../store/operational-store-context";
import { getWorkProgress, recordWorkProgress } from "../store/operational-store";
import type { QualityItem } from "../types";
import { DeliveryFilesDialog } from "./delivery-files-dialog";

type EntregadosTab = "entregados" | "archivados" | "pendientes";
type TimelinessFilter = "todos" | "en_fecha" | "fuera_fecha";
type SortKey = "actual_desc" | "actual_asc" | "planned_asc" | "product_asc" | "client_asc";

interface DeliveryForm {
  actualDeliveredAt: string;
  remito: string;
  receivedBy: string;
  observations: string;
}

const TABS = [
  { id: "entregados", label: "Entregados" },
  { id: "archivados", label: "Archivados" },
  { id: "pendientes", label: "Pendientes de entrega" },
] as const;

const PAGE_SIZE = 20;
const PRODUCING_SECTORS: SectorId[] = ["ELABORACION", "ENVASADO_MASIVO", "ENVASADO_PREMIUM"];

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function nowDatetimeLocal(): string {
  const date = new Date();
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function toIsoFromDatetimeLocal(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value.length <= 10 ? `${value}T12:00:00` : value);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString("es-AR") : value;
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString("es-AR") : value;
}

function compareDateOnly(a: string | null | undefined, b: string | null | undefined): number | null {
  if (!a || !b) return null;
  const left = a.slice(0, 10);
  const right = b.slice(0, 10);
  return left.localeCompare(right);
}

function isLateDelivery(record: DeliveryRecord): boolean {
  const comparison = compareDateOnly(record.actualDeliveredAt, record.plannedDeliveryDate);
  return comparison != null && comparison > 0;
}

function uniqueOptions(records: DeliveryRecord[], field: keyof DeliveryRecord): string[] {
  return Array.from(
    new Set(records.map((record) => record[field]).filter((value): value is string => typeof value === "string" && value.trim().length > 0))
  ).sort((a, b) => a.localeCompare(b, "es"));
}

function getQualityRef(item: QualityItem): string | null {
  return item.kind === "granel" ? item.oe : item.oa;
}

function workRef(item: WorkItem | null | undefined): string | null {
  return item?.oeRef ?? item?.oaRef ?? null;
}

function splitQuantity(quantity: string | null | undefined, fallbackUnit?: string | null): { quantity: string | null; unit: string | null } {
  if (!quantity) return { quantity: null, unit: fallbackUnit ?? null };
  const match = /^([\d.,]+)\s*(.*)$/.exec(quantity.trim());
  if (!match) return { quantity, unit: fallbackUnit ?? null };
  return { quantity: match[1] || quantity, unit: match[2] || fallbackUnit || null };
}

function ActionMenu({
  onDetail,
  onArchive,
  onAnnul,
  onDelete,
}: {
  onDetail: () => void;
  onArchive: () => void;
  onAnnul: () => void;
  onDelete: () => void;
}) {
  const itemClass =
    "block w-full rounded px-3 py-1.5 text-left text-xs font-medium hover:bg-[var(--os-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--os-teal)]";
  return (
    <details className="group relative">
      <summary
        className="inline-flex h-7 w-7 cursor-pointer list-none items-center justify-center rounded border border-[var(--os-border)] text-[var(--os-text-muted)] hover:text-[var(--os-text)] [&::-webkit-details-marker]:hidden"
        aria-label="Acciones de entrega"
      >
        <MoreVertical className="h-4 w-4" aria-hidden="true" />
      </summary>
      <div className="absolute right-0 z-20 mt-1 min-w-44 rounded-[var(--os-radius-sm)] border border-[var(--os-border)] bg-[var(--os-surface)] p-1 shadow-lg">
        <button type="button" className={itemClass} onClick={onDetail}>
          Ver detalle
        </button>
        <button type="button" className={itemClass} onClick={onArchive}>
          Archivar
        </button>
        <button type="button" className={`${itemClass} text-rose-700`} onClick={onAnnul}>
          Anular entrega
        </button>
        <button type="button" className={`${itemClass} text-rose-700`} onClick={onDelete}>
          Borrar entrega
        </button>
      </div>
    </details>
  );
}

function KpiTile({ label, value, tone }: { label: string; value: number; tone?: "ok" | "warn" | "danger" }) {
  const toneClass =
    tone === "ok" ? "text-emerald-700" : tone === "danger" ? "text-rose-700" : tone === "warn" ? "text-amber-700" : "text-[var(--os-text)]";
  return (
    <div className="rounded-[var(--os-radius)] border border-[var(--os-border)] bg-[var(--os-surface)] p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-[var(--os-text-muted)]">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${toneClass}`}>{value}</p>
    </div>
  );
}

export function EntregadosView() {
  const workspace = useRequiredWorkspace();
  const { sectorId } = usePreviewSession();
  const { showToast } = usePreviewContext();
  const canMutate = canMutateDeliveries(sectorId);
  const { getQualityStatus, refreshDecisions } = useOperationalStore();

  const calidad = useOperationalPlan("CALIDAD");
  const elaboracion = useOperationalPlan("ELABORACION");
  const masivo = useOperationalPlan("ENVASADO_MASIVO");
  const premium = useOperationalPlan("ENVASADO_PREMIUM");

  const [tab, setTab] = useState<EntregadosTab>("entregados");
  const [tick, setTick] = useState(0);
  const [search, setSearch] = useState("");
  const [product, setProduct] = useState("");
  const [client, setClient] = useState("");
  const [codigo, setCodigo] = useState("");
  const [lote, setLote] = useState("");
  const [sector, setSector] = useState("");
  const [month, setMonth] = useState("");
  const [year, setYear] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [timeliness, setTimeliness] = useState<TimelinessFilter>("todos");
  const [sort, setSort] = useState<SortKey>("actual_desc");
  const [page, setPage] = useState(1);
  const [deliveryTarget, setDeliveryTarget] = useState<QualityItem | null>(null);
  const [form, setForm] = useState<DeliveryForm>({
    actualDeliveredAt: nowDatetimeLocal(),
    remito: "",
    receivedBy: "",
    observations: "",
  });
  const [detail, setDetail] = useState<DeliveryRecord | null>(null);
  const [filesRef, setFilesRef] = useState<string | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<DeliveryRecord | null>(null);
  const [annulTarget, setAnnulTarget] = useState<DeliveryRecord | null>(null);
  const [annulReason, setAnnulReason] = useState("");
  const [deleteGuideTarget, setDeleteGuideTarget] = useState<DeliveryRecord | null>(null);
  const [deleteGuideStep, setDeleteGuideStep] = useState<"explain" | "reason" | "confirm">("explain");
  const [deleteReason, setDeleteReason] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  const workItemsById = useMemo(() => {
    if (tick < 0) return new Map<string, WorkItem>();
    const items = [
      ...(elaboracion.data?.workItems ?? []),
      ...(masivo.data?.workItems ?? []),
      ...(premium.data?.workItems ?? []),
      ...listAllManualWorkItems(),
    ];
    return new Map(items.map((item) => [item.id, item]));
  }, [elaboracion.data?.workItems, masivo.data?.workItems, premium.data?.workItems, tick]);

  const lotsByLote = useMemo(() => {
    if (tick < 0) return new Map<string, ReturnType<typeof getAllAsignacionLotes>[number]>();
    const map = new Map<string, ReturnType<typeof getAllAsignacionLotes>[number]>();
    for (const item of getAllAsignacionLotes()) {
      if (item.lote) map.set(item.lote, item);
    }
    return map;
  }, [tick]);

  const qualityItems = useMemo(() => {
    const seed = calidad.data?.qualityItems ?? [];
    return applyQualityDecisionsToItems(seed, getQualityStatus);
  }, [calidad.data?.qualityItems, getQualityStatus]);

  const pendingApproved = useMemo(() => {
    if (tick < 0) return [];
    return qualityItems
      .filter((item) => item.status === "aprobado" && item.relatedWorkItemId)
      .filter((item) => !getDeliveryByWorkItemId(item.relatedWorkItemId!))
      .sort((a, b) => (a.deliveryDate ?? "").localeCompare(b.deliveryDate ?? ""));
  }, [qualityItems, tick]);

  const activeDeliveries = useMemo(() => {
    if (tick < 0) return [];
    return listActiveDeliveries();
  }, [tick]);

  const archivedDeliveries = useMemo(() => {
    if (tick < 0) return [];
    return listArchivedDeliveries();
  }, [tick]);

  const filteredDeliveries = useMemo(() => {
    const q = search.trim().toLowerCase();
    return activeDeliveries
      .filter((record) => {
        if (q) {
          const haystack = [
            record.product,
            record.codigo,
            record.client,
            record.lote,
            record.remito,
            record.receivedBy,
            record.observations,
          ].join(" ").toLowerCase();
          if (!haystack.includes(q)) return false;
        }
        if (product && record.product !== product) return false;
        if (client && record.client !== client) return false;
        if (codigo && record.codigo !== codigo) return false;
        if (lote && record.lote !== lote) return false;
        if (sector && record.sourceSector !== sector) return false;
        const actualDate = record.actualDeliveredAt.slice(0, 10);
        if (month && actualDate.slice(5, 7) !== month) return false;
        if (year && actualDate.slice(0, 4) !== year) return false;
        if (fromDate && actualDate < fromDate) return false;
        if (toDate && actualDate > toDate) return false;
        if (timeliness === "en_fecha" && isLateDelivery(record)) return false;
        if (timeliness === "fuera_fecha" && !isLateDelivery(record)) return false;
        return true;
      })
      .sort((a, b) => {
        if (sort === "actual_asc") return a.actualDeliveredAt.localeCompare(b.actualDeliveredAt);
        if (sort === "planned_asc") return (a.plannedDeliveryDate ?? "").localeCompare(b.plannedDeliveryDate ?? "");
        if (sort === "product_asc") return a.product.localeCompare(b.product, "es");
        if (sort === "client_asc") return (a.client ?? "").localeCompare(b.client ?? "", "es");
        return b.actualDeliveredAt.localeCompare(a.actualDeliveredAt);
      });
  }, [activeDeliveries, client, codigo, fromDate, lote, month, product, search, sector, sort, timeliness, toDate, year]);

  const pagedDeliveries = filteredDeliveries.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(filteredDeliveries.length / PAGE_SIZE));

  const periodCount = filteredDeliveries.length;
  const deliveredToday = activeDeliveries.filter((record) => record.actualDeliveredAt.slice(0, 10) === todayIso()).length;
  const lateCount = filteredDeliveries.filter(isLateDelivery).length;

  const openDeliveryModal = useCallback((item: QualityItem) => {
    setDeliveryTarget(item);
    setForm({ actualDeliveredAt: nowDatetimeLocal(), remito: "", receivedBy: "", observations: "" });
    setActionError(null);
  }, []);

  const selectedPendingMeta = useMemo(() => {
    if (!deliveryTarget) return null;
    const work = deliveryTarget.relatedWorkItemId ? workItemsById.get(deliveryTarget.relatedWorkItemId) : null;
    const lot = deliveryTarget.lote ? lotsByLote.get(deliveryTarget.lote) : undefined;
    const quantityParts = splitQuantity(deliveryTarget.quantity, work?.unit);
    return {
      work,
      lot,
      product: deliveryTarget.product || lot?.producto || work?.product || "Producto",
      codigo: lot?.codigo ?? null,
      client: deliveryTarget.client || work?.client || null,
      lote: deliveryTarget.lote ?? work?.loteRef ?? null,
      sourceSector: deliveryTarget.receivedFrom ?? work?.sector ?? "ELABORACION",
      quantity: quantityParts.quantity ?? work?.quantity ?? null,
      unit: quantityParts.unit ?? work?.unit ?? null,
      plannedDeliveryDate: work?.deliveryDate ?? deliveryTarget.deliveryDate ?? work?.plannedDate ?? null,
      ref: getQualityRef(deliveryTarget) ?? workRef(work),
    };
  }, [deliveryTarget, lotsByLote, workItemsById]);

  const confirmDelivery = useCallback(() => {
    if (!deliveryTarget || !deliveryTarget.relatedWorkItemId || !selectedPendingMeta) return;
    if (!form.actualDeliveredAt) {
      setActionError("La fecha y hora real de entrega son obligatorias.");
      return;
    }
    const result = deliverWork({
      actorSectorId: sectorId,
      actorName: workspace.context.displayName,
      workItemId: deliveryTarget.relatedWorkItemId,
      qualityItemId: deliveryTarget.id,
      product: selectedPendingMeta.product,
      codigo: selectedPendingMeta.codigo,
      client: selectedPendingMeta.client,
      lote: selectedPendingMeta.lote,
      sourceSector: selectedPendingMeta.sourceSector,
      quantity: selectedPendingMeta.quantity,
      unit: selectedPendingMeta.unit,
      plannedDeliveryDate: selectedPendingMeta.plannedDeliveryDate,
      actualDeliveredAt: toIsoFromDatetimeLocal(form.actualDeliveredAt),
      remito: form.remito,
      receivedBy: form.receivedBy,
      observations: form.observations,
    });
    if (!result.ok) {
      setActionError(result.error);
      showToast(result.error, "info");
      return;
    }
    const existingProgress = getWorkProgress(deliveryTarget.relatedWorkItemId);
    recordWorkProgress(deliveryTarget.relatedWorkItemId, {
      finishedQty: existingProgress?.finishedQty ?? "",
      observation: existingProgress?.observation ?? "",
      status: "entregado",
      updatedBy: workspace.context.displayName,
    });
    refreshDecisions();
    pushNotification({
      kind: "trabajo_entregado",
      title: "Trabajo entregado",
      message: `${result.record.product} · ${result.record.client ?? "Sin cliente"} fue marcado como entregado.`,
      sectors: Array.from(new Set(["PRODUCCION", result.record.sourceSector])),
    });
    void postDeliverWork({ ...result.record, actorSectorId: sectorId }).catch(() => {});
    setDeliveryTarget(null);
    setTick((value) => value + 1);
    showToast("Entrega confirmada.");
  }, [deliveryTarget, form, refreshDecisions, sectorId, selectedPendingMeta, showToast, workspace.context.displayName]);

  const executeArchive = useCallback((record: DeliveryRecord) => {
    const result = archiveDelivery({ id: record.id, actorSectorId: sectorId, actorName: workspace.context.displayName });
    if (!result.ok) {
      showToast(result.error, "info");
      return;
    }
    void postArchiveDelivery({ id: record.id, actorSectorId: sectorId }).catch(() => {});
    setArchiveTarget(null);
    setTick((value) => value + 1);
    showToast("Entrega archivada.");
  }, [sectorId, showToast, workspace.context.displayName]);

  const executeRestore = useCallback((record: DeliveryRecord) => {
    const result = restoreDelivery({ id: record.id, actorSectorId: sectorId, actorName: workspace.context.displayName });
    if (!result.ok) {
      showToast(result.error, "info");
      return;
    }
    void postRestoreDelivery({ id: record.id, actorSectorId: sectorId }).catch(() => {});
    setTick((value) => value + 1);
    showToast("Entrega restaurada.");
  }, [sectorId, showToast, workspace.context.displayName]);

  const executeAnnul = useCallback(() => {
    if (!annulTarget) return;
    const reason = annulReason.trim();
    if (!reason) {
      setActionError("El motivo de anulación es obligatorio.");
      return;
    }
    const result = annulDelivery({ id: annulTarget.id, actorSectorId: sectorId, actorName: workspace.context.displayName, reason });
    if (!result.ok) {
      setActionError(result.error);
      showToast(result.error, "info");
      return;
    }
    const existingProgress = getWorkProgress(result.record.workItemId);
    recordWorkProgress(result.record.workItemId, {
      finishedQty: existingProgress?.finishedQty ?? "",
      observation: existingProgress?.observation ?? "",
      status: "revision",
      updatedBy: workspace.context.displayName,
    });
    refreshDecisions();
    void postAnnulDelivery({ id: annulTarget.id, reason, actorSectorId: sectorId }).catch(() => {});
    setAnnulTarget(null);
    setAnnulReason("");
    setActionError(null);
    setTick((value) => value + 1);
    showToast("Entrega anulada. El trabajo vuelve a pendientes de entrega.");
  }, [annulReason, annulTarget, refreshDecisions, sectorId, showToast, workspace.context.displayName]);

  const closeDeleteGuide = useCallback(() => {
    setDeleteGuideTarget(null);
    setDeleteGuideStep("explain");
    setDeleteReason("");
    setActionError(null);
  }, []);

  const openDeleteGuide = useCallback((record: DeliveryRecord) => {
    setDeleteGuideTarget(record);
    setDeleteReason("");
    setActionError(null);
    setDeleteGuideStep(record.archived ? "reason" : "explain");
  }, []);

  const executeGuidedDelete = useCallback(() => {
    if (!deleteGuideTarget) return;
    const reason = deleteReason.trim();
    if (!reason) {
      setActionError("El motivo de eliminación es obligatorio.");
      return;
    }

    let target = deleteGuideTarget;

    if (!target.archived && target.status === "ENTREGADO") {
      const archiveResult = archiveDelivery({
        id: target.id,
        actorSectorId: sectorId,
        actorName: workspace.context.displayName,
      });
      if (!archiveResult.ok) {
        setActionError(archiveResult.error);
        showToast(archiveResult.error, "info");
        return;
      }
      void postArchiveDelivery({ id: target.id, actorSectorId: sectorId }).catch(() => {});
      target = archiveResult.record;
    }

    const result = deleteDeliveryRecord({
      id: target.id,
      actorSectorId: sectorId,
      actorName: workspace.context.displayName,
      reason,
    });
    if (!result.ok) {
      setActionError(result.error);
      showToast(result.error, "info");
      return;
    }
    void postDeleteDeliveryRecord({ id: target.id, reason, actorSectorId: sectorId }).catch(() => {});
    closeDeleteGuide();
    setTick((value) => value + 1);
    showToast("Entrega eliminada definitivamente. Queda auditoría REGISTRO_ELIMINADO.");
  }, [
    closeDeleteGuide,
    deleteGuideTarget,
    deleteReason,
    sectorId,
    showToast,
    workspace.context.displayName,
  ]);

  const deliveryColumns: OperationalTableColumn<DeliveryRecord>[] = [
    { key: "actual", header: "Entregado", render: (record) => formatDateTime(record.actualDeliveredAt) },
    { key: "planned", header: "Plan", render: (record) => formatDate(record.plannedDeliveryDate) },
    { key: "product", header: "Producto", render: (record) => record.product },
    { key: "client", header: "Cliente", render: (record) => displayField(record.client) },
    { key: "codigo", header: "Código", render: (record) => <span className="font-mono text-xs">{displayField(record.codigo)}</span> },
    { key: "lote", header: "Lote", render: (record) => <span className="font-mono text-xs">{displayField(record.lote)}</span> },
    { key: "sector", header: "Origen", render: (record) => SECTOR_LABELS[record.sourceSector] },
    { key: "status", header: "Estado", render: (record) => <StatusChip status={isLateDelivery(record) ? "fuera_fecha" : "en_fecha"} /> },
    {
      key: "actions",
      header: "Acción",
      render: (record) => canMutate ? (
        <ActionMenu
          onDetail={() => setDetail(record)}
          onArchive={() => setArchiveTarget(record)}
          onAnnul={() => {
            setAnnulTarget(record);
            setAnnulReason("");
            setActionError(null);
          }}
          onDelete={() => openDeleteGuide(record)}
        />
      ) : (
        <Button variant="secondary" size="sm" onClick={() => setDetail(record)}>
          Ver detalle
        </Button>
      ),
    },
  ];

  const pendingColumns: OperationalTableColumn<QualityItem>[] = [
    { key: "origin", header: "Origen", render: (item) => item.receivedFrom ? SECTOR_LABELS[item.receivedFrom] : "Planilla" },
    { key: "product", header: "Producto", render: (item) => item.product },
    { key: "client", header: "Cliente", render: (item) => item.client },
    { key: "lote", header: "Lote", render: (item) => <span className="font-mono text-xs">{displayField(item.lote)}</span> },
    { key: "quantity", header: "Cantidad", render: (item) => displayField(item.quantity) },
    { key: "ref", header: "OE / OA", render: (item) => <span className="font-mono text-xs">{displayField(getQualityRef(item))}</span> },
    { key: "status", header: "Estado", render: () => <StatusChip status="aprobado" /> },
    {
      key: "actions",
      header: "Acción",
      render: (item) => canMutate ? (
        <Button size="sm" variant="primary" onClick={() => openDeliveryModal(item)}>
          Marcar como entregado
        </Button>
      ) : (
        <span className="text-xs text-[var(--os-text-muted)]">Solo Producción</span>
      ),
    },
  ];

  const archivedColumns: OperationalTableColumn<DeliveryRecord>[] = [
    { key: "archived", header: "Archivado", render: (record) => formatDateTime(record.archivedAt) },
    { key: "actual", header: "Entregado", render: (record) => formatDateTime(record.actualDeliveredAt) },
    { key: "product", header: "Producto", render: (record) => record.product },
    { key: "client", header: "Cliente", render: (record) => displayField(record.client) },
    { key: "lote", header: "Lote", render: (record) => <span className="font-mono text-xs">{displayField(record.lote)}</span> },
    {
      key: "actions",
      header: "Acción",
      render: (record) => canMutate ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => executeRestore(record)}>
            Restaurar
          </Button>
          <Button variant="destructive" size="sm" onClick={() => openDeleteGuide(record)}>
            Borrar entrega
          </Button>
        </div>
      ) : (
        <span className="text-xs text-[var(--os-text-muted)]">Solo Producción</span>
      ),
    },
  ];

  const detailWork = detail ? workItemsById.get(detail.workItemId) : null;
  const detailRef = detail ? workRef(detailWork) : null;

  return (
    <TwinShell title="Entregados">
      <div className="space-y-6">
        <header className="space-y-2">
          <h2 className="text-2xl font-semibold tracking-tight">Entregados</h2>
          <p className="text-sm text-[var(--os-text-muted)]">
            Producción confirma entregas aprobadas por Calidad, archiva registros y puede anular una entrega para devolverla a pendientes.
          </p>
          <p className="text-sm text-[var(--os-text-muted)]">
            <strong className="font-medium text-[var(--os-text)]">Descartar notificación</strong> solo oculta el
            aviso en Creamy; no modifica la entrega.{" "}
            <strong className="font-medium text-[var(--os-text)]">Archivar</strong> saca la entrega de la lista
            principal pero permite restaurarla desde Archivados.{" "}
            <strong className="font-medium text-[var(--os-text)]">Borrar entrega</strong> elimina el registro
            visible y no se puede deshacer; queda solo una huella de auditoría (REGISTRO_ELIMINADO).
          </p>
          {!canMutate && (
            <p className="rounded-[var(--os-radius-sm)] border border-[var(--os-border)] bg-[var(--os-surface)] px-4 py-3 text-sm text-[var(--os-text-muted)]">
              Vista de consulta. Solo Producción puede marcar, anular, archivar o eliminar entregas.
            </p>
          )}
        </header>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiTile label="Pendientes entrega" value={pendingApproved.length} tone="warn" />
          <KpiTile label="Entregados hoy" value={deliveredToday} tone="ok" />
          <KpiTile label="En período" value={periodCount} />
          <KpiTile label="Fuera de fecha" value={lateCount} tone="danger" />
        </div>

        <OperationalTabs
          tabs={TABS.map((item) => ({
            ...item,
            count: item.id === "entregados" ? activeDeliveries.length : item.id === "archivados" ? archivedDeliveries.length : pendingApproved.length,
          }))}
          activeId={tab}
          onChange={(id) => setTab(id as EntregadosTab)}
        />

        {tab === "entregados" && (
          <section className="space-y-4">
            <div className="grid grid-cols-1 gap-3 rounded-[var(--os-radius)] border border-[var(--os-border)] bg-[var(--os-surface)] p-4 md:grid-cols-3 lg:grid-cols-6">
              <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Buscar" className="rounded border border-[var(--os-border)] px-3 py-2 text-sm" />
              <select value={product} onChange={(e) => { setProduct(e.target.value); setPage(1); }} className="rounded border border-[var(--os-border)] px-3 py-2 text-sm">
                <option value="">Producto</option>
                {uniqueOptions(activeDeliveries, "product").map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
              <select value={client} onChange={(e) => { setClient(e.target.value); setPage(1); }} className="rounded border border-[var(--os-border)] px-3 py-2 text-sm">
                <option value="">Cliente</option>
                {uniqueOptions(activeDeliveries, "client").map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
              <select value={codigo} onChange={(e) => { setCodigo(e.target.value); setPage(1); }} className="rounded border border-[var(--os-border)] px-3 py-2 text-sm">
                <option value="">Código</option>
                {uniqueOptions(activeDeliveries, "codigo").map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
              <select value={lote} onChange={(e) => { setLote(e.target.value); setPage(1); }} className="rounded border border-[var(--os-border)] px-3 py-2 text-sm">
                <option value="">Lote</option>
                {uniqueOptions(activeDeliveries, "lote").map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
              <select value={sector} onChange={(e) => { setSector(e.target.value); setPage(1); }} className="rounded border border-[var(--os-border)] px-3 py-2 text-sm">
                <option value="">Sector</option>
                {PRODUCING_SECTORS.map((value) => <option key={value} value={value}>{SECTOR_LABELS[value]}</option>)}
              </select>
              <input value={month} onChange={(e) => { setMonth(e.target.value.replace(/\D/g, "").slice(0, 2)); setPage(1); }} placeholder="Mes (MM)" maxLength={2} className="rounded border border-[var(--os-border)] px-3 py-2 text-sm" />
              <input value={year} onChange={(e) => { setYear(e.target.value); setPage(1); }} placeholder="Año" maxLength={4} className="rounded border border-[var(--os-border)] px-3 py-2 text-sm" />
              <input type="date" value={fromDate} onChange={(e) => { setFromDate(e.target.value); setPage(1); }} className="rounded border border-[var(--os-border)] px-3 py-2 text-sm" />
              <input type="date" value={toDate} onChange={(e) => { setToDate(e.target.value); setPage(1); }} className="rounded border border-[var(--os-border)] px-3 py-2 text-sm" />
              <select value={timeliness} onChange={(e) => { setTimeliness(e.target.value as TimelinessFilter); setPage(1); }} className="rounded border border-[var(--os-border)] px-3 py-2 text-sm">
                <option value="todos">En fecha / fuera</option>
                <option value="en_fecha">En fecha</option>
                <option value="fuera_fecha">Fuera de fecha</option>
              </select>
              <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="rounded border border-[var(--os-border)] px-3 py-2 text-sm">
                <option value="actual_desc">Más recientes</option>
                <option value="actual_asc">Más antiguas</option>
                <option value="planned_asc">Plan más próximo</option>
                <option value="product_asc">Producto A-Z</option>
                <option value="client_asc">Cliente A-Z</option>
              </select>
            </div>
            <OperationalTableLike columns={deliveryColumns} rows={pagedDeliveries} rowKey={(record) => record.id} emptyMessage="Sin entregas para los filtros seleccionados." />
            <div className="flex items-center justify-between text-sm text-[var(--os-text-muted)]">
              <span>{filteredDeliveries.length} resultado(s)</span>
              <div className="flex items-center gap-2">
                <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Anterior</Button>
                <span>Página {page} de {totalPages}</span>
                <Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>Siguiente</Button>
              </div>
            </div>
          </section>
        )}

        {tab === "archivados" && (
          <OperationalTableLike columns={archivedColumns} rows={archivedDeliveries} rowKey={(record) => record.id} emptyMessage="No hay entregas archivadas." />
        )}

        {tab === "pendientes" && (
          <OperationalTableLike columns={pendingColumns} rows={pendingApproved} rowKey={(item) => item.id} emptyMessage={calidad.loading ? "Cargando aprobados de Calidad..." : "No hay trabajos aprobados pendientes de entrega."} />
        )}
      </div>

      <Dialog open={deliveryTarget !== null} onOpenChange={(open) => !open && setDeliveryTarget(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Marcar como entregado</DialogTitle>
            <DialogDescription>
              ¿Confirmás que este trabajo fue entregado?
            </DialogDescription>
          </DialogHeader>
          {selectedPendingMeta && (
            <div className="space-y-4">
              <dl className="grid grid-cols-2 gap-3 text-sm md:grid-cols-3">
                <div><dt className="text-xs uppercase text-[var(--os-text-muted)]">Producto</dt><dd className="font-medium">{selectedPendingMeta.product}</dd></div>
                <div><dt className="text-xs uppercase text-[var(--os-text-muted)]">Código</dt><dd className="font-mono text-xs">{displayField(selectedPendingMeta.codigo)}</dd></div>
                <div><dt className="text-xs uppercase text-[var(--os-text-muted)]">Cliente</dt><dd>{displayField(selectedPendingMeta.client)}</dd></div>
                <div><dt className="text-xs uppercase text-[var(--os-text-muted)]">Lote</dt><dd className="font-mono text-xs">{displayField(selectedPendingMeta.lote)}</dd></div>
                <div><dt className="text-xs uppercase text-[var(--os-text-muted)]">Origen</dt><dd>{SECTOR_LABELS[selectedPendingMeta.sourceSector]}</dd></div>
                <div><dt className="text-xs uppercase text-[var(--os-text-muted)]">Cantidad</dt><dd>{[selectedPendingMeta.quantity, selectedPendingMeta.unit].filter(Boolean).join(" ") || "—"}</dd></div>
                <div><dt className="text-xs uppercase text-[var(--os-text-muted)]">Entrega planificada</dt><dd>{formatDate(selectedPendingMeta.plannedDeliveryDate)}</dd></div>
                <div><dt className="text-xs uppercase text-[var(--os-text-muted)]">OE/OA</dt><dd className="font-mono text-xs">{displayField(selectedPendingMeta.ref)}</dd></div>
              </dl>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <label className="space-y-1 text-sm font-medium">
                  Fecha y hora real *
                  <input type="datetime-local" required value={form.actualDeliveredAt} onChange={(e) => setForm((prev) => ({ ...prev, actualDeliveredAt: e.target.value }))} className="w-full rounded border border-[var(--os-border)] px-3 py-2 text-sm" />
                </label>
                <label className="space-y-1 text-sm font-medium">
                  Remito
                  <input value={form.remito} onChange={(e) => setForm((prev) => ({ ...prev, remito: e.target.value }))} className="w-full rounded border border-[var(--os-border)] px-3 py-2 text-sm" />
                </label>
                <label className="space-y-1 text-sm font-medium">
                  Recibido por
                  <input value={form.receivedBy} onChange={(e) => setForm((prev) => ({ ...prev, receivedBy: e.target.value }))} className="w-full rounded border border-[var(--os-border)] px-3 py-2 text-sm" />
                </label>
                <label className="space-y-1 text-sm font-medium md:col-span-2">
                  Observaciones
                  <textarea rows={2} value={form.observations} onChange={(e) => setForm((prev) => ({ ...prev, observations: e.target.value }))} className="w-full rounded border border-[var(--os-border)] px-3 py-2 text-sm" />
                </label>
              </div>
              {actionError && <p role="alert" className="text-sm text-rose-700">{actionError}</p>}
            </div>
          )}
          <DialogFooter>
            <Button variant="secondary" onClick={() => setDeliveryTarget(null)}>Cancelar</Button>
            <Button variant="primary" onClick={confirmDelivery} disabled={!form.actualDeliveredAt}>Confirmar entrega</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={detail !== null} onOpenChange={(open) => !open && setDetail(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Detalle de entrega</DialogTitle>
            <DialogDescription>{detail?.product} · {detail?.client ?? "Sin cliente"}</DialogDescription>
          </DialogHeader>
          {detail && (
            <div className="space-y-4">
              <dl className="grid grid-cols-2 gap-3 text-sm md:grid-cols-3">
                <div><dt className="text-xs uppercase text-[var(--os-text-muted)]">Entregado</dt><dd>{formatDateTime(detail.actualDeliveredAt)}</dd></div>
                <div><dt className="text-xs uppercase text-[var(--os-text-muted)]">Planificado</dt><dd>{formatDate(detail.plannedDeliveryDate)}</dd></div>
                <div><dt className="text-xs uppercase text-[var(--os-text-muted)]">Estado</dt><dd>{isLateDelivery(detail) ? "Fuera de fecha" : "En fecha"}</dd></div>
                <div><dt className="text-xs uppercase text-[var(--os-text-muted)]">Código</dt><dd className="font-mono text-xs">{displayField(detail.codigo)}</dd></div>
                <div><dt className="text-xs uppercase text-[var(--os-text-muted)]">Lote</dt><dd className="font-mono text-xs">{displayField(detail.lote)}</dd></div>
                <div><dt className="text-xs uppercase text-[var(--os-text-muted)]">Origen</dt><dd>{SECTOR_LABELS[detail.sourceSector]}</dd></div>
                <div><dt className="text-xs uppercase text-[var(--os-text-muted)]">Cantidad</dt><dd>{[detail.quantity, detail.unit].filter(Boolean).join(" ") || "—"}</dd></div>
                <div><dt className="text-xs uppercase text-[var(--os-text-muted)]">Remito</dt><dd>{displayField(detail.remito)}</dd></div>
                <div><dt className="text-xs uppercase text-[var(--os-text-muted)]">Recibido por</dt><dd>{displayField(detail.receivedBy)}</dd></div>
              </dl>
              <div>
                <p className="text-xs uppercase text-[var(--os-text-muted)]">Observaciones</p>
                <p className="mt-1 text-sm">{detail.observations || "Sin observaciones."}</p>
              </div>
              <div className="flex justify-end">
                <Button variant="secondary" disabled={!detailRef} onClick={() => setFilesRef(detailRef)}>
                  Administrar archivos
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={archiveTarget !== null}
        onOpenChange={(open) => !open && setArchiveTarget(null)}
        title="Archivar entrega"
        description="Esta entrega dejará de aparecer en la lista principal, pero seguirá disponible en Archivados."
        confirmLabel="Archivar"
        cancelLabel="Cancelar"
        onConfirm={() => archiveTarget && executeArchive(archiveTarget)}
      />

      <Dialog open={annulTarget !== null} onOpenChange={(open) => !open && setAnnulTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Anular entrega</DialogTitle>
            <DialogDescription>
              La entrega quedará anulada y el trabajo volverá a pendientes de entrega. Indicá el motivo.
            </DialogDescription>
          </DialogHeader>
          <textarea value={annulReason} onChange={(e) => setAnnulReason(e.target.value)} rows={3} className="w-full rounded border border-[var(--os-border)] px-3 py-2 text-sm" />
          {actionError && <p role="alert" className="text-sm text-rose-700">{actionError}</p>}
          <DialogFooter>
            <Button variant="secondary" onClick={() => setAnnulTarget(null)}>Cancelar</Button>
            <Button variant="destructive" onClick={executeAnnul} disabled={!annulReason.trim()}>Anular entrega</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteGuideTarget !== null && deleteGuideStep === "explain"}
        onOpenChange={(open) => !open && closeDeleteGuide()}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Borrar entrega</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-3 text-sm text-[var(--os-text-muted)]">
                <p>
                  Para proteger el historial, la entrega se archivará antes de poder eliminarse
                  definitivamente.
                </p>
                <p>
                  Descartar una notificación solo oculta el aviso. Archivar permite restaurar. Borrar
                  entrega elimina el registro visible y no se puede restaurar.
                </p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col gap-2 sm:flex-row">
            <Button variant="secondary" onClick={closeDeleteGuide}>
              Cancelar
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                if (deleteGuideTarget) {
                  executeArchive(deleteGuideTarget);
                  closeDeleteGuide();
                }
              }}
            >
              Archivar solamente
            </Button>
            <Button variant="destructive" onClick={() => setDeleteGuideStep("reason")}>
              Continuar para eliminar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteGuideTarget !== null && deleteGuideStep === "reason"}
        onOpenChange={(open) => !open && closeDeleteGuide()}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Motivo de eliminación</DialogTitle>
            <DialogDescription>
              Indicá el motivo obligatorio antes de continuar.
            </DialogDescription>
          </DialogHeader>
          {deleteGuideTarget && (
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-xs uppercase text-[var(--os-text-muted)]">Producto</dt>
                <dd className="font-medium">{deleteGuideTarget.product}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase text-[var(--os-text-muted)]">Cliente</dt>
                <dd>{displayField(deleteGuideTarget.client)}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase text-[var(--os-text-muted)]">Lote</dt>
                <dd className="font-mono text-xs">{displayField(deleteGuideTarget.lote)}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase text-[var(--os-text-muted)]">Entregado</dt>
                <dd>{formatDateTime(deleteGuideTarget.actualDeliveredAt)}</dd>
              </div>
            </dl>
          )}
          <textarea
            value={deleteReason}
            onChange={(e) => setDeleteReason(e.target.value)}
            rows={3}
            className="w-full rounded border border-[var(--os-border)] px-3 py-2 text-sm"
            placeholder="Motivo de eliminación"
          />
          {actionError && <p role="alert" className="text-sm text-rose-700">{actionError}</p>}
          <DialogFooter>
            <Button variant="secondary" onClick={closeDeleteGuide}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (!deleteReason.trim()) {
                  setActionError("El motivo de eliminación es obligatorio.");
                  return;
                }
                setActionError(null);
                setDeleteGuideStep("confirm");
              }}
              disabled={!deleteReason.trim()}
            >
              Continuar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteGuideTarget !== null && deleteGuideStep === "confirm"}
        onOpenChange={(open) => !open && closeDeleteGuide()}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Eliminar definitivamente</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-3 text-sm text-[var(--os-text-muted)]">
                <p>
                  ¿Querés eliminar definitivamente esta entrega? Dejará de aparecer en Entregados y en las
                  búsquedas de Creamy. Esta acción no puede deshacerse.
                </p>
                <p>Quedará registrada una huella de auditoría (REGISTRO_ELIMINADO).</p>
              </div>
            </DialogDescription>
          </DialogHeader>
          {actionError && <p role="alert" className="text-sm text-rose-700">{actionError}</p>}
          <DialogFooter>
            <Button variant="secondary" onClick={closeDeleteGuide}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={executeGuidedDelete}>
              Eliminar definitivamente
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DeliveryFilesDialog
        open={filesRef !== null}
        onOpenChange={(open) => !open && setFilesRef(null)}
        refNumber={filesRef}
      />
    </TwinShell>
  );
}

function OperationalTableLike<T>({
  columns,
  rows,
  rowKey,
  emptyMessage,
}: {
  columns: OperationalTableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  emptyMessage: string;
}) {
  if (rows.length === 0) {
    return (
      <p className="rounded-[var(--os-radius-sm)] border border-dashed border-[var(--os-border)] px-4 py-8 text-center text-sm text-[var(--os-text-muted)]">
        {emptyMessage}
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-[var(--os-radius-sm)] border border-[var(--os-border)]">
      <table className="w-full min-w-[900px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-[var(--os-border)] bg-[var(--os-bg)]">
            {columns.map((column) => (
              <th key={column.key} className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-[var(--os-text-muted)]">
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)} className="border-b border-[var(--os-border-subtle)] last:border-b-0 hover:bg-[var(--os-bg)]/60">
              {columns.map((column) => (
                <td key={column.key} className="px-3 py-2.5 align-top">
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
