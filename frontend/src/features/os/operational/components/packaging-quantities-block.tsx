"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { packingTotalMismatchWarning } from "@/lib/remitos/packing-math";
import { updateManualWorkItemPackaging } from "@/features/os/operational/adapters/manual-work-items-repository";
import type { WorkItem } from "@/types/operational/work-item";

/** Bloque LOTE / VTO + Total unidades / Cajas × Unidades (envasado). */
export function PackagingQuantitiesBlock({
  item,
  actorName,
  onSaved,
  readOnly = false,
}: {
  item: WorkItem;
  actorName: string;
  onSaved?: (item: WorkItem) => void;
  readOnly?: boolean;
}) {
  const [lote, setLote] = useState(item.packagingLote ?? item.loteRef ?? "");
  const [vto, setVto] = useState(item.packagingVto ?? "");
  const [total, setTotal] = useState(
    item.packagingTotalUnits != null ? String(item.packagingTotalUnits) : ""
  );
  const [cajas, setCajas] = useState(
    item.packagingCajas != null ? String(item.packagingCajas) : ""
  );
  const [upc, setUpc] = useState(
    item.packagingUnidadesPorCaja != null
      ? String(item.packagingUnidadesPorCaja)
      : ""
  );
  const [msg, setMsg] = useState<string | null>(null);

  const warn = useMemo(() => {
    const t = total === "" ? null : Number(total);
    const c = cajas === "" ? null : Number(cajas);
    const u = upc === "" ? null : Number(upc);
    return packingTotalMismatchWarning(t, c, u);
  }, [total, cajas, upc]);

  function save() {
    if (readOnly) return;
    const updated = updateManualWorkItemPackaging({
      id: item.id,
      actorName,
      packagingLote: lote,
      packagingVto: vto,
      packagingTotalUnits: total === "" ? null : Number(total),
      packagingCajas: cajas === "" ? null : Number(cajas),
      packagingUnidadesPorCaja: upc === "" ? null : Number(upc),
    });
    if (!updated) {
      setMsg("No se pudo guardar.");
      return;
    }
    setMsg("Avance guardado.");
    onSaved?.(updated);
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
        Total de unidades:{" "}
        <input
          className="ml-1 w-28 rounded border px-2 py-1"
          value={total}
          disabled={readOnly}
          onChange={(e) => setTotal(e.target.value)}
          data-testid="packaging-total-units"
        />
      </label>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span>Cajas:</span>
        <input
          className="w-20 rounded border px-2 py-1"
          value={cajas}
          disabled={readOnly}
          onChange={(e) => setCajas(e.target.value)}
          data-testid="packaging-cajas"
        />
        <span>×</span>
        <span>Unidades por caja:</span>
        <input
          className="w-20 rounded border px-2 py-1"
          value={upc}
          disabled={readOnly}
          onChange={(e) => setUpc(e.target.value)}
          data-testid="packaging-upc"
        />
        {warn.calculated != null ? (
          <span className="text-[var(--os-text-muted)]">= {warn.calculated}</span>
        ) : null}
      </div>
      {!warn.ok && warn.message ? (
        <p className="text-xs text-amber-800" role="alert" data-testid="packaging-mismatch">
          {warn.message}
        </p>
      ) : null}
      {!readOnly ? (
        <Button type="button" onClick={save} data-testid="packaging-save">
          Guardar avance
        </Button>
      ) : null}
      {msg ? <p className="text-xs text-emerald-700">{msg}</p> : null}
    </div>
  );
}
