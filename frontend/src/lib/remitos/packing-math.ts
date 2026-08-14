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

/**
 * ¿Coincide lo embalado con lo que DEBE embalarse?
 *
 * La cantidad que debe quedar en cajas es la ENTREGABLE (neto comercial),
 * es decir producido − muestras — NO el bruto producido. Las muestras se
 * producen pero no se embalan para el cliente (ver computePackagingClose).
 *
 * `sampleUnits` es opcional (default 0) para conservar la semántica legacy
 * de los callers que no manejan muestras (remito). Delega en
 * `computePackagingClose` para que exista UNA sola regla de balance.
 */
export function packingProducedMismatchWarning(
  producedUnits: number | null | undefined,
  groups: PackingGroup[],
  sampleUnits: number | null | undefined = 0
): { ok: boolean; calculated: number; message: string | null } {
  const close = computePackagingClose({
    finishedQty: producedUnits,
    sampleUnits,
    groups,
  });
  const packed = close.packedUnits;
  if (producedUnits == null || !Number.isFinite(producedUnits) || Number(producedUnits) <= 0) {
    return { ok: true, calculated: packed, message: null };
  }
  if (packed === 0) {
    return { ok: true, calculated: 0, message: null };
  }
  if (close.isBalanced) {
    return { ok: true, calculated: packed, message: null };
  }
  return {
    ok: false,
    calculated: packed,
    message: `Unidades a embalar (${close.deliverableUnits}) no coinciden con total embalado (${packed}). No se corrige automáticamente.`,
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

/**
 * Cierre físico de acondicionamiento (Envasado/Codificado) — 0024.
 *
 * Regla encontrada en el sistema existente: NO hay concepto de "unidades
 * sueltas" en ningún lugar del código (buscado explícitamente antes de
 * implementar esto). La ecuación real, confirmada por
 * packingProducedMismatchWarning/packingGroups ya existentes, es:
 *
 *   enCajas (SUM cajas × unidadesPorCaja)  +  muestras  =  cantidad final
 *
 * "Entregable" = enCajas exclusivamente (las muestras nunca se consideran
 * unidades entregadas — ver PARTE A del pedido). No se inventa una tercera
 * categoría "sueltas": si algún día existe, debe agregarse como concepto
 * nuevo y explícito, no inferirse acá.
 */
export type PackagingCloseInput = {
  /** Cantidad final acondicionada (packagingTotalUnits / finishedQty). */
  finishedQty: number | null | undefined;
  /** Unidades producidas pero no entregables comercialmente. null = no informado. */
  sampleUnits: number | null | undefined;
  groups: PackingGroup[];
};

export type PackagingCloseSummary = {
  totalCajas: number;

  // ── Semántica canónica (fix muestras vs total embalado) ──
  /** Bruto producido/acondicionado (0 si no informado). */
  finishedUnits: number;
  /** Muestras: producidas pero NO entregables al cliente (>= 0). */
  sampleUnits: number;
  /** Neto comercial = finishedUnits - sampleUnits. */
  deliverableUnits: number;
  /** Unidades efectivamente dentro de cajas = SUM(cajas × unidadesPorCaja). */
  packedUnits: number;
  /** deliverableUnits - packedUnits. 0 = correcto. */
  difference: number;
  /** true solo si finishedQty es válido y difference === 0. */
  isBalanced: boolean;

  // ── Alias legacy (compat con callers/tests existentes) ──
  /** = packedUnits. */
  enCajas: number;
  /** = sampleUnits. */
  muestras: number;
  /** = packedUnits + sampleUnits. */
  totalAcondicionado: number;
  /** = difference. */
  diferencia: number;
  /** = isBalanced. */
  isValid: boolean;
  /** false si finishedQty falta — no se puede validar todavía. */
  canValidate: boolean;
};

/**
 * Cantidad entregable de un work item ya cerrado (persistida) — fuente
 * única reutilizada por remito (from-quality.ts), su editor de composición
 * (compose-from-quality.ts) y "marcar como entregado" (entregados-view.tsx).
 * deliverableUnits (excluye muestras, PARTE A) es la fuente de verdad
 * cuando existe cierre físico; packagingTotalUnits (incluye muestras) es
 * compat histórica para trabajos sin cierre. No confundir con
 * computePackagingClose de abajo: esa calcula el cierre EN EL MOMENTO de
 * cerrar (Envasado/Codificado); esta lee el valor ya persistido más tarde
 * (remito/Entregados) — nunca vuelve a restar muestras (evita doble
 * descuento: si deliverableUnits ya es 1000, se usa 1000, no 1000-2).
 */
export function resolveWorkItemDeliverableUnits(
  wi:
    | { deliverableUnits?: number | null; packagingTotalUnits?: number | null }
    | null
    | undefined
): number | null {
  if (wi?.deliverableUnits != null && Number.isFinite(wi.deliverableUnits)) {
    return Math.max(0, Number(wi.deliverableUnits));
  }
  if (wi?.packagingTotalUnits != null && Number.isFinite(wi.packagingTotalUnits)) {
    return Math.max(0, Number(wi.packagingTotalUnits));
  }
  return null;
}

/**
 * ÚNICA fuente de verdad del cierre de acondicionamiento. Envasado Masivo,
 * Premium y Codificado deben usar EXACTAMENTE esta regla:
 *
 *   deliverableUnits = finishedUnits - sampleUnits
 *   packedUnits      = SUM(cajas × unidadesPorCaja)
 *   difference       = deliverableUnits - packedUnits      (NO finished - packed)
 *   isBalanced       = difference === 0
 *
 * `finishedQty` es SIEMPRE el bruto acondicionado. La resta de muestras se
 * hace acá una sola vez; nunca se debe volver a restar muestras a un valor
 * que ya es neto (evita el doble descuento: 1002 − 2 = 1000, no 998).
 */
export function computePackagingClose(input: PackagingCloseInput): PackagingCloseSummary {
  const { totalCajas, totalEmbalado: packedUnits } = summarizePackingGroups(input.groups);
  const sampleUnits =
    input.sampleUnits != null && Number.isFinite(input.sampleUnits)
      ? Math.max(0, Math.floor(input.sampleUnits))
      : 0;
  const canValidate = input.finishedQty != null && Number.isFinite(input.finishedQty);
  const finishedUnits = canValidate ? Number(input.finishedQty) : 0;
  const deliverableUnits = canValidate ? finishedUnits - sampleUnits : 0;
  const difference = canValidate ? deliverableUnits - packedUnits : 0;
  const isBalanced = canValidate && difference === 0;
  const totalAcondicionado = packedUnits + sampleUnits;
  return {
    totalCajas,
    finishedUnits,
    sampleUnits,
    deliverableUnits,
    packedUnits,
    difference,
    isBalanced,
    // Alias legacy
    enCajas: packedUnits,
    muestras: sampleUnits,
    totalAcondicionado,
    diferencia: difference,
    isValid: isBalanced,
    canValidate,
  };
}
