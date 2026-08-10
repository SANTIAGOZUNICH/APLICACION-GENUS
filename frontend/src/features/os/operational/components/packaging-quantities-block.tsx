"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
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
};

export function packagingDraftFromItem(item: WorkItem): PackagingDraft {
  const groups = packingGroupsFromLegacy({
    packingGroups: item.packingGroups,
    cajas: item.packagingCajas,
    unidadesPorCaja: item.packagingUnidadesPorCaja,
  });
  const summary = summarizePackingGroups(groups);
  const packagingTotalUnits = item.packagingTotalUnits ?? null;
  const warn = packingProducedMismatchWarning(packagingTotalUnits, groups);
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
  const [lote, setLote] = useState(item.packagingLote ?? item.loteRef ?? "");
  const [vto, setVto] = useState(item.packagingVto ?? "");
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
  const [msg, setMsg] = useState<string | null>(null);
  const [msgTone, setMsgTone] = useState<"ok" | "error" | "pending">("ok");
  const [saving, setSaving] = useState(false);

  const produced = total === "" ? null : Number(total);
  const warn = useMemo(
    () => packingProducedMismatchWarning(produced, groups),
    [produced, groups]
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
    };
  }, [lote, vto, total, groups, packingObs, warn.ok]);

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
        <label className="text-xs">
          LOTE
          <input
            className="mt-1 w-full rounded border px-2 py-1.5"
            value={lote}
            disabled={readOnly}
            onChange={(e) => setLote(e.target.value)}
            data-testid="packaging-lote"
          />
        </label>
        <label className="text-xs">
          VTO
          <input
            className="mt-1 w-full rounded border px-2 py-1.5"
            value={vto}
            disabled={readOnly}
            onChange={(e) => setVto(e.target.value)}
            data-testid="packaging-vto"
          />
        </label>
      </div>
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

      <PackingGroupsEditor
        groups={groups}
        onChange={setGroups}
        producedUnits={produced}
        packingObservation={packingObs}
        onPackingObservationChange={setPackingObs}
        readOnly={readOnly}
        requireObservationOnMismatch
        testIdPrefix="packaging"
      />

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
