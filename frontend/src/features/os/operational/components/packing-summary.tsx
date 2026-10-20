import { NO_PACKING_TEXT, itemText, packingBreakdown, unitsAndCajasText, type PackingBreakdown, type PackingGroupLike } from "@/lib/remitos/packing-breakdown";

/**
 * Cajas y unidades por caja, siempre igual: «53 unidades — 11 cajas» y debajo «10 × 5 + 1 × 3».
 * `detail` agrega el desglose completo («10 cajas × 5 unidades = 50 unidades»). Sin datos: «Sin detalle de cajas registrado».
 */
export function PackingSummary({
  groups,
  breakdown,
  detail = false,
  label,
  testId = "packing-summary",
}: {
  groups?: PackingGroupLike[] | null;
  breakdown?: PackingBreakdown | null;
  detail?: boolean;
  label?: string | null;
  testId?: string;
}) {
  const b = breakdown !== undefined ? breakdown : packingBreakdown(groups);
  if (!b) {
    return (
      <span className="block text-xs text-[var(--genus-warning)]" data-testid={`${testId}-empty`}>
        {label ? `${label}: ` : ""}
        {NO_PACKING_TEXT}
      </span>
    );
  }
  return (
    <span className="block" data-testid={testId}>
      {label ? <span className="block text-[11px] font-medium text-[var(--os-text-muted)]">{label}</span> : null}
      <span className="block text-sm font-medium tabular-nums" data-testid={`${testId}-total`}>{unitsAndCajasText(b)}</span>
      <span className="block font-mono text-xs text-[var(--os-text-muted)]" data-testid={`${testId}-short`}>{b.short}</span>
      {detail ? (
        <ul className="mt-1 space-y-0.5 text-xs" data-testid={`${testId}-detail`}>
          {b.items.map((i) => (
            <li key={`${i.cajas}x${i.unidadesPorCaja}`}>{itemText(i)}</li>
          ))}
        </ul>
      ) : null}
    </span>
  );
}
