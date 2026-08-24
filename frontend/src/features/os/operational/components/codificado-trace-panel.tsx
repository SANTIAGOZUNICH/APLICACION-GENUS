"use client";

import { displayField } from "@/lib/operational/display-fields";
import { Button } from "@/components/ui/button";
import {
  packingGroupsFromLegacy,
  summarizePackingGroups,
} from "@/lib/remitos/packing-math";
import { SECTOR_LABELS } from "@/types/operational/sector";
import type { WorkProgressRecord } from "../store/operational-store";
import type { WorkItem } from "@/types/operational/work-item";

/** Detalle de embalaje + trazabilidad Codificado para Calidad / Producción. */
export function CodificadoTracePanel({
  workItem,
  progress,
  fallbackQuantity,
  onCorrectLoteVto,
}: {
  workItem?: WorkItem | null;
  progress?: WorkProgressRecord | null;
  fallbackQuantity?: string | null;
  /** Solo Producción la pasa — habilita el botón "Corregir lote/VTO" (PARTE A). */
  onCorrectLoteVto?: () => void;
}) {
  const total =
    progress?.packagingTotalUnits ??
    workItem?.packagingTotalUnits ??
    (fallbackQuantity?.trim() ? fallbackQuantity : null);
  const lote =
    progress?.packagingLote ??
    workItem?.packagingLote ??
    workItem?.loteRef ??
    null;
  const vto = progress?.packagingVto ?? workItem?.packagingVto ?? null;
  const groups = packingGroupsFromLegacy({
    packingGroups: progress?.packingGroups ?? workItem?.packingGroups,
    cajas: progress?.packagingCajas ?? workItem?.packagingCajas,
    unidadesPorCaja:
      progress?.packagingUnidadesPorCaja ?? workItem?.packagingUnidadesPorCaja,
  });
  const summary = summarizePackingGroups(groups);
  const viaCodificado = Boolean(progress?.viaCodificado);
  // progress viene de un overlay client-side (localStorage) que nunca se
  // completa para trabajos nativos — sin fallback a workItem (Neon, siempre
  // fresco) estos campos quedaban invisibles para Calidad/Producción aunque
  // estuvieran correctamente persistidos (mismo fix aplicado en PR #78).
  const bulkKg = progress?.bulkRemainderKg ?? workItem?.bulkRemainderKg ?? null;
  const bulkObservation =
    progress?.bulkRemainderObservation ?? workItem?.bulkRemainderObservation ?? null;
  const sampleUnits = workItem?.sampleUnits ?? null;
  const deliverableUnits = workItem?.deliverableUnits ?? null;
  const packagingClosedAt = workItem?.packagingClosedAt ?? null;
  const packagingClosedBy = workItem?.packagingClosedBy ?? null;
  // Datos siempre desde workItem (Neon) — nunca inventados, "—" si no existen.
  const pedidoOp = workItem?.pedidoOp ?? null;
  const plannedQuantity =
    workItem?.quantity != null && workItem.quantity !== ""
      ? `${workItem.quantity} ${workItem?.unit ?? ""}`.trim()
      : null;
  const orderRef = workItem?.oeRef ?? workItem?.oaRef ?? null;
  const orderRefLabel = workItem?.oeRef ? "OE" : "OA";
  const plannedDate = workItem?.plannedDate ?? null;
  const reworkReason = workItem?.reworkRequestedAt ? (workItem?.reworkReason ?? "Sin motivo informado") : null;

  return (
    <div
      className="space-y-3 rounded border border-[var(--os-border)] bg-[var(--os-surface)] p-3 text-sm"
      data-testid="codificado-trace-panel"
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--os-text-muted)]">
        {viaCodificado ? "Datos finales (Codificado)" : "Embalaje / trazabilidad"}
      </p>
      <dl className="grid grid-cols-2 gap-3">
        <div>
          <dt className="text-xs uppercase text-[var(--os-text-muted)]">N° de Pedido</dt>
          <dd className="font-medium" data-testid="trace-pedido">
            {displayField(pedidoOp)}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase text-[var(--os-text-muted)]">Cantidad asignada</dt>
          <dd className="font-medium tabular-nums" data-testid="trace-planned-quantity">
            {displayField(plannedQuantity)}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase text-[var(--os-text-muted)]">N° de {orderRefLabel}</dt>
          <dd className="font-mono font-medium" data-testid="trace-order-ref">
            {displayField(orderRef)}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase text-[var(--os-text-muted)]">Fecha de producción</dt>
          <dd className="font-medium" data-testid="trace-planned-date">
            {displayField(plannedDate)}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase text-[var(--os-text-muted)]">Cantidad total (final)</dt>
          <dd className="font-medium tabular-nums" data-testid="trace-total">
            {total != null && total !== "" ? `${total} un.` : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase text-[var(--os-text-muted)]">Lote</dt>
          <dd className="font-mono font-medium" data-testid="trace-lote">
            {displayField(lote)}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase text-[var(--os-text-muted)]">VTO</dt>
          <dd className="font-medium" data-testid="trace-vto">
            {displayField(vto)}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase text-[var(--os-text-muted)]">Sobrante granel</dt>
          <dd className="font-medium tabular-nums" data-testid="trace-bulk">
            {bulkKg != null && bulkKg > 0 ? `${bulkKg} kg` : "—"}
          </dd>
        </div>
      </dl>

      {reworkReason ? (
        <p
          className="rounded border border-[var(--genus-warning,#b45309)]/30 bg-[var(--genus-warning-soft,#fff8e6)] px-2 py-1.5 text-xs"
          data-testid="trace-rework"
        >
          <span className="font-medium text-[var(--genus-warning,#b45309)]">Rehacer: </span>
          {reworkReason}
        </p>
      ) : null}

      {onCorrectLoteVto ? (
        <Button
          type="button"
          size="sm"
          variant="tertiary"
          onClick={onCorrectLoteVto}
          data-testid="trace-correct-lote-vto"
        >
          Corregir lote/VTO
        </Button>
      ) : null}

      <div>
        <p className="mb-1 text-xs uppercase text-[var(--os-text-muted)]">Detalle de cajas</p>
        {summary.groups.length === 0 ? (
          <p className="text-xs text-[var(--os-text-muted)]">Sin cajas informadas.</p>
        ) : (
          <ul className="space-y-0.5 text-sm" data-testid="trace-cajas">
            {summary.groups.map((g, i) => (
              <li key={`${g.cajas}-${g.unidadesPorCaja}-${i}`}>
                Caja {i + 1}: {g.cajas} × {g.unidadesPorCaja} un.
              </li>
            ))}
            {summary.totalEmbalado > 0 ? (
              <li className="text-xs text-[var(--os-text-muted)]">
                Embalado: {summary.totalEmbalado} un.
              </li>
            ) : null}
          </ul>
        )}
      </div>

      {sampleUnits != null || deliverableUnits != null ? (
        <div className="border-t border-[var(--os-border)] pt-3">
          <p className="mb-1 text-xs uppercase text-[var(--os-text-muted)]">
            Cierre físico de acondicionamiento
          </p>
          <dl className="grid grid-cols-2 gap-3">
            <div>
              <dt className="text-xs uppercase text-[var(--os-text-muted)]">
                Muestras (informativo, no afecta el remito)
              </dt>
              <dd className="font-medium tabular-nums" data-testid="trace-samples">
                {sampleUnits != null ? `${sampleUnits} un.` : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase text-[var(--os-text-muted)]">
                Embalado (remito)
              </dt>
              <dd className="font-medium tabular-nums" data-testid="trace-deliverable">
                {deliverableUnits != null ? `${deliverableUnits} un.` : "—"}
              </dd>
            </div>
          </dl>
          {packagingClosedAt ? (
            <p className="mt-1 text-xs text-[var(--os-text-muted)]">
              Cerrado por {displayField(packagingClosedBy)} ·{" "}
              {new Date(packagingClosedAt).toLocaleString("es-AR")}
            </p>
          ) : null}
        </div>
      ) : null}

      {bulkObservation ? (
        <p className="text-xs text-[var(--os-text-muted)]" data-testid="trace-bulk-observation">
          <span className="font-medium text-[var(--os-text)]">Obs. sobrante: </span>
          {bulkObservation}
        </p>
      ) : null}

      {viaCodificado ? (
        <dl className="grid grid-cols-1 gap-2 border-t border-[var(--os-border)] pt-3 sm:grid-cols-2">
          <div>
            <dt className="text-xs uppercase text-[var(--os-text-muted)]">
              Enviado desde Envasado
            </dt>
            <dd className="font-medium" data-testid="trace-sent-by">
              {displayField(progress?.sentToCodificadoBy ?? workItem?.sentToCodificadoBy)}
              {progress?.codificadoOriginSector ? (
                <span className="mt-0.5 block text-xs text-[var(--os-text-muted)]">
                  {SECTOR_LABELS[
                    progress.codificadoOriginSector as keyof typeof SECTOR_LABELS
                  ] ?? progress.codificadoOriginSector}
                </span>
              ) : null}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-[var(--os-text-muted)]">
              Entregado desde Codificado
            </dt>
            <dd className="font-medium" data-testid="trace-delivered-by">
              {displayField(progress?.deliveredFromCodificadoBy ?? workItem?.deliveredFromCodificadoBy)}
            </dd>
          </div>
          {(progress?.codificadoObservation ?? workItem?.operationalObservation) ? (
            <div className="sm:col-span-2">
              <dt className="text-xs uppercase text-[var(--os-text-muted)]">
                Obs. Codificado
              </dt>
              <dd className="text-sm">
                {progress?.codificadoObservation ?? workItem?.operationalObservation}
              </dd>
            </div>
          ) : null}
        </dl>
      ) : null}
    </div>
  );
}
