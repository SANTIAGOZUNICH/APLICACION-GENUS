"use client";

import { useMemo, useState } from "react";
import { TwinShell } from "@/features/os/shell/twin-shell";
import { displayField } from "@/lib/operational/display-fields";
import { SECTOR_LABELS } from "@/types/operational/sector";
import { OperationalTabs, SyncStatusBar } from "../components/operational-ui";
import { DeliveryDateBadge } from "../components/delivery-date-badge";
import { useOperationalPlan } from "../hooks/use-operational-plan";
import { filterQualityByKind, filterQualityByStatus } from "../lib/operational-filters";
import { applyQualityDecisionsToItems } from "../adapters/operational-sheets-adapter";
import { useOperationalStore } from "../store/operational-store-context";
import type { WorkProgressRecord } from "../store/operational-store";
import type { QualityItem } from "../types";
import type { WorkItem } from "@/types/operational/work-item";
import { packingGroupsFromLegacy, summarizePackingGroups } from "@/lib/remitos/packing-math";
import { SortSelect } from "../components/sort-select";
import { useSortPreference } from "../lib/use-sort-preference";
import { applySort, compareDates, compareStrings, type SortOption } from "@/lib/sorting/sort-contract";

type ExpedicionTabId = "pendientes" | "aprobadas";

/**
 * Estados que Depósito ve en Expedición — el MISMO qualityStatus real de
 * Calidad (pendiente/aprobado), sin inventar un segundo estado paralelo.
 * "rechazado" queda fuera de ambas pestañas por construcción (filterQualityByStatus).
 */
const ESTADO_META: Record<string, { label: string; className: string }> = {
  pendiente: {
    label: "Pendiente de aprobación",
    className: "bg-[var(--genus-warning-soft)] text-[var(--genus-warning)]",
  },
  aprobado: {
    label: "Aprobado",
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

function progressKeyFor(item: QualityItem): string {
  return item.relatedWorkItemId ?? (item.id.startsWith("qc:") ? item.id.slice(3) : item.id);
}

function resolveWorkItem(workItems: WorkItem[], item: QualityItem): WorkItem | null {
  const key = progressKeyFor(item);
  return workItems.find((w) => w.id === item.relatedWorkItemId || w.id === key) ?? null;
}

/**
 * Contrato de scope de Expedición: SOLO Envasado Masivo/Premium/Codificado
 * ("salida" — nunca "granel"/Elaboración, ver QualityItemKind) y SOLO
 * pendiente/aprobado — rechazado/cancelado se maneja según la regla ya
 * existente en Calidad (queda fuera de ambas pestañas, igual que acá).
 * Extraída como función pura (en vez de inline en el componente) para que
 * el filtrado se pueda testear sin montar la vista completa.
 */
export function filterExpedicionItems(
  items: QualityItem[],
  status: "pendiente" | "aprobado"
): QualityItem[] {
  return filterQualityByStatus(filterQualityByKind(items, "salida"), status);
}

/**
 * Vista operativa de Depósito — SOLO trabajos de Envasado Masivo, Envasado
 * Premium y Codificado ("salida", nunca Elaboración) camino a Calidad o ya
 * aprobados. No decide Calidad: sin botones aprobar/rechazar. Reusa
 * work_items/qualityItems de Neon vía useOperationalPlan("CALIDAD") — mismo
 * patrón de lectura read-only que ya usa Producción ("ver_calidad").
 */
export function ExpedicionView() {
  const { getQualityStatus, progressMap } = useOperationalStore();
  const { data, loading, error, lastRefreshAt, updatedAgoLabel, liveConnected, refresh } =
    useOperationalPlan("CALIDAD");

  const [tab, setTab] = useState<ExpedicionTabId>("pendientes");
  const [pendientesSort, setPendientesSort] = useSortPreference(
    "expedicion-pendientes",
    "entrega_asc",
    EXPEDICION_SORT_KEYS
  );
  const [aprobadasSort, setAprobadasSort] = useSortPreference(
    "expedicion-aprobadas",
    "entrega_asc",
    EXPEDICION_SORT_KEYS
  );

  const qualityItems = useMemo(() => {
    const seed = data?.qualityItems ?? [];
    return applyQualityDecisionsToItems(seed, getQualityStatus);
  }, [data?.qualityItems, getQualityStatus]);

  const workItems = useMemo(() => data?.workItems ?? [], [data?.workItems]);

  const pendientes = useMemo(
    () =>
      applySort(
        filterExpedicionItems(qualityItems, "pendiente"),
        EXPEDICION_SORT_OPTIONS,
        pendientesSort
      ),
    [qualityItems, pendientesSort]
  );
  const aprobadas = useMemo(
    () =>
      applySort(
        filterExpedicionItems(qualityItems, "aprobado"),
        EXPEDICION_SORT_OPTIONS,
        aprobadasSort
      ),
    [qualityItems, aprobadasSort]
  );

  const rows = tab === "pendientes" ? pendientes : aprobadas;
  const sortValue = tab === "pendientes" ? pendientesSort : aprobadasSort;
  const setSortValue = tab === "pendientes" ? setPendientesSort : setAprobadasSort;

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
          Envasado Masivo, Envasado Premium y Codificado camino a Calidad o ya
          aprobados — vista para preparar la expedición. Depósito no aprueba
          ni rechaza Calidad desde acá.
        </p>

        <OperationalTabs
          tabs={[
            { id: "pendientes", label: "Pendientes de aprobación", count: pendientes.length },
            { id: "aprobadas", label: "Aprobadas", count: aprobadas.length },
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
            {tab === "pendientes"
              ? "Sin trabajos pendientes de aprobación."
              : "Sin trabajos aprobados todavía."}
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
  const estado = ESTADO_META[item.status] ?? { label: item.status, className: "bg-[var(--os-bg)] text-[var(--os-text-muted)]" };

  return (
    <div
      className="space-y-2.5 rounded-[var(--os-radius-sm)] border border-[var(--os-border)] bg-[var(--os-surface)] p-4 shadow-[var(--os-shadow-sm)]"
      data-testid={`expedicion-card-${item.id}`}
    >
      <div className="min-w-0">
        <p className="truncate font-medium">{displayField(item.product)}</p>
        <p className="truncate text-sm text-[var(--os-text-muted)]">{displayField(item.client)}</p>
      </div>

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
        {summary.groups.length === 0 ? (
          <p className="text-xs text-[var(--os-text-muted)]">Sin cajas informadas.</p>
        ) : (
          <ul className="space-y-0.5 text-sm" data-testid="expedicion-cajas">
            {summary.groups.map((g, i) => (
              <li key={`${g.cajas}-${g.unidadesPorCaja}-${i}`}>
                {g.cajas} cajas × {g.unidadesPorCaja} un.
              </li>
            ))}
          </ul>
        )}
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
