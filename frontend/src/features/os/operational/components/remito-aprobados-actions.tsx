"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { usePreviewContext, usePreviewSession } from "@/features/os/session/preview-context";
import type { QualityItem } from "@/features/os/operational/types";
import type { WorkItem } from "@/types/operational/work-item";
import {
  collectSameClientDateApprovedPackaging,
  hasBlockingRemitoGaps,
  isPackagingQualityItem,
  remitoGapsFromQuality,
  resolveRemitoInputFromQuality,
} from "@/lib/remitos/from-quality";
import {
  generateRemitoApi,
  remitoStatusForWorkApi,
  upsertRemitoDraftApi,
} from "@/lib/remitos/remitos-client";
import { canAccessRemitos } from "@/lib/remitos/types";
import type { RemitoWorkItemStatus } from "@/lib/remitos/types";

function workIdFromQuality(item: QualityItem): string {
  return (
    item.relatedWorkItemId?.trim() ||
    (item.id.startsWith("qc:") ? item.id.slice(3) : item.id)
  );
}

export type RemitoCompleteFields = {
  client: string;
  deliveryDate: string;
  lote: string;
  vto: string;
  cajas: string;
  unidades: string;
  totalUnits: string;
};

/**
 * Acciones de remito para filas Aprobados (PRODUCCION).
 * Visible siempre para packaging aprobado: GENERAR / ABRIR / VER / FALTAN DATOS.
 */
export function useRemitoAprobadosActions(opts: {
  aprobados: QualityItem[];
  workItems: WorkItem[];
  enabled: boolean;
}) {
  const { navigateTo } = usePreviewContext();
  const { email, sectorId } = usePreviewSession();
  const session = useMemo(
    () => ({ email: email ?? "", sector: sectorId }),
    [email, sectorId]
  );
  const canRemitos = canAccessRemitos(sectorId) && opts.enabled;

  const [remitoStatusByWork, setRemitoStatusByWork] = useState<
    Record<string, RemitoWorkItemStatus>
  >({});
  const [remitoBusy, setRemitoBusy] = useState(false);
  const [remitoError, setRemitoError] = useState<string | null>(null);
  const [generateModal, setGenerateModal] = useState<{
    remitoId: string;
    items: QualityItem[];
  } | null>(null);
  const [displayNameInput, setDisplayNameInput] = useState("");
  const [completeModal, setCompleteModal] = useState<{
    seed: QualityItem;
    fields: RemitoCompleteFields;
    gaps: string[];
  } | null>(null);

  const refreshRemitoStatuses = useCallback(async () => {
    if (!canRemitos) return;
    const packaging = opts.aprobados.filter(isPackagingQualityItem);
    if (packaging.length === 0) {
      setRemitoStatusByWork({});
      return;
    }
    const next: Record<string, RemitoWorkItemStatus> = {};
    await Promise.all(
      packaging.map(async (item) => {
        const wid = workIdFromQuality(item);
        try {
          next[wid] = await remitoStatusForWorkApi(session, wid);
        } catch {
          next[wid] = { status: "none", remitoId: null };
        }
      })
    );
    setRemitoStatusByWork(next);
  }, [canRemitos, opts.aprobados, session]);

  useEffect(() => {
    if (canRemitos) void refreshRemitoStatuses();
  }, [canRemitos, refreshRemitoStatuses]);

  const openCompleteModal = useCallback(
    (seed: QualityItem) => {
      const gaps = remitoGapsFromQuality(seed, opts.workItems);
      const wi =
        opts.workItems.find((w) => w.id === workIdFromQuality(seed)) ?? null;
      setCompleteModal({
        seed,
        gaps: gaps.labels,
        fields: {
          client: seed.client?.trim() || wi?.client?.trim() || "",
          deliveryDate:
            seed.deliveryDate?.trim() ||
            wi?.deliveryDate?.trim() ||
            wi?.plannedDate?.trim() ||
            "",
          lote:
            seed.lote?.trim() ||
            wi?.packagingLote?.trim() ||
            wi?.loteRef?.trim() ||
            "",
          vto: wi?.packagingVto?.trim() || "",
          cajas: wi?.packagingCajas != null ? String(wi.packagingCajas) : "",
          unidades:
            wi?.packagingUnidadesPorCaja != null
              ? String(wi.packagingUnidadesPorCaja)
              : "",
          totalUnits:
            wi?.packagingTotalUnits != null
              ? String(wi.packagingTotalUnits)
              : seed.quantity?.replace(/[^\d.,]/g, "") || "",
        },
      });
    },
    [opts.workItems]
  );

  const handleGenerarRemito = useCallback(
    async (seed: QualityItem, overrides?: Partial<RemitoCompleteFields>) => {
      if (!canRemitos) return;
      setRemitoBusy(true);
      setRemitoError(null);
      try {
        const gaps = remitoGapsFromQuality(seed, opts.workItems);
        const client = overrides?.client?.trim();
        const deliveryDate = overrides?.deliveryDate?.trim();
        if (
          hasBlockingRemitoGaps(gaps) &&
          !(client && deliveryDate)
        ) {
          openCompleteModal(seed);
          return;
        }
        const inputOverrides = {
          clientId: client || undefined,
          clientDisplay: client || undefined,
          deliveryDate: deliveryDate || undefined,
          lote: overrides?.lote?.trim() || undefined,
          vto: overrides?.vto?.trim() || undefined,
          cajas1: overrides?.cajas ? Number(overrides.cajas) : undefined,
          unidades1: overrides?.unidades ? Number(overrides.unidades) : undefined,
          unitsPerCaja1: overrides?.unidades
            ? Number(overrides.unidades)
            : undefined,
          totalUnits: overrides?.totalUnits
            ? Number(overrides.totalUnits)
            : undefined,
        };
        const seedInput = resolveRemitoInputFromQuality(
          seed,
          opts.workItems,
          inputOverrides
        );
        if (!seedInput) throw new Error("No se pudo resolver datos de remito.");

        // Agrupar con overrides de cliente/fecha aplicados al seed.
        const seeded: QualityItem = {
          ...seed,
          client: seedInput.clientDisplay || seed.client || "",
          deliveryDate: seedInput.deliveryDate,
        };
        const group = collectSameClientDateApprovedPackaging(
          seeded,
          opts.aprobados.map((item) =>
            item.id === seed.id
              ? seeded
              : item
          ),
          opts.workItems
        );
        let remitoId: string | null = null;
        for (const item of group) {
          const input = resolveRemitoInputFromQuality(
            item,
            opts.workItems,
            item.id === seed.id ? inputOverrides : undefined
          );
          if (!input) continue;
          const result = await upsertRemitoDraftApi(session, input);
          remitoId = result.remito.id;
        }
        if (!remitoId) throw new Error("No se pudo crear borrador de remito.");
        setDisplayNameInput(seedInput.clientDisplay || seed.client || "Remito");
        setGenerateModal({ remitoId, items: group.length ? group : [seeded] });
        setCompleteModal(null);
        await refreshRemitoStatuses();
      } catch (e) {
        setRemitoError(e instanceof Error ? e.message : "Error al preparar remito");
      } finally {
        setRemitoBusy(false);
      }
    },
    [
      canRemitos,
      openCompleteModal,
      opts.aprobados,
      opts.workItems,
      refreshRemitoStatuses,
      session,
    ]
  );

  const confirmGenerateRemito = useCallback(async () => {
    if (!generateModal) return;
    setRemitoBusy(true);
    setRemitoError(null);
    try {
      await generateRemitoApi(session, generateModal.remitoId, {
        displayName: displayNameInput,
      });
      setGenerateModal(null);
      await refreshRemitoStatuses();
      navigateTo({ view: "remitos" });
    } catch (e) {
      setRemitoError(e instanceof Error ? e.message : "No se pudo generar remito");
    } finally {
      setRemitoBusy(false);
    }
  }, [displayNameInput, generateModal, navigateTo, refreshRemitoStatuses, session]);

  const openRemito = useCallback(
    (status: RemitoWorkItemStatus) => {
      if (!status.remitoId) return;
      navigateTo({ view: "remitos" });
    },
    [navigateTo]
  );

  function renderRemitoAction(row: QualityItem) {
    if (!canRemitos) return null;
    if (!isPackagingQualityItem(row) || row.status !== "aprobado") {
      return <span className="text-xs text-[var(--os-text-muted)]">—</span>;
    }
    const wid = workIdFromQuality(row);
    const st = remitoStatusByWork[wid] ?? { status: "none" as const, remitoId: null };
    if (st.status === "draft" && st.remitoId) {
      return (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={remitoBusy}
          onClick={() => openRemito(st)}
          data-testid={`remito-open-draft-${wid}`}
        >
          ABRIR BORRADOR
        </Button>
      );
    }
    if (st.status === "generated" && st.remitoId) {
      return (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={remitoBusy}
          onClick={() => openRemito(st)}
          data-testid={`remito-ver-${wid}`}
        >
          VER REMITO
        </Button>
      );
    }
    const gaps = remitoGapsFromQuality(row, opts.workItems);
    if (hasBlockingRemitoGaps(gaps)) {
      return (
        <div className="flex max-w-[14rem] flex-col gap-1">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={remitoBusy}
            onClick={() => openCompleteModal(row)}
            data-testid={`remito-faltan-datos-${wid}`}
            title={`Faltan: ${gaps.labels.join(", ")}`}
          >
            GENERAR REMITO — FALTAN DATOS
          </Button>
          <span className="text-[10px] text-amber-800">
            Falta: {gaps.labels.slice(0, 3).join(", ")}
            {gaps.labels.length > 3 ? "…" : ""}
          </span>
        </div>
      );
    }
    return (
      <Button
        type="button"
        size="sm"
        disabled={remitoBusy}
        onClick={() => void handleGenerarRemito(row)}
        data-testid={`remito-generar-${wid}`}
      >
        GENERAR REMITO
      </Button>
    );
  }

  const modals = (
    <>
      {remitoError ? (
        <p className="mt-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm" role="alert">
          {remitoError}
        </p>
      ) : null}
      {completeModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div
            className="w-full max-w-md space-y-3 rounded bg-[var(--os-surface,#fff)] p-4 shadow"
            data-testid="remito-complete-modal"
          >
            <h3 className="font-semibold">Completar datos para remito</h3>
            <p className="text-sm text-[var(--os-text-muted)]">
              Producto: {completeModal.seed.product}. Falta:{" "}
              {completeModal.gaps.join(", ") || "revisar campos"}.
            </p>
            {(
              [
                ["client", "Cliente *"],
                ["deliveryDate", "Fecha de entrega *"],
                ["lote", "Lote"],
                ["vto", "VTO"],
                ["cajas", "Cajas"],
                ["unidades", "Unidades por caja"],
                ["totalUnits", "Total unidades"],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="block text-sm">
                {label}
                <input
                  className="mt-1 w-full rounded border px-2 py-1.5 text-sm"
                  value={completeModal.fields[key]}
                  onChange={(e) =>
                    setCompleteModal((m) =>
                      m
                        ? {
                            ...m,
                            fields: { ...m.fields, [key]: e.target.value },
                          }
                        : m
                    )
                  }
                />
              </label>
            ))}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setCompleteModal(null)}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                disabled={
                  remitoBusy ||
                  !completeModal.fields.client.trim() ||
                  !completeModal.fields.deliveryDate.trim()
                }
                onClick={() =>
                  void handleGenerarRemito(completeModal.seed, completeModal.fields)
                }
              >
                Continuar a generar
              </Button>
            </div>
          </div>
        </div>
      ) : null}
      {generateModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div
            className="w-full max-w-lg space-y-3 rounded bg-[var(--os-surface,#fff)] p-4 shadow"
            data-testid="remito-generate-modal"
          >
            <h3 className="font-semibold">Generar remito</h3>
            <p className="text-sm text-[var(--os-text-muted)]">
              Se agrupan {generateModal.items.length} producto(s) del mismo cliente y
              fecha. Se generará PDF y XLSX en almacenamiento privado.
            </p>
            <ul className="max-h-40 list-disc space-y-1 overflow-auto pl-5 text-sm">
              {generateModal.items.map((it) => (
                <li key={it.id}>
                  {it.product} · {it.client} · {it.deliveryDate || "—"}
                </li>
              ))}
            </ul>
            <label className="block text-sm">
              Nombre visible
              <input
                className="mt-1 w-full rounded border px-2 py-1.5 text-sm"
                value={displayNameInput}
                onChange={(e) => setDisplayNameInput(e.target.value)}
                data-testid="remito-display-name"
              />
            </label>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setGenerateModal(null)}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                disabled={remitoBusy || !displayNameInput.trim()}
                onClick={() => void confirmGenerateRemito()}
                data-testid="remito-confirm-generate"
              >
                Generar PDF/XLSX
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );

  return {
    canRemitos,
    remitoBusy,
    remitoError,
    renderRemitoAction,
    modals,
    refreshRemitoStatuses,
  };
}
