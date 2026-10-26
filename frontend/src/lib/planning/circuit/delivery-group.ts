/**
 * Grupo de entrega — reglas PURAS. Varias apariciones del MISMO trabajo operativo (las «programaciones» de una misma OE/OA en
 * distintos días) se entregan juntas: entregar una entrega las demás.
 *
 * Dos trabajos son el MISMO trabajo operativo solo si TODO esto coincide (nunca por nombre de producto):
 *  - mismo SECTOR (Elaboración, Envasado y Codificado son etapas distintas: no se arrastran entre sí);
 *  - misma ORDEN (OE/OA, `orderId`) o misma programación raíz (`scheduleRootId`);
 *  - mismo PEDIDO (`productionPedidoId`; si uno lo tiene y el otro no, es ambiguo y no se agrupan);
 * y está vigente (no borrado ni cancelado). Dos pedidos distintos de un mismo cliente y producto jamás se mezclan.
 */
export interface DeliveryGroupCandidate {
  id: string;
  sector: string;
  orderId?: string | null;
  scheduleRootId?: string | null;
  productionPedidoId?: string | null;
  operationalStatus?: string | null;
  status?: string | null;
  deletedAt?: Date | string | null;
}

const norm = (v: string | null | undefined) => (v ? String(v) : null);

export function isLiveWork(w: Pick<DeliveryGroupCandidate, "deletedAt" | "operationalStatus" | "status">): boolean {
  return !w.deletedAt && w.operationalStatus !== "cancelado" && w.status !== "CANCELADO";
}

/** ¿`b` es otra aparición del mismo trabajo operativo que `a`? */
export function isSameOperationalJob(a: DeliveryGroupCandidate, b: DeliveryGroupCandidate): boolean {
  if (a.id === b.id) return true;
  if (a.sector !== b.sector) return false;
  if (norm(a.productionPedidoId) !== norm(b.productionPedidoId)) return false;
  const sameOrder = Boolean(norm(a.orderId)) && norm(a.orderId) === norm(b.orderId);
  const rootA = norm(a.scheduleRootId) ?? a.id;
  const rootB = norm(b.scheduleRootId) ?? b.id;
  const sameSchedule = (Boolean(norm(a.scheduleRootId)) || Boolean(norm(b.scheduleRootId))) && rootA === rootB;
  return sameOrder || sameSchedule;
}

/** Las otras apariciones vigentes del mismo trabajo (sin incluir `target`), en orden estable (por id). */
export function groupSiblings(target: DeliveryGroupCandidate, all: readonly DeliveryGroupCandidate[]): DeliveryGroupCandidate[] {
  return all.filter((w) => w.id !== target.id && isLiveWork(w) && isSameOperationalJob(target, w)).sort((x, y) => x.id.localeCompare(y.id));
}

/**
 * Marca (en las observaciones de la entrega) de una entrega SINCRONIZADA: `[sync-from:<id del trabajo que se entregó>]`.
 * Las entregas sincronizadas no llevan cantidad física propia (no hay una segunda entrega): solo cierran la aparición.
 */
export const syncObsMark = (primaryId: string) => `[sync-from:${primaryId}]`;
export function primaryOfSyncObs(text: string | null | undefined): string | null {
  const m = /\[sync-from:([0-9a-f-]{36})\]/i.exec(text ?? "");
  return m ? m[1]! : null;
}
