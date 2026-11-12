"use client";

import { PackingGroupsEditor } from "./packing-groups-editor";
import { validateDeliveryPacking } from "@/lib/remitos/delivery-packing";
import type { PackingGroup } from "@/lib/remitos/packing-math";

const fmt = (n: number) => new Intl.NumberFormat("es-AR", { maximumFractionDigits: 3 }).format(n);

type Props = {
  boxes: PackingGroup[];
  onBoxesChange: (groups: PackingGroup[]) => void;
  /** Cantidad total de la entrega (si ya se conoce): las cajas deben sumarla. */
  expected: number | null;
  /** «Usar N como cantidad total»: completa la cantidad con la suma de las cajas (opción A: cargar cajas). */
  onUseTotal?: (total: number) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Prefijo de los data-testid (por compatibilidad: «deliver» → deliver-boxes-toggle / deliver-boxes-total). */
  prefix?: string;
  label?: string;
};

/**
 * Cajas de UNA entrega: «N cajas × M unidades» en varios tipos de caja (cajas incompletas incluidas). Reutiliza el editor de cajas
 * existente. Dos maneras de trabajar: cargar las cajas y usar su total como cantidad, o informar la cantidad y completar el desglose
 * (que entonces debe sumarla exactamente). Es OPCIONAL: no se exige cuando todavía no se conoce el embalaje.
 */
export function DeliveryBoxesSection({ boxes, onBoxesChange, expected, onUseTotal, open, onOpenChange, prefix = "deliver", label = "Cajas de esta entrega" }: Props) {
  const live = validateDeliveryPacking(boxes, null);
  const total = live.ok ? live.unidades : 0;
  const cajas = live.ok ? live.cajas : 0;
  const mismatch = expected != null && total > 0 && total !== expected;
  return (
    <div className="rounded border border-[var(--os-border)] p-2" data-testid={`${prefix}-boxes-section`}>
      <button type="button" className="min-h-10 text-xs font-medium text-[var(--os-teal)]" onClick={() => onOpenChange(!open)} data-testid={`${prefix}-boxes-toggle`}>
        {open ? `▾ ${label}` : `▸ Cargar ${label.charAt(0).toLowerCase()}${label.slice(1)} (opcional)`}
      </button>
      {open ? (
        <div className="mt-2 space-y-2">
          <PackingGroupsEditor groups={boxes} onChange={onBoxesChange} testIdPrefix={`${prefix}-box`} />
          <p className={`text-xs ${mismatch ? "text-[var(--genus-warning)]" : "text-[var(--os-text-muted)]"}`} data-testid={`${prefix}-boxes-total`}>
            Total: {cajas} {cajas === 1 ? "caja" : "cajas"} · {fmt(total)} u.
            {expected != null ? ` (la entrega es de ${fmt(expected)} u.)` : ""}
          </p>
          {mismatch ? (
            <p className="rounded border border-amber-300/40 bg-amber-300/10 px-2 py-1 text-xs text-[var(--genus-warning)]" data-testid={`${prefix}-boxes-diff`}>
              Las cajas suman {fmt(total)} u. y la entrega es de {fmt(expected ?? 0)} u.: se registra igual con las cantidades reales y la diferencia ({fmt(Math.abs((expected ?? 0) - total))} u.) queda por conciliar. Podés corregir el embalaje después.
            </p>
          ) : null}
          {total > 0 && onUseTotal && total !== expected ? (
            <button type="button" className="min-h-9 rounded border border-[var(--os-border)] px-3 text-xs" onClick={() => onUseTotal(total)} data-testid={`${prefix}-boxes-use-total`}>
              Usar {fmt(total)} u. como cantidad total
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
