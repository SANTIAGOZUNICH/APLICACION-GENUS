"use client";

import { useMemo } from "react";
import { TwinShell } from "@/features/os/shell/twin-shell";
import { useRequiredWorkspace } from "@/features/os/workspace/workspace-provider";
import { usePreviewContext, usePreviewSession } from "@/features/os/session/preview-context";
import { displayField } from "@/lib/operational/display-fields";
import {
  OperationalTable,
  StatusChip,
  SyncStatusBar,
  type OperationalTableColumn,
} from "../components/operational-ui";
import { useOperationalPlan } from "../hooks/use-operational-plan";
import { formatQuantity } from "../lib/operational-filters";
import type { WorkItem } from "@/types/operational/work-item";

interface EnvasadoOperationalViewProps {
  sectorId: "ENVASADO_MASIVO" | "ENVASADO_PREMIUM";
}

/** Vista operativa envasado — tabla por líneas, estilo plan semanal. */
export function EnvasadoOperationalView({ sectorId }: EnvasadoOperationalViewProps) {
  const workspace = useRequiredWorkspace();
  const { applyEffectiveStatus } = usePreviewContext();
  const { data, loading, error, lastRefreshAt, refresh } = useOperationalPlan(sectorId);

  const workItems = useMemo(
    () => applyEffectiveStatus(data?.workItems ?? []),
    [data?.workItems, applyEffectiveStatus]
  );

  const columns: OperationalTableColumn<WorkItem>[] = useMemo(
    () => [
      {
        key: "line",
        header: "Línea",
        render: (row) => <span className="font-medium">{displayField(row.line)}</span>,
      },
      {
        key: "client",
        header: "Cliente",
        render: (row) => displayField(row.client),
      },
      {
        key: "product",
        header: "Producto",
        render: (row) => displayField(row.product),
      },
      {
        key: "quantity",
        header: "Cantidad",
        render: (row) => formatQuantity(row),
      },
      {
        key: "day",
        header: "Plazo",
        render: (row) => displayField(row.dayLabel ?? row.deliveryDate),
      },
      {
        key: "oa",
        header: "OA",
        render: (row) => (
          <span className="font-mono text-xs">{displayField(row.oaRef)}</span>
        ),
      },
      {
        key: "status",
        header: "Estado",
        render: (row) => <StatusChip status={row.status} />,
      },
    ],
    []
  );

  const sortedItems = useMemo(
    () =>
      [...workItems].sort((a, b) =>
        (a.line ?? "").localeCompare(b.line ?? "", "es", { sensitivity: "base" })
      ),
    [workItems]
  );

  return (
    <TwinShell title={workspace.sectorLabel}>
      <header className="mb-6 space-y-2">
        <h2 className="text-2xl font-semibold tracking-tight">{workspace.sectorLabel}</h2>
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

      {loading && !data && <div className="os-skeleton h-48 rounded-[var(--os-radius)]" />}

      {!loading && sortedItems.length === 0 && (
        <p className="text-sm text-[var(--os-text-muted)]">
          {data?.message ?? "Sin líneas de acondicionamiento para este sector."}
        </p>
      )}

      {sortedItems.length > 0 && (
        <OperationalTable
          columns={columns}
          rows={sortedItems}
          rowKey={(row) => row.id}
          emptyMessage="Sin trabajos en planificación."
        />
      )}
    </TwinShell>
  );
}

/** Elaboración filtrada por persona — Cristian / Nicolás. */
export function ElaboracionOperationalView() {
  const workspace = useRequiredWorkspace();
  const { ownerPerson } = usePreviewSession();
  const { applyEffectiveStatus } = usePreviewContext();
  const { data, loading, error, lastRefreshAt, refresh } = useOperationalPlan("ELABORACION", {
    ownerPerson,
  });

  const greetingName = ownerPerson ?? workspace.context.firstName;

  const workItems = useMemo(
    () => applyEffectiveStatus(data?.workItems ?? []),
    [data?.workItems, applyEffectiveStatus]
  );

  const columns: OperationalTableColumn<WorkItem>[] = useMemo(
    () => [
      {
        key: "client",
        header: "Cliente",
        render: (row) => displayField(row.client),
      },
      {
        key: "product",
        header: "Producto",
        render: (row) => <span className="font-medium">{displayField(row.product)}</span>,
      },
      {
        key: "quantity",
        header: "Kg",
        render: (row) => formatQuantity(row),
      },
      {
        key: "day",
        header: "Plazo",
        render: (row) => displayField(row.dayLabel ?? row.deliveryDate),
      },
      {
        key: "oe",
        header: "OE",
        render: (row) => (
          <span className="font-mono text-xs">{displayField(row.oeRef)}</span>
        ),
      },
      {
        key: "status",
        header: "Estado",
        render: (row) => <StatusChip status={row.status} />,
      },
    ],
    []
  );

  return (
    <TwinShell title="Elaboración">
      <header className="mb-6 space-y-2">
        <h2 className="text-2xl font-semibold tracking-tight">Hola, {greetingName}</h2>
        <p className="text-sm text-[var(--os-text-muted)]">
          Elaboraciones asignadas · bloque {greetingName} en SEMANAS
        </p>
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

      {loading && !data && <div className="os-skeleton h-40 rounded-[var(--os-radius)]" />}

      <OperationalTable
        columns={columns}
        rows={workItems}
        rowKey={(row) => row.id}
        emptyMessage={`Sin elaboraciones para ${greetingName}.`}
      />
    </TwinShell>
  );
}
