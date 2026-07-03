/** Parse cantidad numérica desde texto planilla (1.200, 3300 u, etc.). */
export function parseOperationalQuantity(value: string | null | undefined): number | null {
  if (!value?.trim()) return null;
  const normalized = value
    .trim()
    .replace(/\s*(u|kg|ml|unidades?)\s*$/i, "")
    .replace(/\./g, "")
    .replace(",", ".");
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatOperationalDifference(
  planned: string | null | undefined,
  finished: string | null | undefined
): string {
  const plannedNum = parseOperationalQuantity(planned);
  const finishedNum = parseOperationalQuantity(finished);
  if (plannedNum === null || finishedNum === null) return "—";
  const diff = finishedNum - plannedNum;
  if (diff === 0) return "0";
  return diff > 0 ? `+${diff}` : String(diff);
}

export function plannedQuantityLabel(
  quantity: string | null | undefined,
  unit: string | null | undefined
): string {
  if (!quantity?.trim()) return "—";
  if (unit?.trim()) return `${quantity} ${unit}`;
  return quantity;
}
