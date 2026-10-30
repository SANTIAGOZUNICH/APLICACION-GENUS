/** Tipos de dominio — Depósito «Entregas Producción» (despachos de producto terminado; migración 0073). */
import type { SectorId } from "@/types/operational/sector";

export interface DespachoRecord {
  id: string;
  /** ISO yyyy-mm-dd (la UI lo muestra DD/MM/AAAA). null = todavía sin fecha (se puede completar después). */
  fecha: string | null;
  /** TEXTO: conserva ceros a la izquierda y guiones (nunca se convierte a número). */
  remito: string;
  cliente: string;
  producto: string;
  bultos: number;
  cantidadTotal: number;
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
  remito?: string;
  cliente?: string;
  producto?: string;
  bultos?: number;
  cantidadTotal?: number;
  pedidoOp?: string;
  /** Clave generada por el cliente: un reintento / doble clic con la misma clave NO crea otro despacho. */
  idempotencyKey?: string;
};

export type CreateDespachoResult = { record: DespachoRecord; created: boolean };
