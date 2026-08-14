"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  computePackagingClose,
  packingGroupsFromLegacy,
  packingProducedMismatchWarning,
  summarizePackingGroups,
  type PackingGroup,
} from "@/lib/remitos/packing-math";
import { updateManualWorkItemPackaging } from "@/features/os/operational/adapters/manual-work-items-repository";
import { useOperationalStore } from "@/features/os/operational/store/operational-store-context";
import type { WorkItem } from "@/types/operational/work-item";
import { PackingGroupsEditor } from "./packing-groups-editor";

export type PackagingDraft = {
  packagingLote: string;
  packagingVto: string;
  packagingTotalUnits: number | null;
  packagingCajas: number | null;
  packagingUnidadesPorCaja: number | null;
  packingGroups: PackingGroup[];
  packingMismatchObservation: string;
  mismatchOk: boolean;
  /** Unidades producidas pero no entregables (PARTE A). null = no informado. */
  sampleUnits: number | null;
};

export function packagingDraftFromItem(item: WorkItem): PackagingDraft {
  const groups = packingGroupsFromLegacy({
    packingGroups: item.packingGroups,
    cajas: item.packagingCajas,
    unidadesPorCaja: item.packagingUnidadesPorCaja,
  });
  const summary = summarizePackingGroups(groups);
  const packagingTotalUnits = item.packagingTotalUnits ?? null;
  const warn = packingProducedMismatchWarning(
    packagingTotalUnits,
    groups,
    item.sampleUnits ?? 0
  );
  return {
    packagingLote: item.packagingLote ?? item.loteRef ?? "",
    packagingVto: item.packagingVto ?? "",
    packagingTotalUnits,
    packagingCajas: summary.groups[0]?.cajas ?? item.packagingCajas ?? null,
    packagingUnidadesPorCaja:
      summary.groups[0]?.unidadesPorCaja ?? item.packagingUnidadesPorCaja ?? null,
    packingGroups: groups,
    packingMismatchObservation: item.packingMismatchObservation ?? "",
    mismatchOk: warn.ok,
    sampleUnits: item.sampleUnits ?? null,
  };
}

/** Bloque LOTE / VTO + Total + Cajas 1/2/3 (envasado / codificado). */
export function PackagingQuantitiesBlock({
  item,
  actorName,
  onSaved,
  onDraftChange,
  hideSaveButton = false,
  readOnly = false,
  sector,
}: {
  item: WorkItem;
  actorName: string;
  onSaved?: (item: WorkItem) => void;
  onDraftChange?: (draft: PackagingDraft) => void;
  hideSaveButton?: boolean;
  readOnly?: boolean;
  sector?: WorkItem["sector"];
}) {
  const { saveWorkPackaging } = useOperationalStore();
  // Lote/VTO: fuente única = Producción (PARTE A). Envasado/Codificado los
  // leen del item, nunca los editan acá — ver lote-vto-correction.ts para
  // el único mecanismo autorizado de corrección.
  const lote = item.packagingLote ?? item.loteRef ?? "";
  const vto = item.packagingVto ?? "";
  const [total, setTotal] = useState(
    item.packagingTotalUnits != null ? String(item.packagingTotalUnits) : ""
  );
  const [groups, setGroups] = useState<PackingGroup[]>(() =>
    packingGroupsFromLegacy({
      packingGroups: item.packingGroups,
      cajas: item.packagingCajas,
      unidadesPorCaja: item.packagingUnidadesPorCaja,
    })
  );
  const [packingObs, setPackingObs] = useState(
    item.packingMismatchObservation ?? ""
  );
  const [sampleUnitsInput, setSampleUnitsInput] = useState(
    item.sampleUnits != null ? String(item.sampleUnits) : ""
  );
  const [msg, setMsg] = useState<string | null>(null);
  const [msgTone, setMsgTone] = useState<"ok" | "error" | "pending">("ok");
  const [saving, setSaving] = useState(false);

  const produced = total === "" ? null : Number(total);
  const sampleUnits =
    sampleUnitsInput.trim() === "" ? null : Math.max(0, Math.floor(Number(sampleUnitsInput)));
  // El balance compara NETO (producido − muestras) vs embalado, no el bruto.
  const warn = useMemo(
    () => packingProducedMismatchWarning(produced, groups, sampleUnits ?? 0),
    [produced, groups, sampleUnits]
  );
  const close = useMemo(
    () => computePackagingClose({ finishedQty: produced, sampleUnits, groups }),
    [produced, sampleUnits, groups]
  );

  const draft = useMemo((): PackagingDraft => {
    const summary = summarizePackingGroups(groups);
    return {
      packagingLote: lote,
      packagingVto: vto,
      packagingTotalUnits: total === "" ? null : Number(total),
      packagingCajas: summary.groups[0]?.cajas ?? null,
      packagingUnidadesPorCaja: summary.groups[0]?.unidadesPorCaja ?? null,
      packingGroups: groups,
      packingMismatchObservation: packingObs,
      mismatchOk: warn.ok,
      sampleUnits,
    };
  }, [lote, vto, total, groups, packingObs, warn.ok, sampleUnits]);

  useEffect(() => {
    onDraftChange?.(draft);
  }, [draft, onDraftChange]);

  async function save() {
    if (readOnly || saving) return;
    if (!warn.ok && !packingObs.trim()) {
      setMsgTone("error");
      setMsg("Indicá una observación si producido y embalado no coinciden.");
      return;
    }
    const {
      packagingTotalUnits,
      packagingCajas,
      packagingUnidadesPorCaja,
      packingGroups,
    } = draft;
    const sampleUnitsToSave = sampleUnits;

    setSaving(true);
    setMsgTone("pending");
    setMsg("Guardando…");
    try {
      // Fuente de verdad: Neon. No se marca "Guardado" hasta que el
      // servidor confirme — antes esto era fire-and-forget y la UI mentía
      // si el POST fallaba (ver AUDIT_TRAZABILIDAD, P0-4/L).
      await saveWorkPackaging(item.id, {
        updatedBy: actorName,
        sector: sector ?? item.sector,
        packagingLote: lote,
        packagingVto: vto,
        packagingTotalUnits,
        packagingCajas,
        packagingUnidadesPorCaja,
        packingGroups,
        packingMismatchObservation: packingObs,
        sampleUnits: sampleUnitsToSave,
      });

      // Compat: si es trabajo manual (localStorage legacy, modo sheets), también
      // actualizar el store local. No-op en modo nativo (Neon).
      const updatedManual = updateManualWorkItemPackaging({
        id: item.id,
        actorName,
        packagingLote: lote,
        packagingVto: vto,
        packagingTotalUnits,
        packingGroups,
        packagingCajas,
        packagingUnidadesPorCaja,
        packingMismatchObservation: packingObs,
      });

      const next: WorkItem = {
        ...(updatedManual ?? item),
        packagingLote: lote.trim() || null,
        packagingVto: vto.trim() || null,
        packagingTotalUnits,
        packagingCajas,
        packagingUnidadesPorCaja,
        packingGroups,
        packingMismatchObservation: packingObs.trim() || null,
        loteRef: lote.trim() || item.loteRef,
        sampleUnits: sampleUnitsToSave,
      };
      setMsgTone("ok");
      setMsg("Avance guardado.");
      onSaved?.(next);
    } catch (err) {
      setMsgTone("error");
      setMsg(
        err instanceof Error
          ? `No se guardó: ${err.message} — lo tipeado se conserva, reintentá.`
          : "No se pudo guardar en el servidor. Lo tipeado se conserva — reintentá."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="space-y-2 rounded border border-[var(--os-border)] p-3 text-sm"
      data-testid="packaging-quantities-block"
    >
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="text-xs">
          <span className="block text-[var(--os-text-muted)]">LOTE</span>
          <p className="mt-1 rounded border border-transparent bg-[var(--os-surface-muted,#f8fafc)] px-2 py-1.5 font-medium" data-testid="packaging-lote">
            {lote || "—"}
          </p>
        </div>
        <div className="text-xs">
          <span className="block text-[var(--os-text-muted)]">VTO</span>
          <p className="mt-1 rounded border border-transparent bg-[var(--os-surface-muted,#f8fafc)] px-2 py-1.5 font-medium" data-testid="packaging-vto">
            {vto || "—"}
          </p>
        </div>
      </div>
      <p className="text-[11px] text-[var(--os-text-muted)]">
        Lote y VTO los define Producción al asignar el trabajo. Si hay que corregirlos, pedile a Producción que use &ldquo;Corregir lote/VTO&rdquo;.
      </p>
      <label className="block text-xs">
        Total de unidades producidas:{" "}
        <input
          className="ml-1 w-28 rounded border px-2 py-1"
          value={total}
          disabled={readOnly}
          onChange={(e) => setTotal(e.target.value)}
          data-testid="packaging-total-units"
        />
      </label>

      <div className="space-y-2 rounded border border-[var(--os-border)] p-3">
        <p className="text-xs font-semibold uppercase text-[var(--os-text-muted)]">
          Distribución final
        </p>
        <PackingGroupsEditor
          groups={groups}
          onChange={setGroups}
          producedUnits={produced}
          sampleUnits={sampleUnits}
          packingObservation={packingObs}
          onPackingObservationChange={setPackingObs}
          readOnly={readOnly}
          requireObservationOnMismatch
          testIdPrefix="packaging"
        />

        <label className="block text-xs">
          Muestras (unidades producidas, no entregables)
          <input
            type="number"
            min={0}
            step={1}
            className="mt-1 w-28 rounded border px-2 py-1"
            value={sampleUnitsInput}
            disabled={readOnly}
            onChange={(e) => setSampleUnitsInput(e.target.value)}
            data-testid="packaging-sample-units"
          />
        </label>

        <div
          className="rounded border border-[var(--os-border)] bg-[var(--os-surface-muted,#f8fafc)] p-3 text-xs"
          data-testid="packaging-close-summary"
        >
          <ul className="space-y-0.5 text-[var(--os-text-muted)]">
            <li>Cantidad final: {close.canValidate ? close.finishedUnits : "—"}</li>
            <li>Muestras: {close.muestras}</li>
            <li>A embalar: {close.canValidate ? close.deliverableUnits : "—"}</li>
            <li>Embalado: {close.packedUnits}</li>
            <li className="font-medium text-[var(--os-text,#111)]">
              Diferencia: {close.canValidate ? close.difference : "—"}
            </li>
          </ul>
          {close.canValidate ? (
            <p
              className={close.isBalanced ? "mt-2 font-medium text-emerald-700" : "mt-2 font-medium text-amber-800"}
              role={close.isBalanced ? undefined : "alert"}
              data-testid="packaging-close-indicator"
            >
              {close.isBalanced
                ? "✓ Puede entregar"
                : close.difference > 0
                  ? `Faltan embalar ${close.difference} unidad(es).`
                  : `Lo embalado supera lo entregable por ${Math.abs(close.difference)} unidad(es).`}
            </p>
          ) : null}
        </div>
      </div>

      {!readOnly && !hideSaveButton ? (
        <Button type="button" onClick={save} disabled={saving} data-testid="packaging-save">
          {saving ? "Guardando…" : "Guardar avance"}
        </Button>
      ) : null}
      {msg ? (
        <p
          className={
            msgTone === "error"
              ? "text-xs text-[var(--genus-error)]"
              : msgTone === "pending"
                ? "text-xs text-[var(--os-text-muted)]"
                : "text-xs text-emerald-700"
          }
          role={msgTone === "error" ? "alert" : undefined}
        >
          {msg}
        </p>
      ) : null}
    </div>
  );
}
