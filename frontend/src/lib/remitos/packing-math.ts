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
 * ¿Coincide lo embalado con lo PRODUCIDO?
 *
 * Regla definitiva: las muestras son metadata interna únicamente y NO
 * participan de esta comparación. La cantidad que debe quedar en cajas es
 * el bruto producido (finishedQty) — no se le resta nada. Si hay muestras,
 * la diferencia entre producido y embalado NO se explica/absorbe
 * automáticamente por ellas: queda como diferencia real que requiere
 * observación (ver computePackagingClose y assertPackagingCloseOrExplained).
 *
 * `sampleUnits` se sigue aceptando (y se pasa a computePackagingClose, que
 * lo conserva como metadata en el resultado) únicamente por compatibilidad
 * de firma con los callers existentes — ya no afecta `ok`/`message` acá.
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
    message: `Total producido (${close.finishedUnits}) no coincide con total embalado (${packed}). No se corrige automáticamente.`,
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
 * Cierre físico de acondicionamiento (Envasado/Codificado) — 0024, regla
 * definitiva revisada (ver auditoría de integridad operativa, "muestras
 * como metadata"):
 *
 *   packedUnits = SUM(cajas × unidadesPorCaja)
 *   difference  = finishedUnits - packedUnits      (bruto, SIN restar muestras)
 *   isBalanced  = difference === 0
 *
 * MUESTRAS ES SOLO METADATA INTERNA. `sampleUnits` se recibe, se valida y
 * se conserva en el resultado (`sampleUnits`/`muestras`) para que quede
 * registrado cuántas muestras hubo, pero NO suma, NO resta, y NO participa
 * de `difference`/`isBalanced`/`deliverableUnits`/`packedUnits`. Si un
 * trabajo produjo 2883, tomó 3 muestras y embaló 2880, la diferencia es 3
 * — las muestras NO explican ni compensan ese faltante; si es una
 * excepción real hay que documentarla con una observación (ver
 * assertPackagingCloseOrExplained), no restarla silenciosamente.
 */
export type PackagingCloseInput = {
  /** Cantidad final acondicionada (packagingTotalUnits / finishedQty). */
  finishedQty: number | null | undefined;
  /** Muestras — SOLO metadata interna, no participa de ningún cálculo. null = no informado. */
  sampleUnits: number | null | undefined;
  groups: PackingGroup[];
};

export type PackagingCloseSummary = {
  totalCajas: number;

  /** Bruto producido/acondicionado (0 si no informado). */
  finishedUnits: number;
  /** Muestras — metadata interna únicamente, no afecta ningún otro campo de este resultado. */
  sampleUnits: number;
  /**
   * @deprecated La semántica "entregable = producido - muestras" quedó
   * cancelada. Se conserva el campo por compatibilidad histórica (algunos
   * consumidores todavía lo leen), pero ahora vale lo mismo que
   * `packedUnits` — NUNCA se recalcula restando muestras. Preferí
   * `packedUnits` directamente en código nuevo.
   */
  deliverableUnits: number;
  /** Unidades efectivamente dentro de cajas = SUM(cajas × unidadesPorCaja). Fuente real para remito/entregas. */
  packedUnits: number;
  /** finishedUnits - packedUnits (bruto, sin restar muestras). 0 = correcto. */
  difference: number;
  /** true solo si finishedQty es válido y difference === 0. */
  isBalanced: boolean;

  // ── Alias legacy (compat con callers/tests existentes) ──
  /** = packedUnits. */
  enCajas: number;
  /** = sampleUnits (metadata). */
  muestras: number;
  /** = packedUnits + sampleUnits. Informativo únicamente — no se usa para decidir balance. */
  totalAcondicionado: number;
  /** = difference. */
  diferencia: number;
  /** = isBalanced. */
  isValid: boolean;
  /** false si finishedQty falta — no se puede validar todavía. */
  canValidate: boolean;
};

/**
 * Cantidad embalada de un work item ya cerrado (persistida) — fuente única
 * reutilizada por remito (from-quality.ts), su editor de composición
 * (compose-from-quality.ts) y "marcar como entregado" (entregados-view.tsx).
 *
 * Regla definitiva: la fuente real es SIEMPRE lo físicamente embalado
 * (packedUnits), nunca un cálculo que reste muestras. `deliverableUnits`
 * (columna histórica en work_items) ya se persiste como packedUnits desde
 * que se cierra el packaging (ver computePackagingClose), así que seguir
 * leyéndola acá es correcto — el nombre de la columna quedó desactualizado
 * pero el valor que contiene es el correcto. `packagingTotalUnits` (bruto)
 * es compat histórica solo para trabajos sin cierre físico registrado.
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
 * Cantidad embalada de un work item ya cerrado, calculada FRESCA desde
 * packingGroups (la distribución real de cajas persistida) en vez de leer
 * la columna snapshot `deliverableUnits`. Preferí esta función sobre
 * `resolveWorkItemDeliverableUnits` en código nuevo — es la lectura más
 * literal de "packedUnits = SUM(boxCount × unitsPerBox)" y no depende de
 * que el cierre haya escrito correctamente la columna snapshot.
 *
 * Si no hay packingGroups reales, cae al mismo fallback seguro que ya
 * existía (`resolveWorkItemDeliverableUnits`: deliverableUnits persistido
 * → packagingTotalUnits bruto) — nunca se inventa un dato para un trabajo
 * histórico sin distribución de cajas registrada.
 */
export function resolveWorkItemPackedUnits(
  wi:
    | {
        packingGroups?: PackingGroup[] | null;
        deliverableUnits?: number | null;
        packagingTotalUnits?: number | null;
      }
    | null
    | undefined
): number | null {
  if (wi?.packingGroups && wi.packingGroups.length > 0) {
    return summarizePackingGroups(wi.packingGroups).totalEmbalado;
  }
  return resolveWorkItemDeliverableUnits(wi);
}

/**
 * Cierre de packaging al completar un trabajo DIRECTO (sin pasar por
 * Codificado — ej. "Completar trabajo" de Envasado) — mismo criterio de
 * computePackagingClose que handoffToCodificadoDurable/
 * deliverFromCodificadoDurable, para que work_item_deliveries/remito no
 * caigan al bruto (packagingTotalUnits) en este camino.
 *
 * Devuelve `packedUnits` (lo físicamente embalado) — nunca
 * finishedQty - sampleUnits. Solo se aplica si el trabajo YA tiene
 * packingGroups reales (cargados vía PackagingQuantitiesBlock antes de
 * completar) — si no hay packingGroups (ej. Elaboración, o un producto sin
 * distribución de cajas), devuelve `null`: nunca se infiere un cierre que
 * no existe.
 */
export function resolveDirectCompletePackedUnits(input: {
  packingGroups: PackingGroup[] | null | undefined;
  sampleUnits: number | null | undefined;
  finishedQty: number | null;
}): number | null {
  const hasPacking = Array.isArray(input.packingGroups) && input.packingGroups.length > 0;
  if (!hasPacking) return null;
  const close = computePackagingClose({
    finishedQty: input.finishedQty,
    sampleUnits: input.sampleUnits,
    groups: input.packingGroups!,
  });
  return close.canValidate ? close.packedUnits : null;
}

export function computePackagingClose(input: PackagingCloseInput): PackagingCloseSummary {
  const { totalCajas, totalEmbalado: packedUnits } = summarizePackingGroups(input.groups);
  const sampleUnits =
    input.sampleUnits != null && Number.isFinite(input.sampleUnits)
      ? Math.max(0, Math.floor(input.sampleUnits))
      : 0;
  const canValidate = input.finishedQty != null && Number.isFinite(input.finishedQty);
  const finishedUnits = canValidate ? Number(input.finishedQty) : 0;
  // Regla definitiva: muestras es metadata, NO participa del balance.
  const difference = canValidate ? finishedUnits - packedUnits : 0;
  const isBalanced = canValidate && difference === 0;
  const totalAcondicionado = packedUnits + sampleUnits;
  return {
    totalCajas,
    finishedUnits,
    sampleUnits,
    // deprecated: ya no se resta muestras — vale lo mismo que packedUnits.
    deliverableUnits: packedUnits,
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
