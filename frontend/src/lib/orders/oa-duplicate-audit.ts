/**
 * Lógica de clasificación de OA duplicadas — extraída para ser testeable y
 * reusable (ver scripts/_oa_duplicate_audit_readonly.mjs, que corrió esta
 * misma lógica contra Production). Puro: sin acceso a Neon ni a servicios.
 *
 * Criterio de duplicado: mismo lote + mismo producto (normalizados).
 * Clasificación conservadora: ante cualquier ambigüedad o relación activa
 * en riesgo, CONFLICTO — nunca se decide un ELIMINAR_SEGURO dudoso.
 */

export type OaDuplicateCandidate = {
  orderNumber: string;
  status: string;
  client: string;
  code: string;
  lot: string;
  product: string;
  linkedWorkItemId: string | null;
  completionPercentage: number;
  reviewedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
  header?: {
    vto?: string | null;
    analisis?: string | null;
    aprobo?: string | null;
    fechaEmision?: string | null;
  };
  envasado?: {
    fechaInicio?: string | null;
    fechaTerminacion?: string | null;
    operarios?: string | null;
    operariosList?: unknown[];
  };
  rendimientos?: {
    produccionTeoricaUnidades?: number | null;
    cantidadUnidades?: number | null;
    unidadesAceptadas?: number | null;
  };
  pedidoOps: string[];
  activeWorkItemCount: number;
  activeDeliveryCount: number;
  hasQualityDecision: boolean;
};

export type OaDuplicateClassification = "ELIMINAR_SEGURO" | "CONFLICTO";

export type OaDuplicateResult = {
  classification: OaDuplicateClassification;
  reason: string;
};

const COMPLETE_TIER_STATUSES = new Set(["COMPLETA", "COMPLETA_CON_PENDIENTES"]);

/** Normaliza para comparar lote/producto — nunca modifica el dato original. */
export function normalizeForDuplicateMatch(value: string | null | undefined): string {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
}

function tierOf(status: string): "COMPLETA" | "INCOMPLETA" {
  return COMPLETE_TIER_STATUSES.has(status) ? "COMPLETA" : "INCOMPLETA";
}

/** Puntaje de completitud de datos reales — no reemplaza el estado, lo complementa. */
export function fieldCompletenessScore(order: OaDuplicateCandidate): number {
  const present = (v: unknown) => v !== null && v !== undefined && String(v).trim() !== "";
  let score = 0;
  if (present(order.client)) score += 1;
  if (present(order.code)) score += 1;
  if (present(order.header?.vto)) score += 1;
  if (present(order.header?.analisis)) score += 1;
  if (present(order.header?.aprobo)) score += 1;
  if (present(order.header?.fechaEmision)) score += 1;
  if (present(order.envasado?.fechaInicio)) score += 1;
  if (present(order.envasado?.fechaTerminacion)) score += 1;
  if (present(order.envasado?.operarios) || (order.envasado?.operariosList?.length ?? 0) > 0) score += 1;
  if (order.rendimientos?.produccionTeoricaUnidades != null) score += 1;
  if (order.rendimientos?.cantidadUnidades != null) score += 1;
  if (order.rendimientos?.unidadesAceptadas != null) score += 1;
  if (order.linkedWorkItemId) score += 2;
  if (order.completionPercentage) score += order.completionPercentage / 100;
  if (order.reviewedAt) score += 1;
  if (order.completedAt) score += 1;
  return Math.round(score * 100) / 100;
}

/**
 * Agrupa por lote+producto normalizados. Requiere AMBOS no vacíos: dos OA
 * con lote vacío no "comparten lote", comparten la ausencia de dato — bug
 * real encontrado y corregido en la primera corrida del audit script.
 */
export function groupOaByLotProduct<T extends { lot: string; product: string }>(
  orders: T[]
): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const o of orders) {
    const lotNorm = normalizeForDuplicateMatch(o.lot);
    const productNorm = normalizeForDuplicateMatch(o.product);
    if (!lotNorm || !productNorm) continue;
    const key = `${lotNorm}::${productNorm}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(o);
  }
  return groups;
}

/**
 * Agrupa por LOTE solamente (sin exigir coincidencia de producto) — criterio
 * más amplio, pedido explícitamente para una segunda pasada de auditoría
 * después de que la primera (lote+producto) resultara demasiado estricta
 * (nombres de producto con variaciones de texto entre dos altas de la misma
 * producción). classifyOaDuplicate() sigue aplicando cliente/código/pedido
 * como controles de seguridad antes de proponer ELIMINAR_SEGURO, así que un
 * mismo lote con cliente/código distinto igual cae en CONFLICTO.
 */
export function groupOaByLot<T extends { lot: string }>(orders: T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const o of orders) {
    const lotNorm = normalizeForDuplicateMatch(o.lot);
    if (!lotNorm) continue;
    if (!groups.has(lotNorm)) groups.set(lotNorm, []);
    groups.get(lotNorm)!.push(o);
  }
  return groups;
}

/**
 * Elige el "keeper" candidato dentro de un grupo duplicado: mayor tier
 * (COMPLETA > INCOMPLETA), luego mayor fieldScore, luego más reciente.
 */
export function pickKeeper(candidates: OaDuplicateCandidate[]): OaDuplicateCandidate {
  const sorted = [...candidates].sort((a, b) => {
    const ta = tierOf(a.status);
    const tb = tierOf(b.status);
    if (ta !== tb) return ta === "COMPLETA" ? -1 : 1;
    const sa = fieldCompletenessScore(a);
    const sb = fieldCompletenessScore(b);
    if (sa !== sb) return sb - sa;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
  return sorted[0]!;
}

/**
 * Clasifica un candidato frente al keeper elegido para su grupo. Nunca
 * borra dos OA completas (Caso B); solo marca ELIMINAR_SEGURO cuando la
 * diferencia es inequívoca y el candidato no tiene relaciones activas que
 * el keeper no tenga (Caso A y Caso C con diferencia clara).
 */
export function classifyOaDuplicate(
  keeper: OaDuplicateCandidate,
  candidate: OaDuplicateCandidate
): OaDuplicateResult {
  const clientMismatch =
    normalizeForDuplicateMatch(keeper.client) &&
    normalizeForDuplicateMatch(candidate.client) &&
    normalizeForDuplicateMatch(keeper.client) !== normalizeForDuplicateMatch(candidate.client);
  const codeMismatch =
    normalizeForDuplicateMatch(keeper.code) &&
    normalizeForDuplicateMatch(candidate.code) &&
    normalizeForDuplicateMatch(keeper.code) !== normalizeForDuplicateMatch(candidate.code);
  const keeperOps = keeper.pedidoOps.map(normalizeForDuplicateMatch);
  const candOps = candidate.pedidoOps.map(normalizeForDuplicateMatch);
  const opMismatch = keeperOps.length > 0 && candOps.length > 0 && !candOps.some((o) => keeperOps.includes(o));

  if (clientMismatch || codeMismatch || opMismatch) {
    return {
      classification: "CONFLICTO",
      reason:
        "Mismo lote+producto pero difieren en un control de seguridad (cliente/código/pedido) — no se asume duplicado real.",
    };
  }

  const candHasExtraRelations =
    (candidate.activeWorkItemCount > 0 && keeper.activeWorkItemCount === 0) ||
    (candidate.activeDeliveryCount > 0 && keeper.activeDeliveryCount === 0) ||
    (candidate.hasQualityDecision && !keeper.hasQualityDecision);
  if (candHasExtraRelations) {
    return {
      classification: "CONFLICTO",
      reason:
        "La OA candidata tiene relaciones activas (work item/entrega/decisión de Calidad) que la OA a conservar no tiene.",
    };
  }

  const keeperTier = tierOf(keeper.status);
  const candTier = tierOf(candidate.status);

  if (keeperTier === "COMPLETA" && candTier === "COMPLETA") {
    return {
      classification: "CONFLICTO",
      reason: "Caso B: ambas OA están COMPLETA/COMPLETA_CON_PENDIENTES — no se borra ninguna automáticamente.",
    };
  }
  if (keeperTier === "COMPLETA" && candTier === "INCOMPLETA") {
    return {
      classification: "ELIMINAR_SEGURO",
      reason: `Caso A: se conserva OA ${keeper.orderNumber} (COMPLETA) y se elimina OA ${candidate.orderNumber} (INCOMPLETA).`,
    };
  }

  const keeperScore = fieldCompletenessScore(keeper);
  const candScore = fieldCompletenessScore(candidate);
  if (keeperScore - candScore >= 2 && candScore <= 1) {
    return {
      classification: "ELIMINAR_SEGURO",
      reason: `Caso C: ambas incompletas, pero OA ${candidate.orderNumber} está prácticamente vacía (score ${candScore}) frente a OA ${keeper.orderNumber} (score ${keeperScore}).`,
    };
  }
  return {
    classification: "CONFLICTO",
    reason: `Caso C: ambas incompletas y la diferencia de completitud (${keeperScore} vs ${candScore}) no es inequívoca.`,
  };
}
