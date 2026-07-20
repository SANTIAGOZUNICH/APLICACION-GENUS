"use client";

import type { SectorId } from "@/types/operational/sector";
import type { WorkItem } from "@/types/operational/work-item";
import {
  getAllAsignacionLotes,
  type AsignacionLote,
} from "@/features/os/operational/adapters/asignacion-lotes-repository";
import {
  getAllMateriasPrimas,
  resolveEstado,
  type MateriaPrimaLot,
} from "@/features/os/operational/adapters/materia-prima-repository";
import {
  listAllManualWorkItems,
} from "@/features/os/operational/adapters/manual-work-items-repository";
import {
  listAllDeliveries,
  type DeliveryRecord,
} from "@/features/os/operational/adapters/delivery-repository";
import {
  listDocumentsByKind,
  type OrderDocument,
  type OrderDocumentKind,
} from "@/features/os/operational/adapters/order-documents-repository";
import {
  completionEventToQualityItem,
} from "@/features/os/operational/lib/completion-events";
import {
  getFormulaForProduct,
} from "@/features/os/operational/adapters/formula-repository";
import {
  listActiveSubstitutions,
} from "@/features/os/operational/adapters/mp-substitutions-repository";
import {
  readCompletionEvents,
  readDecisionMap,
} from "@/features/os/operational/store/operational-store";
import {
  canCreamyAccessDomain,
  isOwnWorkOnlySector,
} from "./permissions";
import type {
  CreamyLocalSnapshot,
  CreamyDeliverySummary,
  CreamyFormulaSummary,
  CreamyLotSummary,
  CreamyOrderDocumentSummary,
  CreamyOrderSummary,
  CreamyQualityPendingSummary,
  CreamyRawMaterialSummary,
  CreamySubstitutionSummary,
  CreamyWorkItemSummary,
} from "./types";

const WORK_LIMIT = 40;
const LOT_LIMIT = 40;
const RAW_MATERIAL_LIMIT = 40;
const ORDER_LIMIT = 40;
const QUALITY_LIMIT = 40;
const DELIVERY_LIMIT = 40;

interface BuildSnapshotInput {
  actorSectorId: SectorId;
  workItems?: WorkItem[];
}

function cap<T>(items: T[], limit: number): T[] {
  return items.slice(0, limit);
}

function uniqueById<T extends { id: string }>(items: T[]): T[] {
  const byId = new Map<string, T>();
  for (const item of items) byId.set(item.id, item);
  return [...byId.values()];
}

function canSendWorkItem(actorSectorId: SectorId, item: WorkItem): boolean {
  if (!canCreamyAccessDomain(actorSectorId, "works")) return false;
  if (actorSectorId === "PRODUCCION" || actorSectorId === "CALIDAD") return true;
  if (isOwnWorkOnlySector(actorSectorId)) {
    return item.sector === actorSectorId || item.ownerSector === actorSectorId;
  }
  return false;
}

function summarizeWorkItem(item: WorkItem): CreamyWorkItemSummary {
  return {
    id: item.id,
    sector: item.sector,
    ownerSector: item.ownerSector,
    ownerPerson: item.ownerPerson,
    client: item.client,
    product: item.product,
    quantity: item.quantity,
    unit: item.unit,
    line: item.line,
    plannedDate: item.plannedDate,
    deliveryDate: item.deliveryDate,
    status: item.status,
    priority: item.priority,
    pedidoRef: item.pedidoRef,
    oeRef: item.oeRef,
    oaRef: item.oaRef,
    loteRef: item.loteRef,
    notes: item.notes,
    finishedQty: item.finishedQty ?? null,
    operationalObservation: item.operationalObservation ?? null,
  };
}

function summarizeLot(lot: AsignacionLote): CreamyLotSummary {
  return {
    id: lot.id,
    lote: lot.lote,
    fecha: lot.fecha,
    producto: lot.producto,
    codigo: lot.codigo,
    marca: lot.marca,
    cantidades: lot.cantidades,
    vto: lot.vto,
    muestras: lot.muestras,
    cjMuestra: lot.cjMuestra,
    fechaAnalisis: lot.fechaAnalisis,
    observaciones: lot.observaciones,
  };
}

function summarizeRawMaterial(mp: MateriaPrimaLot): CreamyRawMaterialSummary {
  return {
    id: mp.id,
    codigo: mp.codigo,
    nombre: mp.nombre,
    lote: mp.lote,
    proveedor: mp.proveedor,
    cantidad: mp.cantidad,
    unidad: mp.unidad,
    vencimiento: mp.vencimiento,
    ubicacion: mp.ubicacion,
    observaciones: mp.observaciones,
    estado: resolveEstado(mp),
  };
}

function summarizeDelivery(delivery: DeliveryRecord): CreamyDeliverySummary {
  return {
    id: delivery.id,
    workItemId: delivery.workItemId,
    qualityItemId: delivery.qualityItemId ?? null,
    product: delivery.product,
    codigo: delivery.codigo,
    client: delivery.client,
    lote: delivery.lote,
    sourceSector: delivery.sourceSector,
    quantity: delivery.quantity,
    unit: delivery.unit,
    plannedDeliveryDate: delivery.plannedDeliveryDate,
    actualDeliveredAt: delivery.actualDeliveredAt,
    remito: delivery.remito,
    receivedBy: delivery.receivedBy,
    observations: delivery.observations,
    status: delivery.status === "ANULADO" ? "ANULADO" : "ENTREGADO",
    archived: Boolean(delivery.archived),
  };
}

function summarizeDocument(doc: OrderDocument): CreamyOrderDocumentSummary {
  return {
    id: doc.id,
    kind: doc.kind,
    ref: doc.ref,
    producto: doc.producto,
    codigo: doc.codigo,
    cliente: doc.cliente,
    lote: doc.lote,
    fecha: doc.fecha,
    observaciones: doc.observaciones,
    fileName: doc.fileName,
    fileType: doc.fileType,
    uploadedBy: doc.uploadedBy,
    uploadedAt: doc.uploadedAt,
    version: doc.version,
    sectorUploaded: doc.sectorUploaded,
    linkedWorkItemId: doc.linkedWorkItemId,
  };
}

function orderId(kind: OrderDocumentKind, ref: string): string {
  return `${kind}:${ref}`;
}

function buildOrders(
  actorSectorId: SectorId,
  workItems: CreamyWorkItemSummary[]
): CreamyOrderSummary[] {
  const canOE = canCreamyAccessDomain(actorSectorId, "orders_oe");
  const canOA = canCreamyAccessDomain(actorSectorId, "orders_oa");
  const docs = [
    ...(canOE ? listDocumentsByKind("OE") : []),
    ...(canOA ? listDocumentsByKind("OA") : []),
  ].map(summarizeDocument);
  const docsByRef = new Map<string, CreamyOrderDocumentSummary[]>();
  for (const doc of docs) {
    const key = orderId(doc.kind, doc.ref);
    docsByRef.set(key, [...(docsByRef.get(key) ?? []), doc]);
  }

  const orders = new Map<string, CreamyOrderSummary>();

  for (const item of workItems) {
    const candidates: Array<[OrderDocumentKind, string | null]> = [
      ["OE", item.oeRef],
      ["OA", item.oaRef],
    ];
    for (const [kind, ref] of candidates) {
      if (!ref) continue;
      if (kind === "OE" && !canOE) continue;
      if (kind === "OA" && !canOA) continue;
      const id = orderId(kind, ref);
      const existing = orders.get(id);
      orders.set(id, {
        id,
        kind,
        ref,
        fecha: existing?.fecha ?? item.plannedDate,
        deliveryDate: existing?.deliveryDate ?? item.deliveryDate,
        cliente: existing?.cliente ?? item.client,
        producto: existing?.producto ?? item.product,
        cantidad: existing?.cantidad ?? ([item.quantity, item.unit].filter(Boolean).join(" ") || null),
        sectorIds: Array.from(new Set([...(existing?.sectorIds ?? []), item.sector])),
        workItemIds: Array.from(new Set([...(existing?.workItemIds ?? []), item.id])),
        documents: docsByRef.get(id) ?? existing?.documents ?? [],
      });
    }
  }

  for (const [key, documents] of docsByRef.entries()) {
    if (orders.has(key)) continue;
    const first = documents[0];
    if (!first) continue;
    orders.set(key, {
      id: key,
      kind: first.kind,
      ref: first.ref,
      fecha: first.fecha ?? null,
      deliveryDate: null,
      cliente: first.cliente ?? null,
      producto: first.producto ?? null,
      cantidad: null,
      sectorIds: [],
      workItemIds: documents.map((doc) => doc.linkedWorkItemId).filter(Boolean) as string[],
      documents,
    });
  }

  return [...orders.values()].sort((a, b) => a.ref.localeCompare(b.ref, "es"));
}

function buildQualityPending(actorSectorId: SectorId): CreamyQualityPendingSummary[] {
  if (!canCreamyAccessDomain(actorSectorId, "quality")) return [];
  const decisions = readDecisionMap();
  return readCompletionEvents()
    .map(completionEventToQualityItem)
    .map((item) => ({
      ...item,
      status: decisions[item.id]?.status ?? item.status,
      observation: decisions[item.id]?.observation ?? item.observation,
    }))
    .filter((item) => item.status === "pendiente" || item.status === "aprobado")
    .map((item) => ({
      id: item.id,
      kind: item.kind,
      lote: item.lote,
      product: item.product,
      client: item.client,
      oe: item.oe,
      oa: item.oa,
      line: item.line,
      quantity: item.quantity,
      dayLabel: item.dayLabel,
      deliveryDate: item.deliveryDate ?? null,
      status: item.status,
      relatedWorkItemId: item.relatedWorkItemId,
      receivedFrom: item.receivedFrom ?? null,
      completedAt: item.completedAt ?? null,
      completedBy: item.completedBy ?? null,
      observation: item.observation ?? null,
    }));
}

const FORMULA_LIMIT = 20;
const SUBSTITUTION_LIMIT = 20;

function buildFormulas(workItems: CreamyWorkItemSummary[]): CreamyFormulaSummary[] {
  const products = Array.from(new Set(workItems.map((w) => w.product).filter(Boolean) as string[]));
  const results: CreamyFormulaSummary[] = [];
  for (const product of products.slice(0, FORMULA_LIMIT)) {
    const formula = getFormulaForProduct(product);
    if (formula) {
      results.push({
        product: formula.product,
        estimated: formula.estimated,
        lines: formula.lines.map((line) => ({
          codigo: line.codigo,
          nombre: line.nombre,
          cantidadRequerida: line.cantidadRequerida,
          unidad: line.unidad,
        })),
      });
    }
  }
  return results;
}

function buildSubstitutions(actorSectorId: SectorId): CreamySubstitutionSummary[] {
  if (!canCreamyAccessDomain(actorSectorId, "substitutions")) return [];
  return listActiveSubstitutions()
    .slice(0, SUBSTITUTION_LIMIT)
    .map((s) => ({
      id: s.id,
      originalCodigo: s.originalCodigo,
      originalNombre: s.originalNombre,
      substituteCodigo: s.substituteCodigo,
      substituteNombre: s.substituteNombre,
      products: s.products,
      motivo: s.motivo,
      approvedBy: s.approvedBy,
      approvedAt: s.approvedAt,
      expiresAt: s.expiresAt,
      notes: s.notes,
    }));
}

export function buildCreamyLocalSnapshot({
  actorSectorId,
  workItems = [],
}: BuildSnapshotInput): CreamyLocalSnapshot {
  const mergedWorkItems = uniqueById([...workItems, ...listAllManualWorkItems()]);
  const visibleWorkItems = cap(
    mergedWorkItems
      .filter((item) => canSendWorkItem(actorSectorId, item))
      .sort((a, b) =>
        (a.deliveryDate ?? a.plannedDate ?? "").localeCompare(b.deliveryDate ?? b.plannedDate ?? "")
      )
      .map(summarizeWorkItem),
    WORK_LIMIT
  );

  const lots = canCreamyAccessDomain(actorSectorId, "lots")
    ? cap(getAllAsignacionLotes().map(summarizeLot), LOT_LIMIT)
    : [];
  const rawMaterials = canCreamyAccessDomain(actorSectorId, "rawMaterials")
    ? cap(getAllMateriasPrimas().map(summarizeRawMaterial), RAW_MATERIAL_LIMIT)
    : [];
  const orders = cap(buildOrders(actorSectorId, visibleWorkItems), ORDER_LIMIT);
  const qualityPending = cap(buildQualityPending(actorSectorId), QUALITY_LIMIT);
  const deliveries = canCreamyAccessDomain(actorSectorId, "deliveries")
    ? cap(
        listAllDeliveries({ includeArchived: true })
          .sort((a, b) => b.actualDeliveredAt.localeCompare(a.actualDeliveredAt))
          .map(summarizeDelivery),
        DELIVERY_LIMIT
      )
    : [];

  // Only include formulas for sectors that work with elaboration (have rawMaterials or works access)
  const formulaWorkItems = actorSectorId === "ELABORACION" || actorSectorId === "PRODUCCION"
    ? visibleWorkItems.filter((w) => w.sector === "ELABORACION" || w.ownerSector === "ELABORACION")
    : [];
  const formulas = formulaWorkItems.length > 0 ? buildFormulas(formulaWorkItems) : undefined;
  const substitutions = canCreamyAccessDomain(actorSectorId, "substitutions")
    ? buildSubstitutions(actorSectorId)
    : undefined;

  return {
    capturedAt: new Date().toISOString(),
    source: "local_browser",
    actorSectorId,
    limits: {
      workItems: WORK_LIMIT,
      lots: LOT_LIMIT,
      rawMaterials: RAW_MATERIAL_LIMIT,
      orders: ORDER_LIMIT,
      qualityPending: QUALITY_LIMIT,
      deliveries: DELIVERY_LIMIT,
    },
    workItems: visibleWorkItems,
    lots,
    rawMaterials,
    orders,
    qualityPending,
    deliveries,
    formulas,
    substitutions,
    notes: [
      "actorSectorId es client-supplied y no reemplaza autenticación server-side.",
      "Snapshot filtrado del navegador local; no incluye binarios fileDataUrl.",
    ],
  };
}
