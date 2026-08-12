/**
 * Helpers para el editor de remito desde Aprobados (sin persistir hasta Guardar/Generar).
 */
import type { QualityItem } from "@/features/os/operational/types";
import type { WorkItem } from "@/types/operational/work-item";
import {
  collectSameClientDateApprovedPackaging,
  resolveRemitoInputFromQuality,
} from "@/lib/remitos/from-quality";
import { lineTotalCajas, lineTotalUnitsFromCajas } from "@/lib/remitos/line-qty";
import { resolveWorkItemDeliverableUnits } from "@/lib/remitos/packing-math";
import type { RemitoApprovalInput, RemitoCajaCombo, RemitoLine } from "@/lib/remitos/types";

export type RemitoComposeLine = RemitoLine & {
  /** Total producido informado por Envasado (no se corrige solo). */
  producedUnits: number;
};

function parseQty(raw: string | null | undefined): number {
  const s = String(raw ?? "").replace(",", ".");
  const m = s.match(/-?\d+(\.\d+)?/);
  return m ? Math.max(0, Number(m[0])) : 0;
}

function workIdFromQuality(item: QualityItem): string {
  return (
    item.relatedWorkItemId?.trim() ||
    (item.id.startsWith("qc:") ? item.id.slice(3) : item.id)
  );
}

/**
 * Cantidad entregable esperada para la advertencia de mismatch del editor de
 * remito. Usa deliverableUnits (excluye muestras) cuando hay cierre físico
 * — no packagingTotalUnits/finishedQty, que incluyen muestras y disparaban
 * una advertencia falsa cada vez que el trabajo tenía muestras (la
 * distribución en cajas, correcta, sumaba menos que lo "producido").
 */
export function producedUnitsFromQuality(
  item: QualityItem,
  workItems: WorkItem[]
): number {
  const wid = workIdFromQuality(item);
  const wi =
    workItems.find((w) => w.id === wid) ??
    workItems.find((w) => w.id === item.relatedWorkItemId) ??
    null;
  const deliverable = resolveWorkItemDeliverableUnits(wi);
  if (deliverable != null) return deliverable;
  const fromFinished = parseQty(wi?.finishedQty);
  if (fromFinished > 0) return fromFinished;
  const fromQty = parseQty(item.quantity) || parseQty(wi?.quantity);
  return fromQty > 0 ? fromQty : 0;
}

export function buildComposeLinesFromQuality(
  seed: QualityItem,
  allApproved: QualityItem[],
  workItems: WorkItem[]
): {
  lines: RemitoComposeLine[];
  clientDisplay: string;
  deliveryDate: string;
  groupSize: number;
} {
  const group = collectSameClientDateApprovedPackaging(seed, allApproved, workItems);
  const items = group.length ? group : [seed];
  const lines: RemitoComposeLine[] = [];
  let clientDisplay = seed.client?.trim() || "Sin cliente";
  let deliveryDate = seed.deliveryDate?.trim() || "";

  items.forEach((item, idx) => {
    const input = resolveRemitoInputFromQuality(item, workItems);
    if (!input) return;
    clientDisplay = input.clientDisplay || input.clientId || clientDisplay;
    deliveryDate = input.deliveryDate || deliveryDate;
    const cajas1 = input.cajas1 ?? 0;
    const unidades1 = input.unidades1 ?? input.unitsPerCaja1 ?? 0;
    const cajas2 = input.cajas2 ?? 0;
    const unidades2 = input.unidades2 ?? input.unitsPerCaja2 ?? 0;
    const cajas3 = input.cajas3 ?? 0;
    const unidades3 = input.unidades3 ?? input.unitsPerCaja3 ?? 0;
    const extraCajas: RemitoCajaCombo[] = [...(input.extraCajas ?? [])];
    const boxed = lineTotalUnitsFromCajas({
      cajas1,
      unidades1,
      cajas2,
      unidades2,
      cajas3,
      unidades3,
      extraCajas,
    });
    const produced = producedUnitsFromQuality(item, workItems);
    lines.push({
      id: `compose-${input.workItemId}-${idx}`,
      remitoId: "",
      workItemId: input.workItemId,
      product: input.product,
      lote: input.lote ?? "",
      vto: input.vto ?? "",
      totalUnits: boxed > 0 ? boxed : input.totalUnits || produced,
      cajas1,
      unidades1,
      cajas2,
      unidades2,
      cajas3,
      unidades3,
      extraCajas,
      sortOrder: idx,
      producedUnits: produced > 0 ? produced : boxed || input.totalUnits || 0,
    });
  });

  return { lines, clientDisplay, deliveryDate, groupSize: lines.length };
}

export function remitoComposeSummary(lines: RemitoComposeLine[]) {
  const totalProductos = lines.length;
  const totalBultos = lines.reduce((s, l) => s + lineTotalCajas(l), 0);
  const totalUnidades = lines.reduce((s, l) => {
    const u = lineTotalUnitsFromCajas(l);
    return s + (u > 0 ? u : l.totalUnits || 0);
  }, 0);
  const totalProducido = lines.reduce((s, l) => s + (l.producedUnits || 0), 0);
  return { totalProductos, totalBultos, totalUnidades, totalProducido };
}

export function producedVsBoxedWarning(lines: RemitoComposeLine[]): string | null {
  const { totalUnidades, totalProducido } = remitoComposeSummary(lines);
  if (totalProducido <= 0) return null;
  if (totalProducido === totalUnidades) return null;
  return `Advertencia: el total producido es ${totalProducido}, pero el detalle de cajas suma ${totalUnidades} unidades.`;
}

export function composeLineToApprovalInput(
  line: RemitoComposeLine,
  clientDisplay: string,
  deliveryDate: string
): RemitoApprovalInput {
  const boxed = lineTotalUnitsFromCajas(line);
  return {
    workItemId: line.workItemId,
    clientId: clientDisplay,
    clientDisplay,
    deliveryDate,
    product: line.product,
    lote: line.lote,
    vto: line.vto,
    totalUnits: boxed > 0 ? boxed : line.totalUnits,
    cajas1: line.cajas1,
    unidades1: line.unidades1,
    cajas2: line.cajas2,
    unidades2: line.unidades2,
    cajas3: line.cajas3,
    unidades3: line.unidades3,
    extraCajas: line.extraCajas,
  };
}

export function withComposeAutoTotal(line: RemitoComposeLine): RemitoComposeLine {
  const total = lineTotalUnitsFromCajas(line);
  return { ...line, totalUnits: total > 0 ? total : line.totalUnits };
}

export function formatCajasLines(line: RemitoComposeLine): string[] {
  const parts: string[] = [];
  const push = (cajas: number, unidades: number) => {
    if (cajas > 0 || unidades > 0) {
      parts.push(`${cajas} cajas × ${unidades} unidades`);
    }
  };
  push(line.cajas1 || 0, line.unidades1 || 0);
  push(line.cajas2 || 0, line.unidades2 || 0);
  push(line.cajas3 || 0, line.unidades3 || 0);
  for (const e of line.extraCajas ?? []) {
    push(e.cajas || 0, e.unidades || 0);
  }
  return parts;
}
