/**
 * Entregas PROGRAMADAS a clientes (calendario de Entregas).
 *
 * No es lo mismo que una entrega REAL (`work_item_deliveries`, módulo «Entregados»): acá se programa qué se le
 * entregará a un cliente y cuándo, se vincula con los trabajos de Envasado Masivo/Premium que lo fabrican, y el estado
 * «Entregada» solo aparece cuando el flujo real de entrega ya lo confirmó. Programar una entrega no mueve stock.
 */
import type { SectorId } from "@/types/operational/sector";

export const DELIVERY_SECTORS = ["ENVASADO_MASIVO", "ENVASADO_PREMIUM"] as const;
export type DeliverySector = (typeof DELIVERY_SECTORS)[number];

export const DELIVERY_SECTOR_LABEL: Record<DeliverySector, string> = {
  ENVASADO_MASIVO: "Envasado Masivo",
  ENVASADO_PREMIUM: "Envasado Premium",
};

/** Estado de la entrega programada en sí (la cancelación nunca borra: queda como historial). */
export type ScheduledDeliveryState = "programada" | "cancelada";

/** Estado que se muestra: mezcla el estado propio con lo que informan los trabajos vinculados y el flujo real de entrega. */
export type DeliveryDisplayStatus =
  | "programada"
  | "produccion_pendiente"
  | "produccion_en_proceso"
  | "produccion_finalizada"
  | "lista_para_entregar"
  | "entregada"
  | "cancelada";

export const DELIVERY_STATUS_LABEL: Record<DeliveryDisplayStatus, string> = {
  programada: "Entrega programada",
  produccion_pendiente: "Producción pendiente",
  produccion_en_proceso: "Producción en proceso",
  produccion_finalizada: "Producción finalizada",
  lista_para_entregar: "Lista para entregar",
  entregada: "Entregada",
  cancelada: "Cancelada",
};

/** Dato del trabajo vinculado que alimenta el estado y la comparación (se lee fresco de work_items). */
export interface LinkedWork {
  linkId: string;
  workItemId: string;
  linkedAt: string;
  linkedBy: string;
  client: string | null;
  product: string | null;
  sector: string;
  line: string | null;
  plannedDate: string | null;
  plannedDateTo: string | null;
  plannedQuantity: string | null;
  unit: string | null;
  deliveryDate: string | null;
  packagingLote: string | null;
  packagingVto: string | null;
  operationalStatus: string;
  qualityStatus: string;
  finishedQty: string | null;
  orderNumber: string | null;
  /** true solo si el flujo REAL de entrega (Entregados) registró la entrega de este trabajo. */
  delivered: boolean;
  cancelled: boolean;
}

export interface ScheduledDeliveryItem {
  id: string;
  deliveryId: string;
  product: string;
  quantity: string | null;
  unit: string | null;
  sector: DeliverySector | null;
  plannedProductionDate: string | null;
  lot: string | null;
  vto: string | null;
  notes: string | null;
  position: number;
  version: number;
  createdAt: string;
  updatedAt: string;
  works: LinkedWork[];
  status: DeliveryDisplayStatus;
}

export interface ScheduledDelivery {
  id: string;
  client: string;
  deliveryDate: string;
  responsible: string | null;
  notes: string | null;
  state: ScheduledDeliveryState;
  rescheduleCount: number;
  version: number;
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancelReason: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  items: ScheduledDeliveryItem[];
  status: DeliveryDisplayStatus;
}

export interface DeliveryHistoryEntry {
  id: string;
  action: string;
  actorEmail: string;
  actorSector: string;
  entityId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
}

/** Cambio entre lo programado y lo que tiene el trabajo vinculado (se muestra y se confirma; nunca se aplica solo). */
export interface WorkDivergence {
  field: "plannedQuantity" | "unit" | "deliveryDate" | "packagingLote" | "packagingVto";
  label: string;
  itemValue: string;
  workValue: string;
}

export interface DeliverySuggestion {
  deliveryId: string;
  itemId: string;
  client: string;
  deliveryDate: string;
  product: string;
  quantity: string | null;
  unit: string | null;
  sector: DeliverySector | null;
  plannedProductionDate: string | null;
  lot: string | null;
  vto: string | null;
  notes: string | null;
  /** Trabajos que ya cubren este producto (puede completarse con varios). */
  linkedWorks: number;
  /** Cuánto de la cantidad programada ya está cubierto por trabajos vinculados (si ambos son numéricos). */
  coveredQuantity: number | null;
  match: "exacta" | "compatible";
}

/** Quién puede crear, modificar, reprogramar, cancelar y vincular. */
export function canManageEntregas(sector: SectorId | string): boolean {
  return sector === "PRODUCCION" || sector === "DIRECCION";
}

/**
 * Quién ve el calendario (consulta): Producción y Dirección (todo), Depósito (despacho: todo) y Envasado Masivo/Premium
 * (SOLO los productos de su sector: el servidor recorta el resto). Los demás sectores no ven Entregas.
 */
export function canViewEntregas(sector: SectorId | string): boolean {
  return canManageEntregas(sector) || sector === "DEPOSITO" || sector === "ENVASADO_MASIVO" || sector === "ENVASADO_PREMIUM";
}

/** Sector al que se recortan los productos visibles (null = ve todos). */
export function entregasVisibleSector(sector: SectorId | string): DeliverySector | null {
  return sector === "ENVASADO_MASIVO" || sector === "ENVASADO_PREMIUM" ? sector : null;
}

export class EntregasConflictError extends Error {
  readonly status = 409;
  readonly code = "ENTREGAS_CONFLICT";
  constructor(message: string) {
    super(message);
    this.name = "EntregasConflictError";
  }
}
