"use client";

import { useCallback, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { displayField } from "@/lib/operational/display-fields";
import { SECTOR_LABELS, type SectorId } from "@/types/operational/sector";
import { usePreviewSession } from "@/features/os/session/preview-context";
import { useOperationalPlan } from "../hooks/use-operational-plan";
import { useOperationalStore } from "../store/operational-store-context";
import {
  OperationalTable,
  OperationalTabs,
  StatusChip,
  type OperationalTableColumn,
} from "../components/operational-ui";
import { TwinShell } from "@/features/os/shell/twin-shell";
import { useRequiredWorkspace } from "@/features/os/workspace/workspace-provider";
import {
  listCancelledAndDeletedManualWorks,
  type CancelledOrDeletedKind,
  type CancelledOrDeletedRow,
} from "../adapters/manual-work-items-repository";
import { AssignedWorkLifecycleActions } from "../components/assigned-work-lifecycle-actions";
import { SortSelect } from "../components/sort-select";
import { useSortPreference } from "../lib/use-sort-preference";
import { applySort, compareDates, compareStrings, type SortOption } from "@/lib/sorting/sort-contract";

interface HistorialRow {
  id: string;
  fecha: string;
  sector: SectorId;
  cliente: string | null;
  producto: string;
  cantidad: string;
  estado: "pendiente" | "aprobado" | "rechazado" | "cancelado" | "completo";
  observacionSector: string;
  observacionCalidad: string;
  decididoPor: string;
}

type HistorialTab = "finalizados" | "cancelados";

const ACTION_KIND_LABELS: Record<CancelledOrDeletedKind, string> = {
  eliminado: "Eliminado",
  cancelado: "Cancelado",
  archivado: "Archivado",
};

interface HistorialViewProps {
  sectors: SectorId[];
  title?: string;
}

export const HISTORIAL_FINALIZADOS_SORT_OPTIONS: SortOption<HistorialRow>[] = [
  { key: "fecha_desc", label: "Más recientes", compare: (a, b) => compareDates(a.fecha, b.fecha, "desc") },
  { key: "fecha_asc", label: "Más antiguos", compare: (a, b) => compareDates(a.fecha, b.fecha, "asc") },
  { key: "producto_asc", label: "Producto A-Z", compare: (a, b) => compareStrings(a.producto, b.producto, "asc") },
  { key: "cliente_asc", label: "Cliente A-Z", compare: (a, b) => compareStrings(a.cliente, b.cliente, "asc") },
];
const HISTORIAL_FINALIZADOS_SORT_KEYS = HISTORIAL_FINALIZADOS_SORT_OPTIONS.map((o) => o.key);

export const HISTORIAL_CANCELADOS_SORT_OPTIONS: SortOption<CancelledOrDeletedRow>[] = [
  { key: "fecha_desc", label: "Más recientes", compare: (a, b) => compareDates(a.at, b.at, "desc") },
  { key: "fecha_asc", label: "Más antiguos", compare: (a, b) => compareDates(a.at, b.at, "asc") },
  { key: "producto_asc", label: "Producto A-Z", compare: (a, b) => compareStrings(a.item.product, b.item.product, "asc") },
];
const HISTORIAL_CANCELADOS_SORT_KEYS = HISTORIAL_CANCELADOS_SORT_OPTIONS.map((o) => o.key);

/** Historial de trabajos finalizados por sector — cruza eventos de cierre con decisión de Calidad. */
export function HistorialView({ sectors, title = "Historial" }: HistorialViewProps) {
  const workspace = useRequiredWorkspace();
  const { sectorId } = usePreviewSession();
  const { completionEvents, getQualityStatus, getQualityObservation } = useOperationalStore();
  const { data: calidadData } = useOperationalPlan("CALIDAD");

  const [tab, setTab] = useState<HistorialTab>("finalizados");
  const [tick, setTick] = useState(0);
  const [feedback, setFeedback] = useState<string | null>(null);

  const showFeedback = useCallback((message: string) => {
    setFeedback(message);
    window.setTimeout(() => setFeedback(null), 4000);
  }, []);

  const [finalizadosSort, setFinalizadosSort] = useSortPreference(
    "historial-finalizados",
    "fecha_desc",
    HISTORIAL_FINALIZADOS_SORT_KEYS
  );
  const [canceladosSort, setCanceladosSort] = useSortPreference(
    "historial-cancelados",
    "fecha_desc",
    HISTORIAL_CANCELADOS_SORT_KEYS
  );

  const finalizadosRows = useMemo<HistorialRow[]>(() => {
    if (tick < 0) return [];
    const qualityItems = calidadData?.qualityItems ?? [];
    const events = completionEvents.filter((e) => sectors.includes(e.sourceSector));

    const rows = events.map((event) => {
      const qualityItem = qualityItems.find((q) => q.relatedWorkItemId === event.workItemId);
      const estado = qualityItem
        ? getQualityStatus(qualityItem.id, qualityItem.status)
        : "pendiente";
      const observacionCalidad = qualityItem ? getQualityObservation(qualityItem.id) : "";

      return {
        id: event.id,
        fecha: event.completedAt,
        sector: event.sourceSector,
        cliente: event.client,
        producto: event.product,
        cantidad: [event.finishedQty, event.unit ?? ""].filter(Boolean).join(" "),
        estado,
        observacionSector: event.observation,
        observacionCalidad,
        decididoPor: event.completedBy,
      } satisfies HistorialRow;
    });
    return applySort(rows, HISTORIAL_FINALIZADOS_SORT_OPTIONS, finalizadosSort);
  }, [
    completionEvents,
    calidadData?.qualityItems,
    sectors,
    getQualityStatus,
    getQualityObservation,
    tick,
    finalizadosSort,
  ]);

  const canceladosRows = useMemo<CancelledOrDeletedRow[]>(() => {
    if (tick < 0) return [];
    const rows = listCancelledAndDeletedManualWorks().filter((row) => sectors.includes(row.item.sector));
    return applySort(rows, HISTORIAL_CANCELADOS_SORT_OPTIONS, canceladosSort);
  }, [sectors, tick, canceladosSort]);

  const canRestore = workspace.context.sectorId === "PRODUCCION";

  const handleRestoreFeedback = useCallback(
    (message: string) => {
      setTick((value) => value + 1);
      showFeedback(message);
    },
    [showFeedback]
  );

  const showSectorColumn = sectors.length > 1;

  const finalizadosColumns: OperationalTableColumn<HistorialRow>[] = [
    {
      key: "fecha",
      header: "Fecha",
      render: (r) =>
        r.fecha
          ? new Date(r.fecha).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" })
          : "—",
    },
    ...(showSectorColumn
      ? [
          {
            key: "sector",
            header: "Sector",
            render: (r: HistorialRow) => SECTOR_LABELS[r.sector],
          } satisfies OperationalTableColumn<HistorialRow>,
        ]
      : []),
    { key: "cliente", header: "Cliente", render: (r) => displayField(r.cliente) },
    { key: "producto", header: "Producto", render: (r) => displayField(r.producto) },
    { key: "cantidad", header: "Cantidad", render: (r) => r.cantidad || "—" },
    { key: "estado", header: "Estado", render: (r) => <StatusChip status={r.estado} /> },
    {
      key: "obs_sector",
      header: "Observación del sector",
      render: (r) => (
        <span className="text-xs text-[var(--os-text-muted)]">{r.observacionSector || "—"}</span>
      ),
    },
    {
      key: "obs_calidad",
      header: "Observación de Calidad",
      render: (r) => (
        <span
          className={`text-xs ${r.estado === "rechazado" ? "font-medium text-[var(--genus-error)]" : "text-[var(--os-text-muted)]"}`}
        >
          {r.observacionCalidad || "—"}
        </span>
      ),
    },
  ];

  const canceladosColumns: OperationalTableColumn<CancelledOrDeletedRow>[] = [
    {
      key: "fecha",
      header: "Fecha",
      render: (r) =>
        r.at
          ? new Date(r.at).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" })
          : "—",
    },
    {
      key: "tipo",
      header: "Tipo de acción",
      render: (r) => ACTION_KIND_LABELS[r.kind],
    },
    { key: "producto", header: "Producto", render: (r) => displayField(r.item.product) },
    { key: "cliente", header: "Cliente", render: (r) => displayField(r.item.client) },
    ...(showSectorColumn
      ? [
          {
            key: "sector",
            header: "Sector",
            render: (r: CancelledOrDeletedRow) => SECTOR_LABELS[r.item.sector],
          } satisfies OperationalTableColumn<CancelledOrDeletedRow>,
        ]
      : []),
    {
      key: "estado_anterior",
      header: "Estado anterior",
      render: (r) => r.previousStatus,
    },
    { key: "actor", header: "Actor", render: (r) => r.actor },
    {
      key: "motivo",
      header: "Motivo",
      render: (r) => (
        <span className="text-xs text-[var(--os-text-muted)]">{r.reason || "—"}</span>
      ),
    },
    {
      key: "accion",
      header: "Acción",
      render: (r) =>
        canRestore && (r.kind === "cancelado" || r.kind === "eliminado" || r.kind === "archivado") ? (
          <AssignedWorkLifecycleActions
            item={r.item}
            actorSectorId={sectorId}
            actorName={workspace.context.displayName}
            inactiveKind={r.kind}
            onChanged={() => handleRestoreFeedback("Trabajo restaurado. Volvió a la bandeja activa.")}
            onToast={(message) => showFeedback(message)}
          />
        ) : canRestore ? (
          <span className="text-xs text-[var(--os-text-muted)]">—</span>
        ) : (
          <span className="text-xs text-[var(--os-text-muted)]">Solo Producción</span>
        ),
    },
  ];

  const tabs = [
    { id: "finalizados" as const, label: "Finalizados", count: finalizadosRows.length },
    { id: "cancelados" as const, label: "Cancelados y eliminados", count: canceladosRows.length },
  ];

  return (
    <TwinShell title={title}>
      <div className="space-y-4">
        <header className="space-y-2">
          <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
          <p className="text-sm text-[var(--os-text-muted)]">
            {workspace.sectorLabel} · trabajos finalizados y su resultado de Calidad
          </p>
        </header>

        {feedback && (
          <p
            role="status"
            className="rounded-[var(--os-radius-sm)] border border-[var(--os-border)] bg-[var(--os-surface)] px-4 py-3 text-sm"
          >
            {feedback}
          </p>
        )}

        <OperationalTabs tabs={tabs} activeId={tab} onChange={(id) => setTab(id as HistorialTab)} />

        {tab === "finalizados" && (
          <>
            <div className="flex justify-end">
              <SortSelect
                value={finalizadosSort}
                onChange={setFinalizadosSort}
                options={HISTORIAL_FINALIZADOS_SORT_OPTIONS}
                testId="historial-finalizados-sort"
              />
            </div>
            <OperationalTable
              columns={finalizadosColumns}
              rows={finalizadosRows}
              rowKey={(r) => r.id}
              emptyMessage="Todavía no hay trabajos finalizados en el historial."
            />
          </>
        )}

        {tab === "cancelados" && (
          <div className="space-y-3">
            <div className="flex justify-end">
              <SortSelect
                value={canceladosSort}
                onChange={setCanceladosSort}
                options={HISTORIAL_CANCELADOS_SORT_OPTIONS}
                testId="historial-cancelados-sort"
              />
            </div>
            <p className="text-sm text-[var(--os-text-muted)]">
              <strong className="font-medium text-[var(--os-text)]">Cancelados</strong> son trabajos que
              tenían avance y se dieron de baja con motivo.{" "}
              <strong className="font-medium text-[var(--os-text)]">Eliminados</strong> son pendientes sin
              avances que Producción quitó de la bandeja activa (baja lógica).{" "}
              <strong className="font-medium text-[var(--os-text)]">Archivados</strong> son trabajos
              finalizados que se ocultaron del panel operativo. Desde acá, Producción puede restaurarlos si
              no hay un conflicto con un trabajo activo similar.
            </p>
            <OperationalTable
              columns={canceladosColumns}
              rows={canceladosRows}
              rowKey={(r) => `${r.kind}-${r.item.id}`}
              emptyMessage="No hay trabajos cancelados, eliminados ni archivados."
            />
          </div>
        )}
      </div>
    </TwinShell>
  );
}
