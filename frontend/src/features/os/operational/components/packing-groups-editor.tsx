"use client";

import { Button } from "@/components/ui/button";
import {
  ensureMinPackingSlots,
  packingProducedMismatchWarning,
  parseNonNegInt,
  summarizePackingGroups,
  type PackingGroup,
} from "@/lib/remitos/packing-math";

type Props = {
  groups: PackingGroup[];
  onChange: (groups: PackingGroup[]) => void;
  producedUnits?: number | null;
  packingObservation?: string;
  onPackingObservationChange?: (v: string) => void;
  readOnly?: boolean;
  showSummary?: boolean;
  /** Si true, exige observación cuando hay mismatch (UI only; no bloquea). */
  requireObservationOnMismatch?: boolean;
  testIdPrefix?: string;
};

/**
 * Combinaciones Cajas 1/2/3 + extras. Reutilizado en Envasado y remito.
 */
export function PackingGroupsEditor({
  groups,
  onChange,
  producedUnits,
  packingObservation = "",
  onPackingObservationChange,
  readOnly = false,
  showSummary = true,
  requireObservationOnMismatch = false,
  testIdPrefix = "packing",
}: Props) {
  const slots = ensureMinPackingSlots(groups, 3);
  const summary = summarizePackingGroups(slots);
  const warn = packingProducedMismatchWarning(producedUnits, slots);
  const needsObs = !warn.ok && requireObservationOnMismatch;

  function updateAt(index: number, patch: Partial<PackingGroup>) {
    if (readOnly) return;
    const next = slots.map((g, i) =>
      i === index
        ? {
            cajas: patch.cajas !== undefined ? parseNonNegInt(patch.cajas) : g.cajas,
            unidadesPorCaja:
              patch.unidadesPorCaja !== undefined
                ? parseNonNegInt(patch.unidadesPorCaja)
                : g.unidadesPorCaja,
          }
        : g
    );
    onChange(next);
  }

  function addSlot() {
    if (readOnly) return;
    onChange([...slots, { cajas: 0, unidadesPorCaja: 0 }]);
  }

  function removeSlot(index: number) {
    if (readOnly || index < 3) return;
    onChange(slots.filter((_, i) => i !== index));
  }

  return (
    <div className="space-y-3" data-testid={`${testIdPrefix}-groups-editor`}>
      {slots.map((g, i) => {
        const label = i < 3 ? `Cajas ${i + 1}` : `Cajas extra ${i - 2}`;
        const lineTotal = g.cajas * g.unidadesPorCaja;
        return (
          <div
            key={i}
            className="flex flex-wrap items-center gap-2 text-xs"
            data-testid={`${testIdPrefix}-slot-${i}`}
          >
            <span className="w-24 shrink-0 font-medium">{label}:</span>
            <input
              type="number"
              min={0}
              step={1}
              disabled={readOnly}
              className="w-20 rounded border px-2 py-1"
              value={g.cajas || ""}
              placeholder="0"
              onChange={(e) => updateAt(i, { cajas: Number(e.target.value) })}
              data-testid={`${testIdPrefix}-cajas-${i}`}
            />
            <span>×</span>
            <input
              type="number"
              min={0}
              step={1}
              disabled={readOnly}
              className="w-20 rounded border px-2 py-1"
              value={g.unidadesPorCaja || ""}
              placeholder="0"
              onChange={(e) =>
                updateAt(i, { unidadesPorCaja: Number(e.target.value) })
              }
              data-testid={`${testIdPrefix}-upc-${i}`}
            />
            <span className="text-[var(--os-text-muted)]">
              = {lineTotal} u.
            </span>
            {i >= 3 && !readOnly ? (
              <Button
                type="button"
                size="sm"
                variant="tertiary"
                onClick={() => removeSlot(i)}
              >
                Quitar
              </Button>
            ) : null}
          </div>
        );
      })}

      {!readOnly ? (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={addSlot}
          data-testid={`${testIdPrefix}-add-slot`}
        >
          + Agregar otro tipo de caja
        </Button>
      ) : null}

      {showSummary ? (
        <div
          className="rounded border border-[var(--os-border)] bg-[var(--os-surface-muted,#f8fafc)] p-3 text-sm"
          data-testid={`${testIdPrefix}-summary`}
        >
          <p className="mb-1 font-medium">RESUMEN DE EMBALAJE</p>
          <ul className="space-y-0.5 text-xs text-[var(--os-text-muted)]">
            <li>
              Total producido:{" "}
              {producedUnits != null && Number.isFinite(producedUnits)
                ? producedUnits
                : "—"}
            </li>
            <li>Total de cajas: {summary.totalCajas}</li>
            <li>Total embalado: {summary.totalEmbalado} unidades</li>
          </ul>
        </div>
      ) : null}

      {!warn.ok && warn.message ? (
        <p
          className="text-xs text-amber-800"
          role="alert"
          data-testid={`${testIdPrefix}-mismatch`}
        >
          {warn.message}
        </p>
      ) : null}

      {needsObs || (!warn.ok && onPackingObservationChange) ? (
        <label className="block text-xs">
          Observación de embalaje
          {needsObs ? " (requerida para documentar la diferencia)" : ""}
          <textarea
            className="mt-1 w-full rounded border px-2 py-1.5 text-sm"
            rows={2}
            disabled={readOnly}
            value={packingObservation}
            onChange={(e) => onPackingObservationChange?.(e.target.value)}
            data-testid={`${testIdPrefix}-observation`}
          />
        </label>
      ) : null}
    </div>
  );
}
