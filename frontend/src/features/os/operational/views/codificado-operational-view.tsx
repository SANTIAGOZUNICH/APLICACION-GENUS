"use client";

import { ExcelOrList, excelCol } from "../components/operational-ui";
import { useCallback, useMemo, useState } from "react";
import type { WorkItem } from "@/types/operational/work-item";
import { TwinShell } from "@/features/os/shell/twin-shell";
import { useRequiredWorkspace } from "@/features/os/workspace/workspace-provider";
import { usePreviewContext, usePreviewSession } from "@/features/os/session/preview-context";
import { displayField } from "@/lib/operational/display-fields";
import { Button } from "@/components/ui/button";
import { OperationalTabs, StatusChip } from "../components/operational-ui";
import {
  PackagingQuantitiesBlock,
  packagingDraftFromItem,
  type PackagingDraft,
} from "../components/packaging-quantities-block";
import { useOperationalPlan } from "../hooks/use-operational-plan";
import { mergeManualWorkItems } from "../adapters/manual-work-items-repository";
import { useOperationalStore } from "../store/operational-store-context";
import { canDeliverFromCodificado, canReopenCodificadoDelivery } from "../lib/codificado-flow";
import { canEditInCodificado, codificadoOriginLabel, WORK_TRANSFER } from "../lib/work-transfer-labels";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { postCodificadoHandoff } from "../adapters/codificado-handoff-client";
import { fetchDeliveryProgress, type DeliveryProgress } from "../adapters/circuit-client";
import { DeliverWorkDialog, type DeliverWorkPayload } from "../components/deliver-work-dialog";
import { MarkReadyPanel } from "../components/mark-ready-panel";
import { resolveDeliveryTarget } from "@/lib/planning/circuit/delivery-math";
import { summarizePackingGroups } from "@/lib/remitos/packing-math";
import { AssignWorkDialog } from "../components/assign-work-dialog";
import { WorkItemWarningBadge } from "../components/work-item-warning-badge";
import { WorkItemPlanEditor } from "../components/work-item-plan-editor";
import { WorkItemEditDeleteActions } from "../components/work-item-edit-delete-actions";

type TabId = "pendientes" | "entregados";

/**
 * Mi trabajo — Codificado: recibe desde Envasado Masivo/Premium (o asignación directa de Producción), informa
 * cantidad/lote/VTO y ENTREGA: registra la entrega final al cliente (total o parcial) sin aprobación previa.
 * Las cajas NO son obligatorias: Codificado recibe la cantidad total.
 */
export function CodificadoOperationalView() {
  const workspace = useRequiredWorkspace();
  const { applyEffectiveStatus, showToast } = usePreviewContext();
  const { email, sectorId: actorSectorId } = usePreviewSession();
  const {
    applyProgressToWorkItems,
    progressMap,
    deliverFromCodificado,
    saveWorkPackaging,
    getFinishedQty,
  } = useOperationalStore();
  const canAssignWork = actorSectorId === "PRODUCCION" || actorSectorId === "DIRECCION";
  const [showAssignDialog, setShowAssignDialog] = useState(false);

  // Sesión REAL del actor: Producción también opera esta vista y su sector no es CODIFICADO.
  const session = useMemo(
    () => ({ email: workspace.context.email, sector: actorSectorId }),
    [workspace.context.email, actorSectorId]
  );
  const { data, loading, refresh: refreshMasivo } = useOperationalPlan("ENVASADO_MASIVO", {});
  const { data: dataPremium, refresh: refreshPremium } = useOperationalPlan("ENVASADO_PREMIUM", {});
  const { data: dataCodificado, refresh: refreshCodificado } = useOperationalPlan("CODIFICADO", {});

  const refresh = useCallback(() => {
    refreshMasivo();
    refreshPremium();
    refreshCodificado();
  }, [refreshMasivo, refreshPremium, refreshCodificado]);

  const [tab, setTab] = useState<TabId>("pendientes");
  const [selected, setSelected] = useState<WorkItem | null>(null);
  const [draft, setDraft] = useState<PackagingDraft | null>(null);
  const [obs, setObs] = useState("");
  const [confirmDeliver, setConfirmDeliver] = useState(false);
  const [deliveryProgress, setDeliveryProgress] = useState<DeliveryProgress | null>(null);
  const [missingWarn, setMissingWarn] = useState(false);
  const [packagingError, setPackagingError] = useState<string | null>(null);
  const [confirmReopen, setConfirmReopen] = useState(false);
  const [reopenBusy, setReopenBusy] = useState(false);

  const actorName = workspace.context.displayName || email || "Codificado";

  const allItems = useMemo(() => {
    const masivo = mergeManualWorkItems("ENVASADO_MASIVO", data?.workItems ?? []);
    const premium = mergeManualWorkItems("ENVASADO_PREMIUM", dataPremium?.workItems ?? []);
    const assigned = mergeManualWorkItems("CODIFICADO", dataCodificado?.workItems ?? []);
    const merged = applyProgressToWorkItems(
      applyEffectiveStatus([...masivo, ...premium, ...assigned])
    );
    const byId = new Map<string, WorkItem>();
    for (const item of merged) byId.set(item.id, item);
    return [...byId.values()];
  }, [
    data?.workItems,
    dataPremium?.workItems,
    dataCodificado?.workItems,
    applyEffectiveStatus,
    applyProgressToWorkItems,
  ]);

  // deliveredFromCodificadoAt viene siempre fresco del server para items
  // nativos (native-projector.ts) — nunca se completa con progressMap acá.
  // Un fallback `?? progressMap[...]` reintroducía la misma clase de bug que
  // applyWorkProgressToItems: un cache local desactualizado (ej. de antes de
  // "Rehacer entrega") ganándole al `null` fresco y correcto del server.
  const pendientes = useMemo(
    () =>
      allItems.filter((i) =>
        canEditInCodificado({
          status: i.status,
          sector: i.sector,
          viaCodificado: i.viaCodificado,
          deliveredFromCodificadoAt: i.deliveredFromCodificadoAt,
        })
      ),
    [allItems]
  );
  const entregados = useMemo(
    () => allItems.filter((i) => Boolean(i.deliveredFromCodificadoAt)),
    [allItems]
  );

  const list = tab === "pendientes" ? pendientes : entregados;

  const selectedEditable = useMemo(() => {
    if (!selected) return false;
    return canEditInCodificado({
      status: selected.status,
      sector: selected.sector,
      viaCodificado: selected.viaCodificado,
      deliveredFromCodificadoAt: selected.deliveredFromCodificadoAt,
    });
  }, [selected]);

  const selectedDeliveredAt = selected?.deliveredFromCodificadoAt ?? null;
  // Misma decisión que el servidor (reopenCodificadoDeliveryDurable) — acá
  // no sabemos si ya hay una entrega real a cliente (hasActiveClientDelivery
  // no viaja en WorkItem), así que esto es una habilitación optimista: el
  // servidor es la autoridad final y devuelve el motivo exacto si rechaza.
  const canReopen =
    Boolean(selected) &&
    canReopenCodificadoDelivery({
      sector: selected?.sector,
      deliveredFromCodificadoAt: selectedDeliveredAt,
    }).ok;

  const enrichSelected = useCallback(
    (item: WorkItem): WorkItem => {
      const p = progressMap[item.id];
      if (!p) return item;
      return {
        ...item,
        packagingLote: p.packagingLote ?? item.packagingLote,
        packagingVto: p.packagingVto ?? item.packagingVto,
        packagingTotalUnits: p.packagingTotalUnits ?? item.packagingTotalUnits,
        packagingCajas: p.packagingCajas ?? item.packagingCajas,
        packagingUnidadesPorCaja:
          p.packagingUnidadesPorCaja ?? item.packagingUnidadesPorCaja,
        packingGroups: p.packingGroups ?? item.packingGroups,
        packingMismatchObservation:
          p.packingMismatchObservation ?? item.packingMismatchObservation,
        sampleUnits: p.sampleUnits ?? item.sampleUnits,
      };
    },
    [progressMap]
  );

  const openItem = useCallback(
    (item: WorkItem) => {
      const enriched = enrichSelected(item);
      const p = progressMap[item.id];
      setSelected(enriched);
      setDraft(packagingDraftFromItem(enriched));
      setObs(p?.codificadoObservation ?? "");
      setMissingWarn(false);
      setPackagingError(null);
    },
    [progressMap, enrichSelected]
  );

  const persistPackaging = useCallback(
    (extraObs?: string) => {
      if (!selected || !draft) return false;
      // Codificado recibe la cantidad total: las cajas son opcionales y NO se valida la distribución.
      setPackagingError(null);
      // No bloqueamos la UI en el resultado del servidor acá (persistPackaging
      // es síncrono por diseño para la validación de mismatch), pero un fallo
      // ya no queda mudo: se avisa apenas se resuelve el POST.
      void saveWorkPackaging(selected.id, {
        updatedBy: actorName,
        sector: "CODIFICADO",
        packagingLote: draft.packagingLote,
        packagingVto: draft.packagingVto,
        packagingTotalUnits: draft.packagingTotalUnits,
        packagingCajas: draft.packagingCajas,
        packagingUnidadesPorCaja: draft.packagingUnidadesPorCaja,
        packingGroups: draft.packingGroups,
        packingMismatchObservation: draft.packingMismatchObservation,
        codificadoObservation: extraObs ?? obs,
        sampleUnits: draft.sampleUnits,
      }).catch((err) => {
        showToast(
          err instanceof Error
            ? `No se guardó en el servidor: ${err.message} — reintentá.`
            : "No se guardó en el servidor. Reintentá.",
          "info"
        );
      });
      setSelected({
        ...selected,
        packagingLote: draft.packagingLote.trim() || null,
        packagingVto: draft.packagingVto.trim() || null,
        packagingTotalUnits: draft.packagingTotalUnits,
        packagingCajas: draft.packagingCajas,
        packagingUnidadesPorCaja: draft.packagingUnidadesPorCaja,
        packingGroups: draft.packingGroups,
        packingMismatchObservation: draft.packingMismatchObservation.trim() || null,
        loteRef: draft.packagingLote.trim() || selected.loteRef,
        sampleUnits: draft.sampleUnits,
      });
      return true;
    },
    [selected, draft, saveWorkPackaging, actorName, obs, showToast]
  );

  const handleSave = useCallback(() => {
    if (!persistPackaging()) return;
    showToast("Avance de Codificado guardado.");
  }, [persistPackaging, showToast]);

  const tryDeliver = useCallback(() => {
    if (!selected || !draft) return;
    const gate = canDeliverFromCodificado(selected.status, { sector: selected.sector });
    if (!gate.ok) {
      showToast(gate.error, "info");
      return;
    }
    setMissingWarn(!draft.packagingLote.trim() || !draft.packagingVto.trim());
    void fetchDeliveryProgress(session, selected.id)
      .then(setDeliveryProgress)
      .catch(() => setDeliveryProgress(null))
      .finally(() => setConfirmDeliver(true));
  }, [selected, draft, session, showToast]);

  // Cantidad objetivo: lo embalado si hay distribución real; si no, el total declarado / realizado / planificado.
  const deliverTarget = useMemo(() => {
    if (!selected || !draft) return null;
    const packed = summarizePackingGroups(draft.packingGroups).totalEmbalado;
    return resolveDeliveryTarget({
      unit: selected.unit,
      deliverableUnits: packed > 0 && draft.packagingTotalUnits === packed ? packed : null,
      packagingTotalUnits: draft.packagingTotalUnits ?? selected.packagingTotalUnits ?? null,
      finishedQty: getFinishedQty(selected.id) || selected.finishedQty || null,
      plannedQuantity: selected.quantity,
    });
  }, [selected, draft, getFinishedQty]);

  /** ENTREGAR: registra la entrega final (total o parcial). Los errores se relanzan al diálogo. */
  const confirmDeliverAction = useCallback(
    async (payload: DeliverWorkPayload) => {
      if (!selected || !draft) return;
      const server = await postCodificadoHandoff(session, selected.id, {
        action: "deliver",
        observation: payload.observations || obs,
        packagingLote: draft.packagingLote.trim() || null,
        packagingVto: draft.packagingVto.trim() || null,
        packagingTotalUnits: draft.packagingTotalUnits,
        packingGroups: draft.packingGroups,
        sampleUnits: draft.sampleUnits,
        expectedVersion: null,
        idempotencyKey: payload.idempotencyKey,
        deliverQuantity: payload.deliverQuantity,
        deliveryPackingGroups: payload.deliveryPackingGroups ?? null,
        remito: payload.remito || null,
        receivedBy: payload.receivedBy || null,
        actualDeliveredAt: payload.actualDeliveredAt,
        plannedDeliveryDate: selected.deliveryDate ?? null,
      });
      if (server.replayed) {
        showToast(WORK_TRANSFER.alreadyDeliveredFromCodificado, "info");
        await refresh();
        return;
      }
      if (server.delivery?.complete !== false) {
        deliverFromCodificado(server.workItem, {
          updatedBy: actorName,
          observation: obs,
          packagingLote: draft.packagingLote.trim() || null,
          packagingVto: draft.packagingVto.trim() || null,
          packagingTotalUnits: draft.packagingTotalUnits,
          packagingCajas: draft.packagingCajas,
          packagingUnidadesPorCaja: draft.packagingUnidadesPorCaja,
          packingGroups: draft.packingGroups,
          packingMismatchObservation: draft.packingMismatchObservation,
        });
        showToast("Entrega registrada.");
        setSelected(null);
        setDraft(null);
      } else {
        showToast(`Entrega parcial registrada. Saldo pendiente: ${server.delivery?.pending ?? "—"}.`);
        setSelected(server.workItem);
      }
      await refresh();
    },
    [selected, draft, session, obs, deliverFromCodificado, actorName, showToast, refresh]
  );

  const confirmReopenAction = useCallback(async () => {
    if (!selected) return;
    setReopenBusy(true);
    try {
      await postCodificadoHandoff(session, selected.id, {
        action: "reopen_delivery",
        expectedVersion: selected.nativeVersion ?? null,
        idempotencyKey:
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `reopen-${selected.id}-${Date.now()}`,
      });
      showToast("Entrega rehecha — el trabajo volvió a estar editable en Codificado.");
      setConfirmReopen(false);
      setSelected(null);
      setDraft(null);
      await refresh();
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "No se pudo rehacer la entrega.",
        "info"
      );
    } finally {
      setReopenBusy(false);
    }
  }, [selected, session, showToast, refresh]);

  return (
    <TwinShell title="Codificado">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-2xl font-semibold tracking-tight">Mi trabajo</h2>
          <p className="text-sm text-[var(--os-text-muted)]">
            Asignación directa de Producción o enviados desde Envasado · {workspace.context.displayName}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canAssignWork ? (
            <Button
              type="button"
              variant="primary"
              onClick={() => setShowAssignDialog(true)}
              data-testid="open-assign-work-dialog"
            >
              + Asignar trabajo
            </Button>
          ) : null}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={refresh}
            disabled={loading}
            data-testid="codificado-refresh"
          >
            Actualizar
          </Button>
        </div>
      </header>

      {showAssignDialog ? (
        <AssignWorkDialog
          sector="CODIFICADO"
          onClose={() => setShowAssignDialog(false)}
          onAssigned={() => refresh()}
        />
      ) : null}

      <OperationalTabs
        tabs={[
          { id: "pendientes", label: "Pendientes", count: pendientes.length },
          // Circuito sin Calidad: «Entregar» en Codificado registra la entrega final al cliente.
          { id: "entregados", label: WORK_TRANSFER.deliveredToQuality, count: entregados.length },
        ]}
        activeId={tab}
        onChange={(id) => setTab(id as TabId)}
      />

      {loading ? (
        <p className="mt-4 text-sm text-[var(--os-text-muted)]">Cargando…</p>
      ) : list.length === 0 ? (
        <p className="mt-4 text-sm text-[var(--os-text-muted)]">
          {tab === "pendientes"
            ? "No hay trabajos pendientes en Codificado."
            : "Todavía no hay entregas desde Codificado."}
        </p>
      ) : (
        <ExcelOrList
          tableId="codificado"
          rows={list}
          rowKey={(i) => i.id}
          columns={[
            excelCol("producto", "Producto", (i: (typeof list)[number]) => displayField(i.product)),
            excelCol("cliente", "Cliente", (i: (typeof list)[number]) => displayField(i.client)),
            excelCol("cantidad", "Cant.", (i: (typeof list)[number]) => String(progressMap[i.id]?.packagingTotalUnits ?? i.packagingTotalUnits ?? (Number.parseFloat(getFinishedQty(i.id) || i.quantity || "") || "—"))),
            excelCol("origen", "Origen", (i: (typeof list)[number]) => codificadoOriginLabel(i)),
            excelCol("estado", "Estado", (i: (typeof list)[number]) => i.status.replace(/_/g, " ")),
            {
              key: "acciones",
              header: "Acciones",
              action: true,
              text: () => "",
              render: (i: (typeof list)[number]) => (
                <Button size="sm" variant="secondary" onClick={() => openItem(i)} data-testid="codificado-open">
                  {actorSectorId === "PRODUCCION" ? "Abrir / Editar" : "Abrir"}
                </Button>
              ),
            },
          ]}
        >
        <div className="mt-4 overflow-x-hidden">
          <table className="os-table w-full max-w-full table-fixed text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-[var(--os-text-muted)]">
                <th className="w-[22%] py-2">Producto</th>
                <th className="hidden w-[18%] py-2 md:table-cell">Cliente</th>
                <th className="w-[12%] py-2">Cant.</th>
                <th className="hidden w-[14%] py-2 lg:table-cell">Origen</th>
                <th className="w-[14%] py-2">Estado</th>
                <th className="w-[20%] py-2">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {list.map((item) => {
                const p = progressMap[item.id];
                const total =
                  p?.packagingTotalUnits ??
                  item.packagingTotalUnits ??
                  (Number.parseFloat(getFinishedQty(item.id) || item.quantity || "") || "—");
                return (
                  <tr key={item.id} className="border-t border-[var(--os-border)]">
                    <td className="py-2 pr-2">
                      <span className="line-clamp-2 font-medium">{displayField(item.product)}</span>
                      <span className="mt-0.5 block text-xs text-[var(--os-text-muted)] md:hidden">
                        {displayField(item.client)}
                      </span>
                      <div className="mt-1">
                        <WorkItemWarningBadge item={item} onSelectField={() => openItem(item)} />
                      </div>
                    </td>
                    <td className="hidden py-2 pr-2 md:table-cell">
                      <span className="line-clamp-2">{displayField(item.client)}</span>
                    </td>
                    <td className="py-2 tabular-nums">{total}</td>
                    <td className="hidden py-2 text-xs lg:table-cell">
                      {codificadoOriginLabel(item)}
                    </td>
                    <td className="py-2">
                      <StatusChip status={item.status} />
                    </td>
                    <td className="py-2">
                      <Button size="sm" variant="secondary" onClick={() => openItem(item)}>
                        {actorSectorId === "PRODUCCION" ? "Abrir / Editar" : "Abrir"}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </ExcelOrList>
      )}

      <Dialog
        open={Boolean(selected)}
        onOpenChange={(o) => {
          if (!o) {
            setSelected(null);
            setDraft(null);
          }
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto overflow-x-hidden">
          {selected ? (
            <>
              <DialogHeader>
                <DialogTitle>{displayField(selected.product)}</DialogTitle>
              </DialogHeader>
              <WorkItemWarningBadge item={selected} />
              <WorkItemPlanEditor item={selected} variant="envasado" onChanged={refresh} />
              <WorkItemEditDeleteActions
                item={selected}
                actorSectorId={actorSectorId}
                actorName={actorName}
                onChanged={() => {
                  setSelected(null);
                  setDraft(null);
                }}
              />
              <div className="space-y-3 text-sm">
                <p>
                  <span className="text-[var(--os-text-muted)]">Cliente · </span>
                  {displayField(selected.client)}
                </p>
                <p>
                  <span className="text-[var(--os-text-muted)]">Origen · </span>
                  {codificadoOriginLabel(selected)}
                </p>
                {progressMap[selected.id]?.sentToCodificadoBy ? (
                  <p>
                    <span className="text-[var(--os-text-muted)]">Enviado por · </span>
                    {progressMap[selected.id]?.sentToCodificadoBy}
                  </p>
                ) : null}
                {progressMap[selected.id]?.bulkRemainderKg != null &&
                (progressMap[selected.id]?.bulkRemainderKg ?? 0) > 0 ? (
                  <p>
                    <span className="text-[var(--os-text-muted)]">Sobrante granel · </span>
                    {progressMap[selected.id]?.bulkRemainderKg} kg
                  </p>
                ) : null}
                {selectedDeliveredAt ? (
                  <div className="rounded-[var(--os-radius-sm)] border border-[var(--os-border)] bg-[var(--os-bg)] px-3 py-2 text-xs">
                    <p className="font-medium text-[var(--os-text)]">
                      Entregado · {new Date(selectedDeliveredAt).toLocaleString("es-AR")}
                    </p>
                    {selected.deliveredFromCodificadoBy ? (
                      <p className="text-[var(--os-text-muted)]">
                        Por {selected.deliveredFromCodificadoBy}
                      </p>
                    ) : null}
                    <p className="mt-1 text-[var(--os-text-muted)]">
                      Los datos de abajo son los que se entregaron — de solo lectura.
                    </p>
                  </div>
                ) : null}

                <PackagingQuantitiesBlock
                  key={selected.id}
                  item={selected}
                  actorName={actorName}
                  sector="CODIFICADO"
                  readOnly={!selectedEditable}
                  hideSaveButton
                  onDraftChange={setDraft}
                />

                <label className="block">
                  <span className="font-medium">Observación de Codificado</span>
                  <textarea
                    className="mt-1 w-full rounded border px-3 py-2"
                    rows={2}
                    value={obs}
                    disabled={!selectedEditable}
                    onChange={(e) => setObs(e.target.value)}
                    data-testid="codificado-obs"
                  />
                </label>
                {packagingError ? (
                  <p role="alert" className="text-xs text-[var(--genus-error)]">
                    {packagingError}
                  </p>
                ) : null}
                {/* Último sector del recorrido: confirmación explícita de disponibilidad (Codificado). */}
                <MarkReadyPanel workItemId={selected.id} orderFallback={selected.oaRef ?? null} />
              </div>
              {selectedEditable ? (
                <DialogFooter className="flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={handleSave} data-testid="codificado-save">
                    Guardar avance
                  </Button>
                  <Button
                    variant="primary"
                    onClick={tryDeliver}
                    data-testid="codificado-deliver"
                  >
                    {WORK_TRANSFER.deliverFromCodificadoAction}
                  </Button>
                </DialogFooter>
              ) : canReopen ? (
                <DialogFooter>
                  <Button
                    variant="primary"
                    onClick={() => setConfirmReopen(true)}
                    data-testid="codificado-reopen"
                  >
                    Rehacer entrega
                  </Button>
                </DialogFooter>
              ) : null}
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      {selected && draft ? (
        <DeliverWorkDialog
          open={confirmDeliver}
          onOpenChange={setConfirmDeliver}
          item={selected}
          title="Entregar"
          target={deliverTarget}
          unit={selected.unit}
          progress={deliveryProgress}
          notice={
            missingWarn ? (
              <p className="rounded bg-[var(--genus-warning-soft)] px-2 py-1 text-xs text-[var(--genus-warning)]">
                Falta Lote y/o VTO. Podés cargarlos antes de entregar, o continuar igual — queda registrado en auditoría.
              </p>
            ) : null
          }
          onConfirm={confirmDeliverAction}
        />
      ) : null}

      <Dialog open={confirmReopen} onOpenChange={setConfirmReopen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rehacer entrega</DialogTitle>
          </DialogHeader>
          <p className="text-sm">
            Este trabajo ya fue entregado.
            <br />
            <br />
            Si rehacés la entrega, volverá a estar editable en Codificado y deberá entregarse
            nuevamente.
          </p>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirmReopen(false)} disabled={reopenBusy}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={() => void confirmReopenAction()} disabled={reopenBusy}>
              {reopenBusy ? "Rehaciendo…" : "Rehacer entrega"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TwinShell>
  );
}
