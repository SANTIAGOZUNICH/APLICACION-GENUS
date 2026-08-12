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
} from "@/lib/remitos/from-quality";
import {
  buildComposeLinesFromQuality,
  composeLineToApprovalInput,
  producedVsBoxedWarning,
  type RemitoComposeLine,
} from "@/lib/remitos/compose-from-quality";
import {
  generateRemitoApi,
  remitoStatusForWorkApi,
  upsertRemitoDraftApi,
} from "@/lib/remitos/remitos-client";
import { resolveWorkItemDeliverableUnits } from "@/lib/remitos/packing-math";
import { canAccessRemitos } from "@/lib/remitos/types";
import type { RemitoWorkItemStatus } from "@/lib/remitos/types";
import { RemitoComposeEditor } from "./remito-compose-editor";

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
 * GENERAR abre editor en memoria; no persiste hasta Guardar/Generar Excel.
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
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeLines, setComposeLines] = useState<RemitoComposeLine[]>([]);
  const [composeClient, setComposeClient] = useState("");
  const [composeDate, setComposeDate] = useState("");
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
            resolveWorkItemDeliverableUnits(wi) != null
              ? String(resolveWorkItemDeliverableUnits(wi))
              : seed.quantity?.replace(/[^\d.,]/g, "") || "",
        },
      });
    },
    [opts.workItems]
  );

  const openCompose = useCallback(
    (seed: QualityItem, overrides?: Partial<RemitoCompleteFields>) => {
      const seeded: QualityItem = {
        ...seed,
        client: overrides?.client?.trim() || seed.client,
        deliveryDate: overrides?.deliveryDate?.trim() || seed.deliveryDate,
      };
      const built = buildComposeLinesFromQuality(
        seeded,
        opts.aprobados.map((item) => (item.id === seed.id ? seeded : item)),
        opts.workItems
      );
      if (built.lines.length === 0) {
        setRemitoError("No hay productos aptos para remito.");
        return;
      }
      // Aplicar overrides de cajas al seed line si vinieron del modal FALTAN DATOS
      if (overrides?.cajas || overrides?.unidades || overrides?.totalUnits) {
        const first = built.lines[0];
        if (first) {
          built.lines[0] = {
            ...first,
            cajas1: overrides.cajas ? Number(overrides.cajas) : first.cajas1,
            unidades1: overrides.unidades
              ? Number(overrides.unidades)
              : first.unidades1,
            totalUnits: overrides.totalUnits
              ? Number(overrides.totalUnits)
              : first.totalUnits,
            producedUnits: overrides.totalUnits
              ? Number(overrides.totalUnits)
              : first.producedUnits,
            lote: overrides.lote?.trim() || first.lote,
            vto: overrides.vto?.trim() || first.vto,
          };
        }
      }
      setComposeLines(built.lines);
      setComposeClient(
        overrides?.client?.trim() || built.clientDisplay || seed.client || ""
      );
      setComposeDate(
        overrides?.deliveryDate?.trim() || built.deliveryDate || ""
      );
      setDisplayNameInput(
        overrides?.client?.trim() || built.clientDisplay || seed.client || "Remito"
      );
      setCompleteModal(null);
      setComposeOpen(true);
      setRemitoError(null);
    },
    [opts.aprobados, opts.workItems]
  );

  const handleGenerarRemito = useCallback(
    (seed: QualityItem, overrides?: Partial<RemitoCompleteFields>) => {
      if (!canRemitos) return;
      setRemitoError(null);
      const gaps = remitoGapsFromQuality(seed, opts.workItems);
      const client = overrides?.client?.trim();
      const deliveryDate = overrides?.deliveryDate?.trim();
      if (hasBlockingRemitoGaps(gaps) && !(client && deliveryDate)) {
        openCompleteModal(seed);
        return;
      }
      openCompose(seed, overrides);
    },
    [canRemitos, openCompleteModal, openCompose, opts.workItems]
  );

  async function persistComposeLines(): Promise<string> {
    let remitoId: string | null = null;
    for (const line of composeLines) {
      const input = composeLineToApprovalInput(line, composeClient, composeDate);
      const result = await upsertRemitoDraftApi(session, input);
      remitoId = result.remito.id;
    }
    if (!remitoId) throw new Error("No se pudo crear remito.");
    return remitoId;
  }

  async function saveComposeDraft() {
    setRemitoBusy(true);
    setRemitoError(null);
    try {
      await persistComposeLines();
      setComposeOpen(false);
      await refreshRemitoStatuses();
      navigateTo({ view: "remitos" });
    } catch (e) {
      setRemitoError(e instanceof Error ? e.message : "Error al guardar borrador");
    } finally {
      setRemitoBusy(false);
    }
  }

  async function generateComposeExcel() {
    const warning = producedVsBoxedWarning(composeLines);
    if (warning) {
      const ok = window.confirm(
        `${warning}\n\n¿Generar el Excel con las cantidades del editor de todas formas?`
      );
      if (!ok) return;
    }
    setRemitoBusy(true);
    setRemitoError(null);
    try {
      const remitoId = await persistComposeLines();
      await generateRemitoApi(session, remitoId, { displayName: displayNameInput });
      setComposeOpen(false);
      await refreshRemitoStatuses();
      navigateTo({ view: "remitos" });
    } catch (e) {
      setRemitoError(e instanceof Error ? e.message : "No se pudo generar remito");
    } finally {
      setRemitoBusy(false);
    }
  }

  function cancelCompose() {
    setComposeOpen(false);
    setComposeLines([]);
    setRemitoError(null);
  }

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
    const groupN = collectSameClientDateApprovedPackaging(
      row,
      opts.aprobados,
      opts.workItems
    ).length;
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
      <div className="flex max-w-[14rem] flex-col gap-1">
        <Button
          type="button"
          size="sm"
          disabled={remitoBusy}
          onClick={() => handleGenerarRemito(row)}
          data-testid={`remito-generar-${wid}`}
        >
          GENERAR REMITO
        </Button>
        {groupN > 1 ? (
          <span className="text-[10px] text-[var(--os-text-muted)]">
            {groupN} productos agrupados (mismo cliente y fecha)
          </span>
        ) : (
          <span className="text-[10px] text-[var(--os-text-muted)]">Apto para remito</span>
        )}
      </div>
    );
  }

  const modals = (
    <>
      {remitoError && !composeOpen ? (
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
                  type={key === "deliveryDate" ? "date" : "text"}
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
                  handleGenerarRemito(completeModal.seed, completeModal.fields)
                }
              >
                Continuar al editor
              </Button>
            </div>
          </div>
        </div>
      ) : null}
      {composeOpen ? (
        <RemitoComposeEditor
          title="Generar remito"
          lines={composeLines}
          onChangeLines={setComposeLines}
          clientDisplay={composeClient}
          onClientChange={setComposeClient}
          deliveryDate={composeDate}
          onDeliveryDateChange={setComposeDate}
          displayName={displayNameInput}
          onDisplayNameChange={setDisplayNameInput}
          busy={remitoBusy}
          error={remitoError}
          onCancel={cancelCompose}
          onSaveDraft={() => void saveComposeDraft()}
          onGenerateExcel={() => void generateComposeExcel()}
        />
      ) : null}
    </>
  );

  return {
    canRemitos,
    remitoBusy,
    remitoError,
    remitoStatusByWork,
    refreshRemitoStatuses,
    handleGenerarRemito,
    renderRemitoAction,
    modals,
  };
}
