"use client";

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
import { pushNotification } from "@/features/os/feedback/notifications-store";
import { canDeliverFromCodificado } from "../lib/codificado-flow";
import { isInCodificadoStatus, WORK_TRANSFER } from "../lib/work-transfer-labels";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { postCodificadoHandoff } from "../adapters/codificado-handoff-client";

type TabId = "pendientes" | "entregados";

/**
 * Mi trabajo — Codificado: recibe desde Envasado Masivo/Premium,
 * informa cantidad/cajas/lote/VTO y entrega una sola vez a Calidad + Producción.
 */
export function CodificadoOperationalView() {
  const workspace = useRequiredWorkspace();
  const { applyEffectiveStatus, showToast } = usePreviewContext();
  const { email } = usePreviewSession();
  const {
    applyProgressToWorkItems,
    progressMap,
    deliverFromCodificado,
    saveWorkPackaging,
    getFinishedQty,
  } = useOperationalStore();

  const session = useMemo(
    () => ({ email: workspace.context.email, sector: "CODIFICADO" as const }),
    [workspace.context.email]
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
  const [missingWarn, setMissingWarn] = useState(false);
  const [packagingError, setPackagingError] = useState<string | null>(null);

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

  const pendientes = useMemo(
    () =>
      allItems.filter((i) => {
        const p = progressMap[i.id];
        if (i.deliveredFromCodificadoAt || p?.deliveredFromCodificadoAt) return false;
        if (isInCodificadoStatus(i.status)) return true;
        return (
          i.sector === "CODIFICADO" &&
          i.status !== "cancelado" &&
          i.status !== "completo" &&
          i.status !== "codificado_completo" &&
          i.status !== "revision" &&
          i.status !== "entregado"
        );
      }),
    [allItems, progressMap]
  );
  const entregados = useMemo(
    () =>
      allItems.filter((i) => {
        const p = progressMap[i.id];
        return Boolean(
          i.deliveredFromCodificadoAt ||
            (p?.viaCodificado && p.deliveredFromCodificadoAt)
        );
      }),
    [allItems, progressMap]
  );

  const list = tab === "pendientes" ? pendientes : entregados;

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
      if (!draft.mismatchOk && !draft.packingMismatchObservation.trim()) {
        setPackagingError(
          "Indicá una observación si producido y embalado no coinciden."
        );
        return false;
      }
      setPackagingError(null);
      saveWorkPackaging(selected.id, {
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
      });
      return true;
    },
    [selected, draft, saveWorkPackaging, actorName, obs]
  );

  const handleSave = useCallback(() => {
    if (!persistPackaging()) return;
    showToast("Avance de Codificado guardado.");
  }, [persistPackaging, showToast]);

  const tryDeliver = useCallback(() => {
    if (!selected || !draft) return;
    if (!draft.packagingLote.trim() || !draft.packagingVto.trim()) {
      setMissingWarn(true);
      setConfirmDeliver(true);
      return;
    }
    setMissingWarn(false);
    setConfirmDeliver(true);
  }, [selected, draft]);

  const confirmDeliverAction = useCallback(async () => {
    if (!selected || !draft) return;
    const gate = canDeliverFromCodificado(selected.status, { sector: selected.sector });
    if (!gate.ok) {
      showToast(gate.error, "info");
      setConfirmDeliver(false);
      return;
    }
    if (!draft.mismatchOk && !draft.packingMismatchObservation.trim()) {
      setPackagingError(
        "Indicá una observación si producido y embalado no coinciden."
      );
      setConfirmDeliver(false);
      return;
    }
    try {
      const server = await postCodificadoHandoff(session, selected.id, {
        action: "deliver",
        observation: obs,
        packagingLote: draft.packagingLote.trim() || null,
        packagingVto: draft.packagingVto.trim() || null,
        packagingTotalUnits: draft.packagingTotalUnits,
        packingGroups: draft.packingGroups,
        expectedVersion: selected.nativeVersion ?? null,
        idempotencyKey:
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `deliver-${selected.id}-${Date.now()}`,
      });
      const result = deliverFromCodificado(server.workItem, {
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
      if (server.replayed || result.already) {
        showToast(WORK_TRANSFER.alreadyDeliveredFromCodificado, "info");
        setConfirmDeliver(false);
        await refresh();
        return;
      }
      pushNotification({
        kind: "trabajo_finalizado",
        title: "Codificado entregó a Calidad",
        message: `${selected.product ?? "Producto"} · ${selected.client ?? ""} — lote ${draft.packagingLote || "s/d"}`,
        sectors: ["CALIDAD", "PRODUCCION"],
      });
      pushNotification({
        kind: "trabajo_asignado",
        title: "Trabajo listo desde Codificado",
        message: `${selected.product ?? "Producto"} disponible para remito manual en Producción.`,
        sectors: ["PRODUCCION"],
      });
      showToast("Entregado a Calidad y Producción.");
      setConfirmDeliver(false);
      setSelected(null);
      setDraft(null);
      await refresh();
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "No se pudo entregar a Calidad.",
        "info"
      );
      setConfirmDeliver(false);
    }
  }, [
    selected,
    draft,
    deliverFromCodificado,
    actorName,
    obs,
    showToast,
    session,
    refresh,
  ]);

  return (
    <TwinShell title="Codificado">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-2xl font-semibold tracking-tight">Mi trabajo</h2>
          <p className="text-sm text-[var(--os-text-muted)]">
            Trabajos enviados desde Envasado Masivo y Premium · {workspace.context.displayName}
          </p>
        </div>
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
      </header>

      <OperationalTabs
        tabs={[
          { id: "pendientes", label: "Pendientes", count: pendientes.length },
          { id: "entregados", label: "Entregados", count: entregados.length },
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
                    </td>
                    <td className="hidden py-2 pr-2 md:table-cell">
                      <span className="line-clamp-2">{displayField(item.client)}</span>
                    </td>
                    <td className="py-2 tabular-nums">{total}</td>
                    <td className="hidden py-2 text-xs lg:table-cell">
                      {item.codificadoOriginLabel ||
                        (item.codificadoOriginSector === "ENVASADO_PREMIUM"
                          ? "Envasado Premium"
                          : item.codificadoOriginSector === "ENVASADO_MASIVO"
                            ? "Envasado Masivo"
                            : item.viaCodificado
                              ? "Envasado"
                              : "Producción")}
                    </td>
                    <td className="py-2">
                      <StatusChip status={item.status} />
                    </td>
                    <td className="py-2">
                      <Button size="sm" variant="secondary" onClick={() => openItem(item)}>
                        Abrir
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
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
              <div className="space-y-3 text-sm">
                <p>
                  <span className="text-[var(--os-text-muted)]">Cliente · </span>
                  {displayField(selected.client)}
                </p>
                <p>
                  <span className="text-[var(--os-text-muted)]">Origen · </span>
                  {progressMap[selected.id]?.codificadoOriginSector ?? selected.sector}
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

                <PackagingQuantitiesBlock
                  key={selected.id}
                  item={selected}
                  actorName={actorName}
                  sector="CODIFICADO"
                  readOnly={!isInCodificadoStatus(selected.status)}
                  hideSaveButton
                  onDraftChange={setDraft}
                />

                <label className="block">
                  <span className="font-medium">Observación de Codificado</span>
                  <textarea
                    className="mt-1 w-full rounded border px-3 py-2"
                    rows={2}
                    value={obs}
                    disabled={!isInCodificadoStatus(selected.status)}
                    onChange={(e) => setObs(e.target.value)}
                    data-testid="codificado-obs"
                  />
                </label>
                {packagingError ? (
                  <p role="alert" className="text-xs text-[var(--genus-error)]">
                    {packagingError}
                  </p>
                ) : null}
              </div>
              {isInCodificadoStatus(selected.status) ? (
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
              ) : null}
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={confirmDeliver} onOpenChange={setConfirmDeliver}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Entregar a Calidad y Producción</DialogTitle>
          </DialogHeader>
          <p className="text-sm">
            {missingWarn
              ? "Falta Lote y/o VTO. Podés continuar igual; se registrará en auditoría."
              : "Se enviará una única finalización a Calidad y se notificará a Producción. No se genera remito."}
          </p>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirmDeliver(false)}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={confirmDeliverAction}>
              Confirmar entrega
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TwinShell>
  );
}
