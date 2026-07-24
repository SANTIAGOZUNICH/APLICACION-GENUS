/**
 * Resuelve datos de remito desde QualityItem (+ WorkItem opcional).
 */
import { normalizeClientId } from "@/lib/remitos/grouping";
import type { RemitoApprovalInput } from "@/lib/remitos/types";
import type { QualityItem } from "@/features/os/operational/types";
import type { WorkItem } from "@/types/operational/work-item";

function parseQty(raw: string | null | undefined): number {
  const s = String(raw ?? "").replace(",", ".");
  const m = s.match(/-?\d+(\.\d+)?/);
  return m ? Math.max(0, Number(m[0])) : 0;
}

/** Ítems de calidad empaquetados (salida/envasado), no granel. */
export function isPackagingQualityItem(item: QualityItem): boolean {
  return item.kind === "salida";
}

export function resolveRemitoInputFromQuality(
  item: QualityItem,
  workItems: WorkItem[] = []
): RemitoApprovalInput | null {
  if (!isPackagingQualityItem(item)) return null;

  const workItemId =
    item.relatedWorkItemId?.trim() ||
    (item.id.startsWith("qc:") ? item.id.slice(3) : item.id);
  if (!workItemId) return null;

  const wi =
    workItems.find((w) => w.id === workItemId) ??
    workItems.find((w) => w.id === item.relatedWorkItemId) ??
    null;

  const client =
    item.client?.trim() ||
    wi?.client?.trim() ||
    "Sin cliente";
  const deliveryDate =
    item.deliveryDate?.trim() ||
    wi?.deliveryDate?.trim() ||
    wi?.plannedDate?.trim() ||
    new Date().toISOString().slice(0, 10);
  const product = item.product?.trim() || wi?.product?.trim() || "Producto";
  const lote =
    item.lote?.trim() ||
    wi?.packagingLote?.trim() ||
    wi?.loteRef?.trim() ||
    "";
  const vto = wi?.packagingVto?.trim() || "";
  const totalUnits =
    wi?.packagingTotalUnits ??
    (parseQty(item.quantity) ||
      parseQty(wi?.finishedQty) ||
      parseQty(wi?.quantity) ||
      1);

  return {
    workItemId,
    clientId: client,
    clientDisplay: client,
    deliveryDate,
    product,
    lote,
    vto,
    totalUnits,
    cajas1: wi?.packagingCajas ?? null,
    unidades1: wi?.packagingUnidadesPorCaja ?? null,
    unitsPerCaja1: wi?.packagingUnidadesPorCaja ?? null,
  };
}

/** Misma clave de agrupación cliente+fecha que RemitoService. */
export function qualityRemitoGroupKey(item: QualityItem, workItems: WorkItem[] = []): string | null {
  const input = resolveRemitoInputFromQuality(item, workItems);
  if (!input) return null;
  return `${normalizeClientId(input.clientId)}|${input.deliveryDate}`;
}

/** Todos los aprobados packaging del mismo cliente+fecha. */
export function collectSameClientDateApprovedPackaging(
  seed: QualityItem,
  allApproved: QualityItem[],
  workItems: WorkItem[] = []
): QualityItem[] {
  const key = qualityRemitoGroupKey(seed, workItems);
  if (!key) return [];
  return allApproved.filter((item) => {
    if (item.status !== "aprobado") return false;
    if (!isPackagingQualityItem(item)) return false;
    return qualityRemitoGroupKey(item, workItems) === key;
  });
}
