"use client";

import { useCallback, useMemo, useState } from "react";
import type { WorkItem } from "@/types/operational/work-item";
import { TwinShell } from "@/features/os/shell/twin-shell";
import { useRequiredWorkspace } from "@/features/os/workspace/workspace-provider";
import { usePreviewContext, usePreviewSession } from "@/features/os/session/preview-context";
import { displayField } from "@/lib/operational/display-fields";
import { Button } from "@/components/ui/button";
import { OperationalTabs, StatusChip } from "../components/operational-ui";
import { useOperationalPlan } from "../hooks/use-operational-plan";
import { mergeManualWorkItems } from "../adapters/manual-work-items-repository";
import { useOperationalStore } from "../store/operational-store-context";
import { pushNotification } from "@/features/os/feedback/notifications-store";
import { canDeliverFromCodificado } from "../lib/codificado-flow";
import { isInCodificadoStatus, WORK_TRANSFER } from "../lib/work-transfer-labels";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type TabId = "pendientes" | "entregados";

/**
 * Mi trabajo — Codificado: recibe desde Envasado Masivo/Premium,
 * completa Lote/VTO y entrega una sola vez a Calidad + Producción.
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

  const { data, loading, refresh: refreshMasivo } = useOperationalPlan("ENVASADO_MASIVO", {});
  const { data: dataPremium, refresh: refreshPremium } = useOperationalPlan("ENVASADO_PREMIUM", {});

  const refresh = useCallback(() => {
    refreshMasivo();
    refreshPremium();
  }, [refreshMasivo, refreshPremium]);

  const [tab, setTab] = useState<TabId>("pendientes");
  const [selected, setSelected] = useState<WorkItem | null>(null);
  const [lote, setLote] = useState("");
  const [vto, setVto] = useState("");
  const [obs, setObs] = useState("");
  const [confirmDeliver, setConfirmDeliver] = useState(false);
  const [missingWarn, setMissingWarn] = useState(false);

  const allItems = useMemo(() => {
    const masivo = mergeManualWorkItems("ENVASADO_MASIVO", data?.workItems ?? []);
    const premium = mergeManualWorkItems("ENVASADO_PREMIUM", dataPremium?.workItems ?? []);
    const merged = applyProgressToWorkItems(
      applyEffectiveStatus([...masivo, ...premium])
    );
    // Deduplicate by id
    const byId = new Map<string, WorkItem>();
    for (const item of merged) byId.set(item.id, item);
    return [...byId.values()];
  }, [data?.workItems, dataPremium?.workItems, applyEffectiveStatus, applyProgressToWorkItems]);

  const pendientes = useMemo(
    () => allItems.filter((i) => isInCodificadoStatus(i.status)),
    [allItems]
  );
  const entregados = useMemo(
    () =>
      allItems.filter((i) => {
        const p = progressMap[i.id];
        return Boolean(p?.viaCodificado && p.deliveredFromCodificadoAt);
      }),
    [allItems, progressMap]
  );

  const list = tab === "pendientes" ? pendientes : entregados;

  const openItem = useCallback(
    (item: WorkItem) => {
      const p = progressMap[item.id];
      setSelected(item);
      setLote(p?.packagingLote ?? item.packagingLote ?? item.loteRef ?? "");
      setVto(p?.packagingVto ?? item.packagingVto ?? "");
      setObs(p?.codificadoObservation ?? "");
      setMissingWarn(false);
    },
    [progressMap]
  );

  const handleSave = useCallback(() => {
    if (!selected) return;
    saveWorkPackaging(selected.id, {
      updatedBy: workspace.context.displayName || email || "Codificado",
      sector: "CODIFICADO",
      packagingLote: lote,
      packagingVto: vto,
      packagingTotalUnits:
        selected.packagingTotalUnits ??
        progressMap[selected.id]?.packagingTotalUnits ??
        null,
      packingGroups: selected.packingGroups ?? progressMap[selected.id]?.packingGroups ?? null,
    });
    // Persist codificado observation on progress via packaging + note in observation path
    showToast("Avance de Codificado guardado.");
  }, [
    selected,
    lote,
    vto,
    saveWorkPackaging,
    workspace.context.displayName,
    email,
    progressMap,
    showToast,
  ]);

  const tryDeliver = useCallback(() => {
    if (!selected) return;
    if (!lote.trim() || !vto.trim()) {
      setMissingWarn(true);
      setConfirmDeliver(true);
      return;
    }
    setMissingWarn(false);
    setConfirmDeliver(true);
  }, [selected, lote, vto]);

  const confirmDeliverAction = useCallback(() => {
    if (!selected) return;
    const gate = canDeliverFromCodificado(selected.status);
    if (!gate.ok) {
      showToast(gate.error, "info");
      setConfirmDeliver(false);
      return;
    }
    const result = deliverFromCodificado(selected, {
      updatedBy: workspace.context.displayName || email || "Codificado",
      observation: obs,
      packagingLote: lote.trim() || null,
      packagingVto: vto.trim() || null,
    });
    if (result.already) {
      showToast(WORK_TRANSFER.alreadyDeliveredFromCodificado, "info");
      setConfirmDeliver(false);
      return;
    }
    const origin = (result.progress.codificadoOriginSector || selected.sector) as
      | "ENVASADO_MASIVO"
      | "ENVASADO_PREMIUM";
    pushNotification({
      kind: "trabajo_finalizado",
      title: "Codificado entregó a Calidad",
      message: `${selected.product ?? "Producto"} · ${selected.client ?? ""} — lote ${lote || "s/d"}`,
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
    void origin;
  }, [
    selected,
    deliverFromCodificado,
    workspace.context.displayName,
    email,
    obs,
    lote,
    vto,
    showToast,
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
                      {p?.codificadoOriginSector === "ENVASADO_PREMIUM"
                        ? "Premium"
                        : "Masivo"}
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

      <Dialog open={Boolean(selected)} onOpenChange={(o) => !o && setSelected(null)}>
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
                  <span className="text-[var(--os-text-muted)]">Cantidad total · </span>
                  {progressMap[selected.id]?.packagingTotalUnits ??
                    selected.packagingTotalUnits ??
                    "—"}{" "}
                  un.
                </p>
                <p>
                  <span className="text-[var(--os-text-muted)]">Origen · </span>
                  {progressMap[selected.id]?.codificadoOriginSector ?? selected.sector}
                </p>
                <label className="block">
                  <span className="font-medium">Lote</span>
                  <input
                    className="mt-1 w-full rounded border px-3 py-2"
                    value={lote}
                    disabled={!isInCodificadoStatus(selected.status)}
                    onChange={(e) => setLote(e.target.value)}
                    data-testid="codificado-lote"
                  />
                </label>
                <label className="block">
                  <span className="font-medium">VTO</span>
                  <input
                    className="mt-1 w-full rounded border px-3 py-2"
                    value={vto}
                    disabled={!isInCodificadoStatus(selected.status)}
                    onChange={(e) => setVto(e.target.value)}
                    data-testid="codificado-vto"
                  />
                </label>
                <label className="block">
                  <span className="font-medium">Observación de Codificado</span>
                  <textarea
                    className="mt-1 w-full rounded border px-3 py-2"
                    rows={2}
                    value={obs}
                    disabled={!isInCodificadoStatus(selected.status)}
                    onChange={(e) => setObs(e.target.value)}
                  />
                </label>
              </div>
              {isInCodificadoStatus(selected.status) ? (
                <DialogFooter className="flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={handleSave}>
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
