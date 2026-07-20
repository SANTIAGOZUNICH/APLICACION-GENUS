"use client";

import { useMemo } from "react";
import { displayField } from "@/lib/operational/display-fields";
import { SECTOR_LABELS, type SectorId } from "@/types/operational/sector";
import { useOperationalPlan } from "../hooks/use-operational-plan";
import { useOperationalStore } from "../store/operational-store-context";
import { OperationalTable, StatusChip, type OperationalTableColumn } from "../components/operational-ui";
import { TwinShell } from "@/features/os/shell/twin-shell";
import { useRequiredWorkspace } from "@/features/os/workspace/workspace-provider";
import {
  getManualWorkItemMeta,
  listInactiveManualWorkItems,
} from "../adapters/manual-work-items-repository";

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

interface HistorialViewProps {
  sectors: SectorId[];
  title?: string;
}

/** Historial de trabajos finalizados por sector — cruza eventos de cierre con decisión de Calidad. */
export function HistorialView({ sectors, title = "Historial" }: HistorialViewProps) {
  const workspace = useRequiredWorkspace();
  const { completionEvents, getQualityStatus, getQualityObservation } = useOperationalStore();
  const { data: calidadData } = useOperationalPlan("CALIDAD");

  const rows = useMemo<HistorialRow[]>(() => {
    const qualityItems = calidadData?.qualityItems ?? [];
    const events = completionEvents.filter((e) => sectors.includes(e.sourceSector));

    const completionRows = events.map((event) => {
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

    const inactiveManualRows =
      workspace.context.sectorId === "PRODUCCION"
        ? listInactiveManualWorkItems()
            .filter((item) => sectors.includes(item.sector))
            .map((item) => {
              const meta = getManualWorkItemMeta(item.id);
              const archived = Boolean(meta?.archived);
              return {
                id: `manual-inactive-${item.id}`,
                fecha: meta?.cancelledAt ?? meta?.archivedAt ?? item.deliveryDate ?? item.plannedDate ?? "",
                sector: item.sector,
                cliente: item.client,
                producto: item.product ?? "Trabajo manual",
                cantidad: [item.quantity, item.unit ?? ""].filter(Boolean).join(" "),
                estado: item.status === "cancelado" ? "cancelado" : "completo",
                observacionSector:
                  meta?.cancelReason ??
                  (archived ? "Trabajo finalizado archivado por Producción." : item.notes ?? ""),
                observacionCalidad: "",
                decididoPor: meta?.cancelledBy ?? meta?.archivedBy ?? meta?.assignedBy ?? "Producción",
              } satisfies HistorialRow;
            })
        : [];

    return [...completionRows, ...inactiveManualRows]
      .sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime());
  }, [
    completionEvents,
    calidadData?.qualityItems,
    sectors,
    getQualityStatus,
    getQualityObservation,
    workspace.context.sectorId,
  ]);

  const showSectorColumn = sectors.length > 1;

  const columns: OperationalTableColumn<HistorialRow>[] = [
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
          className={`text-xs ${r.estado === "rechazado" ? "font-medium text-rose-700" : "text-[var(--os-text-muted)]"}`}
        >
          {r.observacionCalidad || "—"}
        </span>
      ),
    },
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

      <OperationalTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        emptyMessage="Todavía no hay trabajos finalizados en el historial."
      />
    </div>
    </TwinShell>
  );
}
