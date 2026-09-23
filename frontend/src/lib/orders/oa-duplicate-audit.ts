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

export function tierOf(status: string): "COMPLETA" | "INCOMPLETA" {
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
/** Cliente/código/pedido difieren entre dos OA que por lo demás matchean lote+producto — nunca se asume duplicado real ante esto. */
export function hasSafetyMismatch(a: OaDuplicateCandidate, b: OaDuplicateCandidate): boolean {
  const clientMismatch =
    normalizeForDuplicateMatch(a.client) &&
    normalizeForDuplicateMatch(b.client) &&
    normalizeForDuplicateMatch(a.client) !== normalizeForDuplicateMatch(b.client);
  const codeMismatch =
    normalizeForDuplicateMatch(a.code) &&
    normalizeForDuplicateMatch(b.code) &&
    normalizeForDuplicateMatch(a.code) !== normalizeForDuplicateMatch(b.code);
  const aOps = a.pedidoOps.map(normalizeForDuplicateMatch);
  const bOps = b.pedidoOps.map(normalizeForDuplicateMatch);
  const opMismatch = aOps.length > 0 && bOps.length > 0 && !bOps.some((o) => aOps.includes(o));
  return clientMismatch || codeMismatch || opMismatch;
}

/** `candidate` tiene una relación activa (work item/entrega/Calidad) que `keeper` no tiene. */
export function hasExtraActiveRelations(
  keeper: OaDuplicateCandidate,
  candidate: OaDuplicateCandidate
): boolean {
  return (
    (candidate.activeWorkItemCount > 0 && keeper.activeWorkItemCount === 0) ||
    (candidate.activeDeliveryCount > 0 && keeper.activeDeliveryCount === 0) ||
    (candidate.hasQualityDecision && !keeper.hasQualityDecision)
  );
}

export function classifyOaDuplicate(
  keeper: OaDuplicateCandidate,
  candidate: OaDuplicateCandidate
): OaDuplicateResult {
  if (hasSafetyMismatch(keeper, candidate)) {
    return {
      classification: "CONFLICTO",
      reason:
        "Mismo lote+producto pero difieren en un control de seguridad (cliente/código/pedido) — no se asume duplicado real.",
    };
  }

  if (hasExtraActiveRelations(keeper, candidate)) {
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

export type OaDuplicateReportEstado = "A" | "B" | "C" | "D";

export type OaDuplicateReportRow = {
  /** N° de pedido/OP asociado (join de pedidoOps) — "SIN_PEDIDO_OP" si ninguna OA del grupo tiene uno. */
  pedido: string;
  producto: string;
  lote: string;
  ordenesEncontradas: string[];
  estado: OaDuplicateReportEstado;
  detalle: string[];
};

/**
 * Reporte de duplicados históricos agrupados por Pedido+Producto+Lote
 * (sección 10 del pedido "corregir duplicación OA/OE") — SOLO LECTURA, nunca
 * borra ni modifica nada. Reutiliza el agrupamiento/keeper/clasificación ya
 * testeados de este mismo módulo; agrega la etiqueta A/B/C/D pedida:
 *
 *   A) una OA completa + una (o más) incompleta(s) en el grupo.
 *   B) todas las OA del grupo están incompletas.
 *   C) todas las OA del grupo están completas.
 *   D) datos ambiguos — alguna OA del grupo difiere en un control de
 *      seguridad (cliente/código/pedido) frente a la elegida como keeper, o
 *      tiene relaciones activas (work item/entrega/Calidad) que el keeper no
 *      tiene. D tiene prioridad sobre A/B/C: ante cualquier ambigüedad, se
 *      reporta como revisión manual antes que como "completo/incompleto".
 *
 * `pedido` usa `pedidoOps` (N° de Pedido/OP ya presente en OaDuplicateCandidate)
 * porque este tipo es el que ya alimenta scripts/_oa_duplicate_audit_readonly.mjs
 * contra Neon — no se le agregó pedidoId/productIdentityKey/loteIdentityKey
 * (0036) para no expandir el alcance de este audit ya existente; el
 * agrupamiento lote+producto normalizado sigue siendo el mismo criterio
 * (nunca fuzzy) que ya corrió contra Production.
 */
export function buildOaDuplicateReport(orders: OaDuplicateCandidate[]): OaDuplicateReportRow[] {
  const groups = groupOaByLotProduct(orders);
  const rows: OaDuplicateReportRow[] = [];

  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const keeper = pickKeeper(group);
    const others = group.filter((o) => o !== keeper);

    const detalle = others.map((cand) => classifyOaDuplicate(keeper, cand).reason);
    const ambiguous = others.some(
      (cand) => hasSafetyMismatch(keeper, cand) || hasExtraActiveRelations(keeper, cand)
    );
    const tiers = group.map((o) => tierOf(o.status));
    const completeCount = tiers.filter((t) => t === "COMPLETA").length;

    let estado: OaDuplicateReportEstado;
    if (ambiguous) {
      estado = "D";
    } else if (completeCount === group.length) {
      estado = "C";
    } else if (completeCount === 0) {
      estado = "B";
    } else {
      estado = "A";
    }

    const pedidoOps = [...new Set(group.flatMap((o) => o.pedidoOps))];
    rows.push({
      pedido: pedidoOps.length > 0 ? pedidoOps.join(" / ") : "SIN_PEDIDO_OP",
      producto: group[0]!.product,
      lote: group[0]!.lot,
      ordenesEncontradas: group.map((o) => o.orderNumber),
      estado,
      detalle,
    });
  }

  return rows;
}
