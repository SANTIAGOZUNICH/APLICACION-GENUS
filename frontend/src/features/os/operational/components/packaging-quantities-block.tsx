"use client";

import { useMemo, useState } from "react";
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

/** Bloque LOTE / VTO + Total + Cajas 1/2/3 (envasado). */
export function PackagingQuantitiesBlock({
  item,
  actorName,
  onSaved,
  readOnly = false,
  sector,
}: {
  item: WorkItem;
  actorName: string;
  onSaved?: (item: WorkItem) => void;
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

  const produced = total === "" ? null : Number(total);
  const warn = useMemo(
    () => packingProducedMismatchWarning(produced, groups),
    [produced, groups]
  );

  function save() {
    if (readOnly) return;
    if (!warn.ok && !packingObs.trim()) {
      setMsg("Indicá una observación si producido y embalado no coinciden.");
      return;
    }
    const summary = summarizePackingGroups(groups);
    const packagingTotalUnits = total === "" ? null : Number(total);
    const packagingCajas = summary.groups[0]?.cajas ?? null;
    const packagingUnidadesPorCaja = summary.groups[0]?.unidadesPorCaja ?? null;

    // Live Sync: cualquier WorkItem (Drive o manual) — visible en Producción.
    saveWorkPackaging(item.id, {
      updatedBy: actorName,
      sector: sector ?? item.sector,
      packagingLote: lote,
      packagingVto: vto,
      packagingTotalUnits,
      packagingCajas,
      packagingUnidadesPorCaja,
      packingGroups: groups,
      packingMismatchObservation: packingObs,
    });

    // Compat: si es trabajo manual, también actualizar el store local.
    const updatedManual = updateManualWorkItemPackaging({
      id: item.id,
      actorName,
      packagingLote: lote,
      packagingVto: vto,
      packagingTotalUnits,
      packingGroups: groups,
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
      packingGroups: groups,
      packingMismatchObservation: packingObs.trim() || null,
      loteRef: lote.trim() || item.loteRef,
    };
    setMsg("Avance guardado.");
    onSaved?.(next);
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

      {!readOnly ? (
        <Button type="button" onClick={save} data-testid="packaging-save">
          Guardar avance
        </Button>
      ) : null}
      {msg ? <p className="text-xs text-emerald-700">{msg}</p> : null}
    </div>
  );
}
