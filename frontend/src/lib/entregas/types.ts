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

/**
 * Sector de un producto en el calendario. Las entregas PROGRAMADAS a mano solo son de Envasado; las entregas que se
 * recuperan de los trabajos (histórico/futuro) pueden venir también de Elaboración o Codificado.
 */
export type ItemSector = DeliverySector | "ELABORACION" | "CODIFICADO";
export const ITEM_SECTOR_LABEL: Record<ItemSector, string> = {
  ...DELIVERY_SECTOR_LABEL,
  ELABORACION: "Elaboración",
  CODIFICADO: "Codificado",
};

/** De dónde sale una aparición en el calendario. */
export type DeliveryOrigin = "programada_manual" | "desde_trabajo" | "entrega_registrada";
export const DELIVERY_ORIGIN_LABEL: Record<DeliveryOrigin, string> = {
  programada_manual: "Programada manual",
  desde_trabajo: "Desde trabajo",
  entrega_registrada: "Entrega registrada",
};

/** Estado de la entrega programada en sí (la cancelación nunca borra: queda como historial). */
export type ScheduledDeliveryState = "programada" | "cancelada";

/** Estado que se muestra: mezcla el estado propio con lo que informan los trabajos vinculados y el flujo real de entrega. */
export type DeliveryDisplayStatus =
  | "programada"
  | "produccion_pendiente"
  | "produccion_en_proceso"
  | "lista_para_entregar"
  | "entrega_parcial"
  | "entregada"
  | "cancelada";

export const DELIVERY_STATUS_LABEL: Record<DeliveryDisplayStatus, string> = {
  programada: "Entrega programada",
  produccion_pendiente: "Producción pendiente",
  produccion_en_proceso: "Producción en proceso",
  lista_para_entregar: "Lista para entregar",
  entrega_parcial: "Entrega parcial",
  entregada: "Entregada",
  cancelada: "Cancelada",
};

/** Una entrega REAL registrada (work_item_deliveries, estado ENTREGADO, no eliminada) de un trabajo. */
export interface RealDelivery {
  id: string;
  /** Fecha real de entrega, día calendario en zona Argentina (yyyy-mm-dd). */
  date: string;
  quantity: string | null;
  unit: string | null;
  remito: string | null;
  receivedBy: string | null;
  lote: string | null;
  vto: string | null;
  observations: string | null;
}

/** Dato del trabajo (vinculado o recuperado) que alimenta el estado y la comparación (se lee fresco de work_items). */
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
  finishedQty: string | null;
  orderNumber: string | null;
  /** Responsable / línea que ejecuta el trabajo (Cristian, Nicolás, Línea 1…). */
  responsible: string | null;
  /** Observaciones del trabajo (nota de asignación y de avance). */
  notes: string | null;
  /** Cuándo terminó la PRODUCCIÓN (work_items.completed_at). No es la fecha de entrega al cliente. */
  completedAt: string | null;
  /** Entregas REALES registradas (flujo Entregados). La fecha real es la de acá, nunca completedAt. */
  realDeliveries: RealDelivery[];
  /** Suma de lo entregado realmente (null si no hay entregas o las cantidades no son numéricas). */
  deliveredQty: number | null;
  /** Fecha real de la última entrega registrada. */
  deliveredAt: string | null;
  /** true solo si el flujo REAL de entrega (Entregados) registró la entrega COMPLETA de este trabajo (no una parcial). */
  delivered: boolean;
  cancelled: boolean;
  /** Lo programado cuando se vinculó este trabajo (o cuando Producción lo dio por revisado). */
  snapshot: Partial<Record<WorkDivergence["field"], string | null>>;
}

export interface ScheduledDeliveryItem {
  id: string;
  deliveryId: string;
  product: string;
  quantity: string | null;
  unit: string | null;
  sector: ItemSector | null;
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
  /** Programada a mano (editable) o recuperada de los trabajos (solo lectura). Ausente = programada manual. */
  origin?: DeliveryOrigin;
}

/** Aparición recuperada de los trabajos (no existe en scheduled_deliveries): solo lectura. */
export const isDerivedDelivery = (d: Pick<ScheduledDelivery, "origin">): boolean => d.origin === "desde_trabajo" || d.origin === "entrega_registrada";

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

/**
 * Diagnóstico de solo lectura de lo que el calendario recupera solo de los trabajos (sin carga manual).
 * «Históricas» = entregas REALES ya hechas; «futuras» = trabajos vigentes con fecha de entrega que todavía no se entregaron.
 */
export interface EntregasRecoveryStats {
  /** Trabajos con entrega real y fecha real: aparecen en el calendario (sueltos o dentro de una entrega programada). */
  historicas: { total: number; sueltas: number; enEntregaProgramada: number };
  /** Trabajos vigentes con fecha de entrega (hoy o después) que todavía no se entregaron del todo. */
  futuras: { total: number; sueltas: number; enEntregaProgramada: number };
  /** Con fecha de entrega ya vencida y sin entregar: también aparecen (en su fecha), pero se cuentan aparte. */
  vencidasSinEntregar: number;
  /** Trabajos que NO se pueden ubicar en el calendario y por qué. */
  fuera: {
    /** Marcados como entregados pero sin ninguna entrega real registrada: no hay fecha real que usar (no se inventa). */
    entregadoSinFechaReal: number;
    /** Vigentes sin fecha de entrega cargada (no hay fecha que usar). */
    sinFechaDeEntrega: number;
    /** Cancelados o eliminados con fecha de entrega y sin entrega real: no son entregas vigentes. */
    canceladosOEliminados: number;
  };
}

export class EntregasConflictError extends Error {
  readonly status = 409;
  readonly code = "ENTREGAS_CONFLICT";
  constructor(message: string) {
    super(message);
    this.name = "EntregasConflictError";
  }
}
