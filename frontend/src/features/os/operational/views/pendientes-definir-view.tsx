"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { WorkItem } from "@/types/operational/work-item";
import type { SectorId } from "@/types/operational/sector";
import { SECTOR_LABELS } from "@/types/operational/sector";
import { TwinShell } from "@/features/os/shell/twin-shell";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { displayField } from "@/lib/operational/display-fields";
import { usePreviewContext, usePreviewSession } from "@/features/os/session/preview-context";
import { useRequiredWorkspace } from "@/features/os/workspace/workspace-provider";
import { postReworkWork } from "@/lib/api/live-sync-client";
import { resolveDeliveryTarget } from "@/lib/planning/circuit/delivery-math";
import { PENDING_ACTION_LABEL, type PendingDefinitionAction } from "@/lib/planning/circuit/pending-definition";
import { summarizePackingGroups } from "@/lib/remitos/packing-math";
import {
  fetchDeliveryProgress,
  fetchPendingDefinition,
  postCircuitDelivery,
  postSendToEnvasado,
  type DeliveryProgress,
  type PendingDefinitionItem,
} from "../adapters/circuit-client";
import { postCodificadoHandoff } from "../adapters/codificado-handoff-client";
import { DeliverWorkDialog, type DeliverWorkPayload } from "../components/deliver-work-dialog";
import { MarkReadyPanel } from "../components/mark-ready-panel";
import { SendToCodificadoDialog } from "../components/send-to-codificado-dialog";
import { SendToEnvasadoDialog, type SendToEnvasadoPayload } from "../components/send-to-envasado-dialog";
import { StatusChip } from "../components/operational-ui";
import {
  BulkDeleteDialog,
  BulkSelectCheckbox,
  BulkSelectionBar,
  bulkRowClassName,
  useBulkSelection,
} from "../components/bulk-select";
import { useBulkDeleteWorks } from "../components/bulk-select/use-bulk-delete-works";
import { canMutateAssignedWork } from "../lib/work-mutation-rbac";

type ActiveAction = { kind: PendingDefinitionAction; row: PendingDefinitionItem } | null;

function totalUnits(item: WorkItem): number | null {
  const packed = item.packingGroups?.length ? summarizePackingGroups(item.packingGroups).totalEmbalado : 0;
  return resolveDeliveryTarget({
    unit: item.unit,
    deliverableUnits: item.deliverableUnits ?? (packed > 0 ? packed : null),
    packagingTotalUnits: item.packagingTotalUnits ?? null,
    finishedQty: item.finishedQty ?? null,
    plannedQuantity: item.quantity,
  });
}

/**
 * Pendientes de definir (Producción/Dirección): trabajos terminados que quedaron sin destino — incluye los que estaban
 * pendientes en la ex-bandeja de Calidad. NUNCA se marcan entregados automáticamente: cada uno se resuelve con la
 * acción de su sector (registrar la entrega, enviar a Codificado/Envasado, rehacer) o queda «pendiente de asignación».
 */
export function PendientesDefinirView() {
  const workspace = useRequiredWorkspace();
  const { showToast, openWorkItem } = usePreviewContext();
  const { email, sectorId } = usePreviewSession();
  const session = useMemo(() => ({ email, sector: sectorId }), [email, sectorId]);
  const actorName = workspace.context.displayName || email || "Producción";

  const [rows, setRows] = useState<PendingDefinitionItem[]>([]);
  const [legacyCount, setLegacyCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<ActiveAction>(null);
  const [progress, setProgress] = useState<DeliveryProgress | null>(null);
  const [reworkReason, setReworkReason] = useState("");
  const [reworkBusy, setReworkBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchPendingDefinition(session);
      setRows(data.items);
      setLegacyCount(data.legacyQualityPending);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron cargar los pendientes.");
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    void load();
  }, [load]);

  const start = useCallback(
    (kind: PendingDefinitionAction, row: PendingDefinitionItem) => {
      if (kind === "ASIGNAR") {
        openWorkItem(row.workItem.id);
        return;
      }
      setReworkReason("");
      if (kind === "REGISTRAR_ENTREGA") {
        void fetchDeliveryProgress(session, row.workItem.id)
          .then(setProgress)
          .catch(() => setProgress(null))
          .finally(() => setActive({ kind, row }));
        return;
      }
      setActive({ kind, row });
    },
    [openWorkItem, session]
  );

  const close = useCallback(() => setActive(null), []);

  const deliver = useCallback(
    async (payload: DeliverWorkPayload) => {
      if (!active) return;
      const item = active.row.workItem;
      const result = await postCircuitDelivery(session, {
        workItemId: item.id,
        actorSectorId: sectorId,
        deliverQuantity: payload.deliverQuantity,
        idempotencyKey: payload.idempotencyKey,
        actualDeliveredAt: payload.actualDeliveredAt,
        remito: payload.remito,
        receivedBy: payload.receivedBy,
        observations: payload.observations,
        plannedDeliveryDate: item.deliveryDate ?? null,
        sourceSector: item.sector,
      });
      showToast(
        result.complete ? "Entrega registrada." : `Entrega parcial registrada. Saldo pendiente: ${result.pending ?? "—"}.`
      );
      await load();
    },
    [active, session, sectorId, showToast, load]
  );

  const sendCodificado = useCallback(
    (payload: { totalUnits: number; observation: string; bulkRemainderKg?: number | null; bulkRemainderObservation?: string | null }) => {
      if (!active) return;
      const item = active.row.workItem;
      void postCodificadoHandoff(session, item.id, {
        action: "send",
        totalUnits: payload.totalUnits,
        observation: payload.observation,
        packagingLote: item.packagingLote,
        packagingVto: item.packagingVto,
        packingGroups: item.packingGroups,
        sampleUnits: item.sampleUnits,
        bulkRemainderKg: payload.bulkRemainderKg,
        bulkRemainderObservation: payload.bulkRemainderObservation,
        expectedVersion: null,
        idempotencyKey:
          typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `send-${item.id}-${Date.now()}`,
      })
        .then(() => {
          showToast("Trabajo enviado a Codificado.");
          setActive(null);
          return load();
        })
        .catch((err) => showToast(err instanceof Error ? err.message : "No se pudo enviar a Codificado.", "info"));
    },
    [active, session, showToast, load]
  );

  const sendEnvasado = useCallback(
    async (payload: SendToEnvasadoPayload) => {
      if (!active) return;
      await postSendToEnvasado(session, active.row.workItem.id, {
        destination: payload.destination,
        line: payload.line,
        producedQuantity: payload.producedQuantity || null,
        unitsToPackage: payload.unitsToPackage || null,
        observation: payload.observation || null,
        idempotencyKey: payload.idempotencyKey,
      });
      showToast("Enviado a Envasado.");
      await load();
    },
    [active, session, showToast, load]
  );

  const rework = useCallback(async () => {
    if (!active) return;
    setReworkBusy(true);
    try {
      const res = await postReworkWork({
        itemId: active.row.workItem.id,
        reason: reworkReason.trim() || null,
        requestedBy: actorName,
        actorSectorId: sectorId as SectorId,
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "No se pudo rehacer el trabajo.");
      showToast("El trabajo volvió a su sector para corregirlo.");
      setActive(null);
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "No se pudo rehacer el trabajo.", "info");
    } finally {
      setReworkBusy(false);
    }
  }, [active, reworkReason, actorName, sectorId, showToast, load]);

  const activeItem = active?.row.workItem ?? null;

  // Selección múltiple + eliminación masiva (solo Producción; el servidor lo valida de nuevo).
  const visibleIds = useMemo(() => rows.map((r) => r.workItem.id), [rows]);
  const selection = useBulkSelection(visibleIds);
  const canBulkDelete = canMutateAssignedWork(sectorId as SectorId);
  const bulk = useBulkDeleteWorks({
    session,
    selectedIds: selection.selected,
    showToast,
    onDone: async () => {
      selection.clear();
      await load();
    },
  });
  const bulkItems = useMemo(
    () =>
      rows
        .filter((r) => selection.isSelected(r.workItem.id))
        .map((r) => ({
          id: r.workItem.id,
          label: displayField(r.workItem.product),
          detail: displayField(r.workItem.client),
        })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, selection.selected]
  );

  return (
    <TwinShell title="Pendientes de definir">
      <header className="mb-4 space-y-1">
        <h2 className="text-2xl font-semibold tracking-tight">Pendientes de definir</h2>
        <p className="text-sm text-[var(--os-text-muted)]">
          Trabajos terminados que todavía no tienen destino. Nada se marca como entregado de forma automática: elegí la
          acción de cada uno.
        </p>
        {legacyCount > 0 ? (
          <p
            className="rounded bg-[var(--genus-warning-soft)] px-3 py-2 text-xs text-[var(--genus-warning)]"
            data-testid="pendientes-legacy-banner"
          >
            {legacyCount} trabajo(s) estaban pendientes en la bandeja de Calidad, que ya no forma parte del circuito. Quedaron
            registrados en la auditoría y se muestran acá para que los definas.
          </p>
        ) : null}
      </header>

      {error ? (
        <p className="mb-3 rounded bg-[var(--genus-error-soft)] px-3 py-2 text-sm text-[var(--genus-error)]" role="alert">
          {error}
        </p>
      ) : null}

      {loading ? (
        <div className="os-skeleton h-40 rounded-[var(--os-radius)]" />
      ) : rows.length === 0 ? (
        <p className="text-sm text-[var(--os-text-muted)]" data-testid="pendientes-empty">
          No hay trabajos pendientes de definir.
        </p>
      ) : (
        <div className="overflow-x-auto">
          {canBulkDelete ? (
            <BulkSelectionBar
              selection={selection}
              scopeLabel={`de ${selection.visibleCount} pendientes visibles en esta vista`}
              onDelete={bulk.start}
              busy={bulk.busy}
            />
          ) : null}
          <table className="os-table w-full text-sm" data-testid="pendientes-table">
            <thead>
              <tr className="text-left text-xs uppercase text-[var(--os-text-muted)]">
                {canBulkDelete ? (
                  <th className="w-10 py-2">
                    <BulkSelectCheckbox
                      checked={selection.allVisibleSelected}
                      indeterminate={selection.someSelected}
                      onChange={selection.toggleAllVisible}
                      label="Seleccionar todos los pendientes visibles"
                      testId="bulk-select-all"
                    />
                  </th>
                ) : null}
                <th className="py-2">Producto</th>
                <th className="hidden py-2 md:table-cell">Cliente</th>
                <th className="py-2">Cant.</th>
                <th className="hidden py-2 lg:table-cell">Sector</th>
                <th className="hidden py-2 lg:table-cell">Terminado</th>
                <th className="py-2">Situación</th>
                <th className="py-2">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const item = row.workItem;
                const total = totalUnits(item);
                return (
                  <tr
                    key={item.id}
                    className={`border-t border-[var(--os-border)] align-top ${bulkRowClassName(selection.isSelected(item.id))}`}
                    data-testid="pendiente-row"
                    data-selected={selection.isSelected(item.id) ? "true" : "false"}
                  >
                    {canBulkDelete ? (
                      <td className="w-10 py-2">
                        <BulkSelectCheckbox
                          checked={selection.isSelected(item.id)}
                          onChange={() => selection.toggle(item.id)}
                          label={`Seleccionar ${displayField(item.product)}`}
                          testId="bulk-select-row"
                        />
                      </td>
                    ) : null}
                    <td className="py-2 pr-2">
                      <span className="font-medium">{displayField(item.product)}</span>
                      <span className="mt-0.5 block text-xs text-[var(--os-text-muted)] md:hidden">
                        {displayField(item.client)}
                      </span>
                    </td>
                    <td className="hidden py-2 pr-2 md:table-cell">{displayField(item.client)}</td>
                    <td className="py-2 tabular-nums">
                      {total != null ? total : "—"} {item.unit ?? ""}
                    </td>
                    <td className="hidden py-2 text-xs lg:table-cell">{SECTOR_LABELS[item.sector]}</td>
                    <td className="hidden py-2 text-xs lg:table-cell">
                      {item.completedAt ? new Date(item.completedAt).toLocaleString("es-AR") : "—"}
                    </td>
                    <td className="py-2 pr-2 text-xs">
                      <StatusChip status="revision" />
                      <p className="mt-1 text-[var(--os-text-muted)]">{row.info.label}</p>
                      {row.info.legacyQualityPending ? (
                        <p className="mt-1 font-medium text-[var(--genus-warning)]">Estaba pendiente en Calidad</p>
                      ) : null}
                      {row.info.hadQualityDecision ? (
                        <p className="mt-1 text-[var(--os-text-muted)]">
                          Calidad ({item.qualityStatus === "aprobado" ? "aprobó" : "rechazó"}) — histórico
                        </p>
                      ) : null}
                    </td>
                    <td className="py-2">
                      <div className="flex flex-wrap gap-1.5">
                        {row.info.actions.map((action) => (
                          <Button
                            key={action}
                            size="sm"
                            variant={action === "REHACER" ? "secondary" : "primary"}
                            onClick={() => start(action, row)}
                            data-testid={`pendiente-action-${action}`}
                          >
                            {PENDING_ACTION_LABEL[action]}
                          </Button>
                        ))}
                      </div>
                      {/* Trabajo terminado del último sector (Envasado/Codificado): confirmación explícita de disponibilidad. */}
                      {item.sector !== "ELABORACION" ? (
                        <div className="mt-2 min-w-[16rem]">
                          <MarkReadyPanel workItemId={item.id} orderFallback={item.oaRef ?? null} />
                        </div>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <BulkDeleteDialog
        open={bulk.open}
        onOpenChange={bulk.close}
        items={bulkItems}
        verdicts={bulk.verdicts}
        previewError={bulk.previewError}
        busy={bulk.busy}
        entityPlural="trabajos"
        onConfirm={(reason) => void bulk.confirm(reason)}
      />

      {active?.kind === "REGISTRAR_ENTREGA" && activeItem ? (
        <DeliverWorkDialog
          open
          onOpenChange={(o) => !o && close()}
          item={activeItem}
          title="Registrar entrega"
          target={totalUnits(activeItem)}
          unit={activeItem.unit}
          progress={progress}
          onConfirm={deliver}
        />
      ) : null}

      {active?.kind === "ENVIAR_A_CODIFICADO" && activeItem ? (
        <SendToCodificadoDialog
          open
          onOpenChange={(o) => !o && close()}
          item={activeItem}
          defaultTotal={String(totalUnits(activeItem) ?? "")}
          defaultObservation=""
          onConfirm={sendCodificado}
        />
      ) : null}

      {active?.kind === "ENVIAR_A_ENVASADO" && activeItem ? (
        <SendToEnvasadoDialog
          open
          onOpenChange={(o) => !o && close()}
          item={activeItem}
          defaultProduced={activeItem.finishedQty ?? activeItem.quantity ?? ""}
          defaultObservation=""
          onConfirm={sendEnvasado}
        />
      ) : null}

      <Dialog open={active?.kind === "REHACER"} onOpenChange={(o) => !o && close()}>
        <DialogContent data-testid="rework-dialog">
          <DialogHeader>
            <DialogTitle>Rehacer</DialogTitle>
            <DialogDescription>
              El trabajo vuelve a {activeItem ? SECTOR_LABELS[activeItem.sector] : "su sector"} para corregirlo y volver a
              enviarlo. Se conservan OA, lote, vencimiento, cajas e historial.
            </DialogDescription>
          </DialogHeader>
          <label className="block text-sm">
            <span className="font-medium">Motivo (opcional)</span>
            <textarea
              value={reworkReason}
              onChange={(e) => setReworkReason(e.target.value)}
              rows={3}
              className="mt-1 w-full rounded border border-[var(--os-border)] px-3 py-2"
            />
          </label>
          <DialogFooter>
            <Button variant="secondary" onClick={close} disabled={reworkBusy}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={() => void rework()} disabled={reworkBusy} data-testid="confirm-rework">
              {reworkBusy ? "Procesando…" : "Rehacer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TwinShell>
  );
}
