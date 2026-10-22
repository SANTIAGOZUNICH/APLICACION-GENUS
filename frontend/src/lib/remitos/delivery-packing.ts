/**
 * Cajas de UNA entrega real. Cada grupo es «N cajas de M unidades»; puede haber varios grupos con cantidades distintas
 * (nunca se asume que todas las cajas son iguales). El total calculado debe coincidir con las unidades entregadas.
 */
export type DeliveryPackingGroup = { cajas: number; unidadesPorCaja: number };

export type DeliveryPackingResult =
  | { ok: true; groups: DeliveryPackingGroup[]; cajas: number; unidades: number }
  | { ok: false; error: string };

export function validateDeliveryPacking(raw: unknown, deliveredUnits: number | null): DeliveryPackingResult {
  if (raw == null) return { ok: true, groups: [], cajas: 0, unidades: 0 };
  if (!Array.isArray(raw)) return { ok: false, error: "El detalle de cajas no es válido." };
  const groups: DeliveryPackingGroup[] = [];
  for (const g of raw as Array<{ cajas?: unknown; unidadesPorCaja?: unknown }>) {
    const cajas = Number(g?.cajas ?? 0);
    const upc = Number(g?.unidadesPorCaja ?? 0);
    if (cajas === 0 && upc === 0) continue; // fila vacía del editor
    if (!Number.isInteger(cajas) || !Number.isInteger(upc) || cajas <= 0 || upc <= 0) {
      return { ok: false, error: "Cada grupo de cajas necesita una cantidad de cajas y de unidades por caja (enteros mayores a 0)." };
    }
    groups.push({ cajas, unidadesPorCaja: upc });
  }
  const cajas = groups.reduce((s, g) => s + g.cajas, 0);
  const unidades = groups.reduce((s, g) => s + g.cajas * g.unidadesPorCaja, 0);
  if (groups.length > 0 && deliveredUnits != null && unidades !== deliveredUnits) {
    return { ok: false, error: `Las cajas suman ${unidades} u. pero la entrega es de ${deliveredUnits} u. Corregí las cajas o la cantidad.` };
  }
  return { ok: true, groups, cajas, unidades };
}

/** «12 cajas de 100 u. + 1 caja de 50 u. = 13 cajas / 1.250 u.» */
export function describeDeliveryPacking(groups: DeliveryPackingGroup[]): string | null {
  const valid = groups.filter((g) => g.cajas > 0 && g.unidadesPorCaja > 0);
  if (valid.length === 0) return null;
  const fmt = (n: number) => new Intl.NumberFormat("es-AR").format(n);
  const cajas = valid.reduce((s, g) => s + g.cajas, 0);
  const units = valid.reduce((s, g) => s + g.cajas * g.unidadesPorCaja, 0);
  return `${valid.map((g) => `${fmt(g.cajas)} ${g.cajas === 1 ? "caja" : "cajas"} de ${fmt(g.unidadesPorCaja)} u.`).join(" + ")} = ${fmt(cajas)} ${cajas === 1 ? "caja" : "cajas"} / ${fmt(units)} u.`;
}

// ── Recuperación de cajas de una entrega desde el trabajo (fuente única) ────────────────────────────────────────────
export type PackingSource = "ENTREGA" | "TRABAJO" | "SNAPSHOT" | "NINGUNA";

export type PackingLineInput = { id: string; quantity: number; groups: DeliveryPackingGroup[] | null | undefined };

export type ResolvedLinePacking = {
  groups: DeliveryPackingGroup[];
  source: PackingSource;
  /** Hay datos de cajas en el trabajo pero NO alcanzan para asignarlos sin ambigüedad: se muestran como sugerencia. */
  suggested?: DeliveryPackingGroup[];
  warning?: string;
};

const validGroups = (g: ReadonlyArray<{ cajas?: unknown; unidadesPorCaja?: unknown }> | null | undefined): DeliveryPackingGroup[] =>
  (g ?? [])
    .map((x) => ({ cajas: Number(x?.cajas) || 0, unidadesPorCaja: Number(x?.unidadesPorCaja) || 0 }))
    .filter((x) => x.cajas > 0 && x.unidadesPorCaja > 0);

const unitsOf = (g: DeliveryPackingGroup[]) => g.reduce((s, x) => s + x.cajas * x.unidadesPorCaja, 0);

/**
 * Cajas de cada entrega ACTIVA de UN trabajo. Prioridad: lo guardado en la propia entrega; si la entrega no lo tiene,
 * las cajas registradas en el trabajo (Envasado/Codificado) menos las ya asignadas a otras entregas; si el trabajo ya
 * no las tiene, el snapshot que quedó en el registro de entrega. Solo se asigna cuando es inequívoco: una única entrega
 * sin cajas y las cajas restantes suman EXACTAMENTE sus unidades. Nunca se divide ni se inventa una capacidad por caja.
 */
export function resolveWorkItemDeliveryPacking(input: {
  workItemGroups: unknown;
  snapshotGroups?: unknown;
  lines: PackingLineInput[];
}): Map<string, ResolvedLinePacking> {
  const out = new Map<string, ResolvedLinePacking>();
  const missing: PackingLineInput[] = [];
  for (const l of input.lines) {
    const own = validGroups(l.groups);
    if (own.length > 0) out.set(l.id, { groups: own, source: "ENTREGA" });
    else missing.push(l);
  }
  if (missing.length === 0) return out;

  const fromWork = validGroups(input.workItemGroups as never);
  const base = fromWork.length > 0 ? fromWork : validGroups(input.snapshotGroups as never);
  const source: PackingSource = fromWork.length > 0 ? "TRABAJO" : "SNAPSHOT";
  const none = (warning?: string, suggested?: DeliveryPackingGroup[]): ResolvedLinePacking => ({
    groups: [],
    source: "NINGUNA",
    ...(suggested && suggested.length > 0 ? { suggested } : {}),
    ...(warning ? { warning } : {}),
  });
  if (base.length === 0) {
    for (const l of missing) out.set(l.id, none());
    return out;
  }

  const left = new Map<number, number>();
  for (const g of base) left.set(g.unidadesPorCaja, (left.get(g.unidadesPorCaja) ?? 0) + g.cajas);
  let contradictory = false;
  for (const l of input.lines) {
    for (const g of validGroups(l.groups)) {
      const rest = (left.get(g.unidadesPorCaja) ?? 0) - g.cajas;
      if (rest < 0) contradictory = true;
      left.set(g.unidadesPorCaja, Math.max(0, rest));
    }
  }
  const leftover: DeliveryPackingGroup[] = [...left.entries()]
    .filter(([, c]) => c > 0)
    .map(([unidadesPorCaja, cajas]) => ({ cajas, unidadesPorCaja }))
    .sort((a, b) => b.unidadesPorCaja - a.unidadesPorCaja);

  const fmt = (n: number) => new Intl.NumberFormat("es-AR").format(n);
  const missingQty = missing.reduce((s, l) => s + (Number(l.quantity) || 0), 0);
  const leftoverUnits = unitsOf(leftover);
  let verdict: ResolvedLinePacking | null = null;
  let perLine: ResolvedLinePacking;
  if (contradictory) {
    perLine = none("Las cajas ya asignadas a otras entregas superan las registradas en el trabajo: revisalas.", base);
  } else if (missing.length === 1 && leftoverUnits === missingQty) {
    verdict = { groups: leftover, source };
    perLine = verdict;
  } else if (leftoverUnits === missingQty) {
    perLine = none(`Hay ${missing.length} entregas sin cajas y no se puede repartir el detalle del trabajo entre ellas: completalo en cada una.`, leftover);
  } else {
    perLine = none(
      `El trabajo tiene ${fmt(leftoverUnits)} u. en cajas registradas y estas entregas suman ${fmt(missingQty)} u.: completá o corregí las cajas.`,
      leftover
    );
  }
  for (const l of missing) out.set(l.id, perLine);
  return out;
}
