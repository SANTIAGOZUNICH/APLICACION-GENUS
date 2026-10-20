"use client";

import { useMemo, useState } from "react";
import { TwinShell } from "@/features/os/shell/twin-shell";
import { displayField } from "@/lib/operational/display-fields";
import { SECTOR_LABELS } from "@/types/operational/sector";
import { OperationalTabs, SyncStatusBar } from "../components/operational-ui";
import { DeliveryDateBadge } from "../components/delivery-date-badge";
import { useOperationalPlan } from "../hooks/use-operational-plan";
import { filterQualityByKind } from "../lib/operational-filters";
import { useOperationalStore } from "../store/operational-store-context";
import type { WorkProgressRecord } from "../store/operational-store";
import type { QualityItem } from "../types";
import type { WorkItem } from "@/types/operational/work-item";
import { PackingSummary } from "@/features/os/operational/components/packing-summary";
import { packingGroupsFromLegacy, summarizePackingGroups } from "@/lib/remitos/packing-math";
import { qualityItemProgressKey, resolveWorkItemForQualityItem } from "../lib/resolve-quality-work-item";
import { WorkItemWarningBadge } from "../components/work-item-warning-badge";
import { SortSelect } from "../components/sort-select";
import { useSortPreference } from "../lib/use-sort-preference";
import { applySort, compareDates, compareStrings, type SortOption } from "@/lib/sorting/sort-contract";

type ExpedicionTabId = "listos" | "entregados";

/** Etapa del trabajo para Depósito: «listos» = terminados sin entrega completa; «entregados» = entrega final cumplida. */
export type ExpedicionStage = "listos" | "entregados";

/**
 * Estado que Depósito ve en Expedición — el estado OPERATIVO real del trabajo (circuito sin Calidad): terminado y
 * listo para entregar, o ya entregado. Sin estados paralelos ni aprobaciones.
 */
const ESTADO_META: Record<string, { label: string; className: string }> = {
  revision: {
    label: "Listo para entregar",
    className: "bg-[var(--genus-warning-soft)] text-[var(--genus-warning)]",
  },
  entregado: {
    label: "Entregado",
    className: "bg-[var(--genus-success-soft)] text-[var(--genus-success)]",
  },
};

const EXPEDICION_SORT_OPTIONS: SortOption<QualityItem>[] = [
  {
    key: "entrega_asc",
    label: "Entrega más próxima",
    compare: (a, b) => compareDates(a.deliveryDate, b.deliveryDate, "asc"),
  },
  {
    key: "entrega_desc",
    label: "Entrega más lejana",
    compare: (a, b) => compareDates(a.deliveryDate, b.deliveryDate, "desc"),
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
    key: "producto_asc",
    label: "Producto A-Z",
    compare: (a, b) => compareStrings(a.product, b.product, "asc"),
  },
  {
    key: "producto_desc",
    label: "Producto Z-A",
    compare: (a, b) => compareStrings(a.product, b.product, "desc"),
  },
];
const EXPEDICION_SORT_KEYS = EXPEDICION_SORT_OPTIONS.map((o) => o.key);

const progressKeyFor = qualityItemProgressKey;
const resolveWorkItem = resolveWorkItemForQualityItem;

/**
 * Contrato de scope de Expedición: SOLO Envasado Masivo/Premium/Codificado ("salida" — nunca "granel"/Elaboración,
 * ver QualityItemKind) y SOLO trabajos «listos para entregar» (terminados, `operationalStatus = revision`) o
 * «entregados». Cancelados u otros estados quedan fuera. Función pura para poder testear el filtrado sin montar la vista.
 */
export function filterExpedicionItems(items: QualityItem[], stage: ExpedicionStage): QualityItem[] {
  const status = stage === "listos" ? "revision" : "entregado";
  return filterQualityByKind(items, "salida").filter((item) => item.operationalStatus === status);
}

/**
 * Vista operativa de Depósito — SOLO trabajos de Envasado Masivo, Envasado Premium y Codificado ("salida", nunca
 * Elaboración) terminados y listos para entregar, o ya entregados. Solo lectura. Reusa work_items/qualityItems de
 * Neon (modelo de lectura de trabajos terminados).
 */
export function ExpedicionView() {
  const { progressMap } = useOperationalStore();
  const { data, loading, error, lastRefreshAt, updatedAgoLabel, liveConnected, refresh } =
    useOperationalPlan("CALIDAD");

  const [tab, setTab] = useState<ExpedicionTabId>("listos");
  const [listosSort, setListosSort] = useSortPreference(
    "expedicion-listos",
    "entrega_asc",
    EXPEDICION_SORT_KEYS
  );
  const [entregadosSort, setEntregadosSort] = useSortPreference(
    "expedicion-entregados",
    "entrega_asc",
    EXPEDICION_SORT_KEYS
  );

  const qualityItems = useMemo(() => data?.qualityItems ?? [], [data?.qualityItems]);

  const workItems = useMemo(() => data?.workItems ?? [], [data?.workItems]);

  const listos = useMemo(
    () => applySort(filterExpedicionItems(qualityItems, "listos"), EXPEDICION_SORT_OPTIONS, listosSort),
    [qualityItems, listosSort]
  );
  const entregados = useMemo(
    () => applySort(filterExpedicionItems(qualityItems, "entregados"), EXPEDICION_SORT_OPTIONS, entregadosSort),
    [qualityItems, entregadosSort]
  );

  const rows = tab === "listos" ? listos : entregados;
  const sortValue = tab === "listos" ? listosSort : entregadosSort;
  const setSortValue = tab === "listos" ? setListosSort : setEntregadosSort;

  return (
    <TwinShell title="Expedición">
      <div className="space-y-4">
        <SyncStatusBar
          source={data?.source ?? "native"}
          lastRefreshAt={lastRefreshAt}
          updatedAgoLabel={updatedAgoLabel}
          liveConnected={liveConnected}
          loading={loading}
          detailMessage={error ?? data?.message}
          onRefresh={refresh}
        />
        <p className="text-sm text-[var(--os-text-muted)]">
          Envasado Masivo, Envasado Premium y Codificado: trabajos terminados listos
          para entregar o ya entregados — vista para preparar la expedición.
        </p>

        <OperationalTabs
          tabs={[
            { id: "listos", label: "Listos para entregar", count: listos.length },
            { id: "entregados", label: "Entregados", count: entregados.length },
          ]}
          activeId={tab}
          onChange={(id) => setTab(id as ExpedicionTabId)}
        />

        <div className="flex justify-end">
          <SortSelect
            value={sortValue}
            onChange={setSortValue}
            options={EXPEDICION_SORT_OPTIONS}
            testId="expedicion-sort"
          />
        </div>

        {rows.length === 0 ? (
          <p className="rounded-[var(--os-radius-sm)] border border-dashed border-[var(--os-border)] px-4 py-8 text-center text-sm text-[var(--os-text-muted)]">
            {tab === "listos"
              ? "Sin trabajos listos para entregar."
              : "Sin trabajos entregados todavía."}
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {rows.map((item) => (
              <ExpedicionCard
                key={item.id}
                item={item}
                workItem={resolveWorkItem(workItems, item)}
                progress={progressMap[progressKeyFor(item)] ?? null}
              />
            ))}
          </div>
        )}
      </div>
    </TwinShell>
  );
}

export function ExpedicionCard({
  item,
  workItem,
  progress,
}: {
  item: QualityItem;
  workItem: WorkItem | null;
  progress: WorkProgressRecord | null;
}) {
  const lote =
    progress?.packagingLote ?? workItem?.packagingLote ?? workItem?.loteRef ?? item.lote ?? null;
  const vto = progress?.packagingVto ?? workItem?.packagingVto ?? item.vto ?? null;
  const groups = packingGroupsFromLegacy({
    packingGroups: progress?.packingGroups ?? workItem?.packingGroups ?? item.packingGroups,
    cajas: progress?.packagingCajas ?? workItem?.packagingCajas,
    unidadesPorCaja: progress?.packagingUnidadesPorCaja ?? workItem?.packagingUnidadesPorCaja,
  });
  const summary = summarizePackingGroups(groups);
  const cantidadFinal = item.finishedQty ?? item.quantity ?? workItem?.finishedQty ?? null;
  const cantidadEmbalada =
    summary.totalEmbalado > 0 ? summary.totalEmbalado : (item.packedUnits ?? workItem?.deliverableUnits ?? null);
  const oaRef = workItem?.oaRef ?? item.oa ?? null;
  const deliveryDate = workItem?.deliveryDate ?? item.deliveryDate ?? null;
  const originSector = item.receivedFrom ?? workItem?.codificadoOriginSector ?? null;
  const originLabel = originSector ? (SECTOR_LABELS[originSector] ?? originSector) : "Planilla";
  const estado = ESTADO_META[item.operationalStatus ?? ""] ?? {
    label: item.operationalStatus ?? "—",
    className: "bg-[var(--os-bg)] text-[var(--os-text-muted)]",
  };

  return (
    <div
      className="space-y-2.5 rounded-[var(--os-radius-sm)] border border-[var(--os-border)] bg-[var(--os-surface)] p-4 shadow-[var(--os-shadow-sm)]"
      data-testid={`expedicion-card-${item.id}`}
    >
      <div className="min-w-0">
        <p className="truncate font-medium">{displayField(item.product)}</p>
        <p className="truncate text-sm text-[var(--os-text-muted)]">{displayField(item.client)}</p>
      </div>

      {workItem ? <WorkItemWarningBadge item={workItem} /> : null}

      <dl className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <dt className="uppercase text-[var(--os-text-muted)]">Cantidad final</dt>
          <dd className="font-medium tabular-nums" data-testid="expedicion-cantidad-final">
            {cantidadFinal != null && cantidadFinal !== "" ? `${cantidadFinal} un.` : "—"}
          </dd>
        </div>
        <div>
          <dt className="uppercase text-[var(--os-text-muted)]">Cantidad embalada</dt>
          <dd className="font-medium tabular-nums" data-testid="expedicion-cantidad-embalada">
            {cantidadEmbalada != null ? `${cantidadEmbalada} un.` : "—"}
          </dd>
        </div>
        <div>
          <dt className="uppercase text-[var(--os-text-muted)]">Lote</dt>
          <dd className="font-mono font-medium" data-testid="expedicion-lote">
            {displayField(lote)}
          </dd>
        </div>
        <div>
          <dt className="uppercase text-[var(--os-text-muted)]">VTO</dt>
          <dd className="font-medium" data-testid="expedicion-vto">
            {displayField(vto)}
          </dd>
        </div>
        <div>
          <dt className="uppercase text-[var(--os-text-muted)]">OA</dt>
          <dd className="font-mono font-medium">{displayField(oaRef)}</dd>
        </div>
        <div>
          <dt className="uppercase text-[var(--os-text-muted)]">Sector de origen</dt>
          <dd className="font-medium">{originLabel}</dd>
        </div>
      </dl>

      <div>
        <p className="mb-1 text-xs uppercase text-[var(--os-text-muted)]">Detalle de cajas</p>
        <PackingSummary groups={summary.groups} detail testId="expedicion-cajas" />
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-[var(--os-border)] pt-2">
        <DeliveryDateBadge deliveryDate={deliveryDate} />
        <span
          className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${estado.className}`}
          data-testid="expedicion-estado"
        >
          {estado.label}
        </span>
      </div>
    </div>
  );
}
