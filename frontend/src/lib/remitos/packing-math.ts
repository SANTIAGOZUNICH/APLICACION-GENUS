import { parseArInteger } from "@/lib/utils/ar-number-parsing";

/**
 * Embalaje multi-caja compartido: Envasado entrega + remito compose/Excel.
 * packingGroups es la fuente canónica; cajas/unidadesPorCaja legacy = grupo[0].
 */
export type PackingGroup = {
  cajas: number;
  unidadesPorCaja: number;
};

export type PackingSummary = {
  totalCajas: number;
  totalEmbalado: number;
  groups: PackingGroup[];
};

/**
 * Entero ≥ 0; vacío → 0. Punto = separador de miles (parseArInteger), no
 * decimal — "1.500" cajas son mil quinientas, no una coma cinco.
 */
export function parseNonNegInt(raw: string | number | null | undefined): number {
  if (raw === "" || raw == null) return 0;
  const parsed = parseArInteger(raw);
  if (!parsed.ok || parsed.value == null || parsed.value < 0) return 0;
  return parsed.value;
}

export function normalizePackingGroups(
  groups: Array<{ cajas?: number | null; unidadesPorCaja?: number | null }> | null | undefined
): PackingGroup[] {
  if (!groups?.length) return [];
  return groups.map((g) => ({
    cajas: parseNonNegInt(g.cajas),
    unidadesPorCaja: parseNonNegInt(g.unidadesPorCaja),
  }));
}

/** Deriva grupos desde legacy single-slot o desde packingGroups. */
export function packingGroupsFromLegacy(input: {
  packingGroups?: PackingGroup[] | null;
  cajas?: number | null;
  unidadesPorCaja?: number | null;
}): PackingGroup[] {
  if (input.packingGroups && input.packingGroups.length > 0) {
    return normalizePackingGroups(input.packingGroups);
  }
  const cajas = input.cajas;
  const upc = input.unidadesPorCaja;
  if (cajas == null && upc == null) return [];
  return [
    {
      cajas: parseNonNegInt(cajas),
      unidadesPorCaja: parseNonNegInt(upc),
    },
  ];
}

export function summarizePackingGroups(groups: PackingGroup[]): PackingSummary {
  const normalized = normalizePackingGroups(groups);
  const totalCajas = normalized.reduce((s, g) => s + g.cajas, 0);
  const totalEmbalado = normalized.reduce(
    (s, g) => s + g.cajas * g.unidadesPorCaja,
    0
  );
  return { totalCajas, totalEmbalado, groups: normalized };
}

export function packingGroupsToRemitoSlots(groups: PackingGroup[]): {
  cajas1: number;
  unidades1: number;
  cajas2: number;
  unidades2: number;
  cajas3: number;
  unidades3: number;
  extraCajas: Array<{ cajas: number; unidades: number }>;
} {
  const g = normalizePackingGroups(groups);
  const slot = (i: number) => g[i] ?? { cajas: 0, unidadesPorCaja: 0 };
  return {
    cajas1: slot(0).cajas,
    unidades1: slot(0).unidadesPorCaja,
    cajas2: slot(1).cajas,
    unidades2: slot(1).unidadesPorCaja,
    cajas3: slot(2).cajas,
    unidades3: slot(2).unidadesPorCaja,
    extraCajas: g.slice(3).map((x) => ({
      cajas: x.cajas,
      unidades: x.unidadesPorCaja,
    })),
  };
}

export function remitoSlotsToPackingGroups(input: {
  cajas1?: number;
  unidades1?: number;
  cajas2?: number;
  unidades2?: number;
  cajas3?: number;
  unidades3?: number;
  extraCajas?: Array<{ cajas: number; unidades: number }> | null;
}): PackingGroup[] {
  const groups: PackingGroup[] = [
    { cajas: parseNonNegInt(input.cajas1), unidadesPorCaja: parseNonNegInt(input.unidades1) },
    { cajas: parseNonNegInt(input.cajas2), unidadesPorCaja: parseNonNegInt(input.unidades2) },
    { cajas: parseNonNegInt(input.cajas3), unidadesPorCaja: parseNonNegInt(input.unidades3) },
    ...(input.extraCajas ?? []).map((e) => ({
      cajas: parseNonNegInt(e.cajas),
      unidadesPorCaja: parseNonNegInt(e.unidades),
    })),
  ];
  // Conservar al menos 3 slots vacíos en UI; para persistencia se pueden trimmear trailing vacíos
  while (groups.length > 3 && groups[groups.length - 1]!.cajas === 0 && groups[groups.length - 1]!.unidadesPorCaja === 0) {
    groups.pop();
  }
  return groups;
}

export function packingProducedMismatchWarning(
  producedUnits: number | null | undefined,
  groups: PackingGroup[]
): { ok: boolean; calculated: number; message: string | null } {
  const { totalEmbalado } = summarizePackingGroups(groups);
  if (producedUnits == null || !Number.isFinite(producedUnits) || producedUnits <= 0) {
    return { ok: true, calculated: totalEmbalado, message: null };
  }
  if (totalEmbalado === 0) {
    return { ok: true, calculated: 0, message: null };
  }
  if (Number(producedUnits) === totalEmbalado) {
    return { ok: true, calculated: totalEmbalado, message: null };
  }
  return {
    ok: false,
    calculated: totalEmbalado,
    message: `Total producido (${producedUnits}) no coincide con total embalado (${totalEmbalado}). No se corrige automáticamente.`,
  };
}

/** Legacy single-product warning (compat). */
export function packingTotalMismatchWarning(
  totalUnits: number | null | undefined,
  cajas: number | null | undefined,
  unidadesPorCaja: number | null | undefined
): { ok: boolean; calculated: number | null; difference: number | null; message: string | null } {
  const groups =
    cajas == null && unidadesPorCaja == null
      ? []
      : [{ cajas: parseNonNegInt(cajas), unidadesPorCaja: parseNonNegInt(unidadesPorCaja) }];
  const w = packingProducedMismatchWarning(totalUnits, groups);
  const calculated = groups.length ? summarizePackingGroups(groups).totalEmbalado : null;
  if (w.ok) {
    return {
      ok: true,
      calculated,
      difference: calculated != null && totalUnits != null ? Number(totalUnits) - calculated : null,
      message: null,
    };
  }
  return {
    ok: false,
    calculated,
    difference:
      calculated != null && totalUnits != null
        ? Math.round((Number(totalUnits) - calculated) * 1000) / 1000
        : null,
    message: w.message,
  };
}

export function computeCajasProduct(
  cajas: number | null | undefined,
  unidadesPorCaja: number | null | undefined
): number | null {
  if (
    cajas == null ||
    unidadesPorCaja == null ||
    !Number.isFinite(cajas) ||
    !Number.isFinite(unidadesPorCaja)
  ) {
    return null;
  }
  return Math.floor(cajas) * Math.floor(unidadesPorCaja);
}

export function ensureMinPackingSlots(
  groups: PackingGroup[],
  min = 3
): PackingGroup[] {
  const next = [...normalizePackingGroups(groups)];
  while (next.length < min) next.push({ cajas: 0, unidadesPorCaja: 0 });
  return next;
}
