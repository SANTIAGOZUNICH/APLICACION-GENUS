/**
 * Resuelve datos de remito desde QualityItem (+ WorkItem opcional).
 */
import { normalizeClientId } from "@/lib/remitos/grouping";
import {
  packingGroupsFromLegacy,
  packingGroupsToRemitoSlots,
} from "@/lib/remitos/packing-math";
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

export type RemitoQualityGaps = {
  missingClient: boolean;
  missingDeliveryDate: boolean;
  missingLote: boolean;
  missingVto: boolean;
  missingCajas: boolean;
  missingUnidades: boolean;
  labels: string[];
};

function resolveWorkItem(item: QualityItem, workItems: WorkItem[]): WorkItem | null {
  const workItemId =
    item.relatedWorkItemId?.trim() ||
    (item.id.startsWith("qc:") ? item.id.slice(3) : item.id);
  return (
    workItems.find((w) => w.id === workItemId) ??
    workItems.find((w) => w.id === item.relatedWorkItemId) ??
    null
  );
}

function workPackingSlots(wi: WorkItem | null) {
  if (!wi) {
    return {
      cajas1: null as number | null,
      unidades1: null as number | null,
      cajas2: null as number | null,
      unidades2: null as number | null,
      cajas3: null as number | null,
      unidades3: null as number | null,
      extraCajas: [] as Array<{ cajas: number; unidades: number }>,
    };
  }
  const groups = packingGroupsFromLegacy({
    packingGroups: wi.packingGroups,
    cajas: wi.packagingCajas,
    unidadesPorCaja: wi.packagingUnidadesPorCaja,
  });
  if (!groups.length) {
    return {
      cajas1: wi.packagingCajas ?? null,
      unidades1: wi.packagingUnidadesPorCaja ?? null,
      cajas2: null,
      unidades2: null,
      cajas3: null,
      unidades3: null,
      extraCajas: [],
    };
  }
  return packingGroupsToRemitoSlots(groups);
}

/** Campos reales faltantes (sin defaults silenciosos). */
export function remitoGapsFromQuality(
  item: QualityItem,
  workItems: WorkItem[] = []
): RemitoQualityGaps {
  const wi = resolveWorkItem(item, workItems);
  const client = item.client?.trim() || wi?.client?.trim() || "";
  const deliveryDate =
    item.deliveryDate?.trim() ||
    wi?.deliveryDate?.trim() ||
    wi?.plannedDate?.trim() ||
    "";
  const lote =
    wi?.packagingLote?.trim() ||
    item.lote?.trim() ||
    wi?.loteRef?.trim() ||
    "";
  const vto = wi?.packagingVto?.trim() || "";
  const slots = workPackingSlots(wi);
  const cajas = slots.cajas1;
  const unidades = slots.unidades1;
  const labels: string[] = [];
  const missingClient = !client || client.toLowerCase() === "sin cliente";
  const missingDeliveryDate = !deliveryDate;
  const missingLote = !lote;
  const missingVto = !vto;
  const missingCajas = cajas == null || Number(cajas) <= 0;
  const missingUnidades = unidades == null || Number(unidades) <= 0;
  if (missingClient) labels.push("Cliente");
  if (missingDeliveryDate) labels.push("Fecha de entrega");
  if (missingLote) labels.push("Lote");
  if (missingVto) labels.push("VTO");
  if (missingCajas) labels.push("Cajas");
  if (missingUnidades) labels.push("Unidades por caja");
  return {
    missingClient,
    missingDeliveryDate,
    missingLote,
    missingVto,
    missingCajas,
    missingUnidades,
    labels,
  };
}

export function hasBlockingRemitoGaps(gaps: RemitoQualityGaps): boolean {
  return gaps.missingClient || gaps.missingDeliveryDate;
}

export function resolveRemitoInputFromQuality(
  item: QualityItem,
  workItems: WorkItem[] = [],
  overrides?: Partial<
    Pick<
      RemitoApprovalInput,
      | "clientId"
      | "clientDisplay"
      | "deliveryDate"
      | "lote"
      | "vto"
      | "cajas1"
      | "unidades1"
      | "cajas2"
      | "unidades2"
      | "cajas3"
      | "unidades3"
      | "extraCajas"
      | "unitsPerCaja1"
      | "totalUnits"
    >
  >
): RemitoApprovalInput | null {
  if (!isPackagingQualityItem(item)) return null;

  const workItemId =
    item.relatedWorkItemId?.trim() ||
    (item.id.startsWith("qc:") ? item.id.slice(3) : item.id);
  if (!workItemId) return null;

  const wi = resolveWorkItem(item, workItems);
  const slots = workPackingSlots(wi);

  const client =
    overrides?.clientId?.trim() ||
    overrides?.clientDisplay?.trim() ||
    item.client?.trim() ||
    wi?.client?.trim() ||
    "Sin cliente";
  const deliveryDate =
    overrides?.deliveryDate?.trim() ||
    item.deliveryDate?.trim() ||
    wi?.deliveryDate?.trim() ||
    wi?.plannedDate?.trim() ||
    new Date().toISOString().slice(0, 10);
  const product = item.product?.trim() || wi?.product?.trim() || "Producto";
  // Preferir embalaje final (Codificado / Envasado) sobre lote granel del QualityItem.
  const lote =
    overrides?.lote?.trim() ||
    wi?.packagingLote?.trim() ||
    item.lote?.trim() ||
    wi?.loteRef?.trim() ||
    "";
  const vto = overrides?.vto?.trim() || wi?.packagingVto?.trim() || "";
  const totalUnits =
    overrides?.totalUnits ??
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
    cajas1: overrides?.cajas1 ?? slots.cajas1,
    unidades1: overrides?.unidades1 ?? slots.unidades1,
    unitsPerCaja1:
      overrides?.unitsPerCaja1 ??
      overrides?.unidades1 ??
      slots.unidades1,
    cajas2: overrides?.cajas2 ?? slots.cajas2,
    unidades2: overrides?.unidades2 ?? slots.unidades2,
    cajas3: overrides?.cajas3 ?? slots.cajas3,
    unidades3: overrides?.unidades3 ?? slots.unidades3,
    extraCajas: overrides?.extraCajas ?? slots.extraCajas,
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
