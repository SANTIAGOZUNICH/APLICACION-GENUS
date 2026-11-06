/** Tipos de dominio — Depósito «Entregas Producción» (despachos de producto terminado; migración 0073). */
import type { SectorId } from "@/types/operational/sector";

export interface DespachoRecord {
  id: string;
  /** ISO yyyy-mm-dd (la UI lo muestra DD/MM/AAAA). null = todavía sin fecha (se puede completar después). */
  fecha: string | null;
  /** EGRESO N° (B001, B002…): varias filas pueden compartir el mismo egreso. */
  egreso: string;
  /** TEXTO: conserva ceros a la izquierda y guiones (nunca se convierte a número). */
  remito: string;
  cliente: string;
  producto: string;
  /** BULTOS: cajas o bultos (entero ≥ 0). */
  bultos: number;
  /** CANTIDAD: unidades por bulto (entero ≥ 0). null = pendiente de completar (datos anteriores sin desglose). */
  cantidad: number | null;
  /** TOTAL = BULTOS × CANTIDAD (se calcula en el servidor). Con CANTIDAD pendiente conserva el total registrado antes de la planilla. */
  cantidadTotal: number;
  comentarios: string;
  /** Casillas independientes, con quién y cuándo las tocó por última vez (marcar o desmarcar). */
  control: boolean;
  controlBy: string | null;
  controlAt: string | null;
  entregado: boolean;
  entregadoBy: string | null;
  entregadoAt: string | null;
  /** Remito de GENUS OS cuyo número coincide con el REMITO N° de la fila (solo lectura: la fila nunca modifica el remito). */
  remitoLink?: { id: string; number: string; status: string } | null;
  /** Pedido/OP de Producción al que corresponde (opcional; permite ver las entregas parciales del pedido). */
  pedidoOp: string;
  createdBy: string;
  createdBySector: string;
  createdAt: string;
  updatedBy: string | null;
  /** También es la versión para concurrencia optimista. */
  updatedAt: string;
}

export type DespachoAuditAction = "create" | "update" | "delete";

export interface DespachoAuditEntry {
  id: string;
  despachoId: string;
  action: DespachoAuditAction;
  field: string | null;
  beforeValue: string | null;
  afterValue: string | null;
  actorEmail: string;
  actorSector: SectorId;
  actorName: string;
  createdAt: string;
}

export type DespachosActor = { email: string; sector: SectorId; displayName: string };

export type CreateDespachoInput = {
  fecha?: string | null;
  egreso?: string;
  remito?: string;
  cliente?: string;
  producto?: string;
  bultos?: number;
  /** Unidades por bulto; null/omitido = pendiente. */
  cantidad?: number | null;
  /** Solo para clientes anteriores a la planilla: si viene CANTIDAD, el total siempre es BULTOS × CANTIDAD. */
  cantidadTotal?: number;
  comentarios?: string;
  control?: boolean;
  entregado?: boolean;
  pedidoOp?: string;
  /** Clave generada por el cliente: un reintento / doble clic con la misma clave NO crea otro despacho. */
  idempotencyKey?: string;
};

export type CreateDespachoResult = { record: DespachoRecord; created: boolean };
