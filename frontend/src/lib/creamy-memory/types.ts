/**
 * Tipos de dominio para la memoria de Creamy (personal + operativa).
 *
 * La persistencia durable (Neon) llega recién con la migración 0015
 * (drizzle/0015_creamy_memory.sql), diferida hasta APPLY_MIGRATION_0015=1.
 * Hasta entonces estos tipos también describen los registros que vive el
 * repositorio en memoria (ver memory-repository.ts).
 */

import type { SectorId } from "@/types/operational/sector";

export type CreamyMemoryStatus = "active" | "deleted";

export type CreamyOperationalMemoryEstado = "REPORTADA" | "VALIDADA" | "REVOCADA";

export type CreamyOperationalMemoryFuente = "CHAT" | "OE" | "OA" | "OBSERVACION";

export type CreamyMemoryAuditAction =
  | "CREATE"
  | "UPDATE"
  | "VALIDATE"
  | "REVOKE"
  | "CORRECT"
  | "FORGET"
  | "CONFIRM"
  | "READ_DENIED"
  | "WRITE_DENIED";

export type CreamyMemoryEntityType = "user_memory" | "operational_memory";

/** Actor mínimo requerido para operar sobre la memoria de Creamy. */
export interface CreamyMemoryActor {
  email: string;
  sector: SectorId;
  /** Stable Genus Auth identity; email remains the 0015 compatibility key. */
  userId?: string;
}

export interface CreamyUserMemory {
  id: string;
  userEmail: string;
  userId?: string | null;
  sector: SectorId;
  memoryType: string;
  content: string;
  normalizedKey: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
  status: CreamyMemoryStatus;
  sourceConversationId: string | null;
}

export interface CreamyOperationalMemory {
  id: string;
  client: string;
  product: string;
  productCode: string | null;
  materiaPrimaOriginal: string;
  materiaPrimaUtilizada: string;
  codigoMpOriginal: string | null;
  codigoMpUtilizado: string | null;
  motivo: string;
  observacion: string | null;
  cantidadOProporcion: string | null;
  relatedOrderRef: string | null;
  relatedOrderId: string | null;
  fecha: string | null;
  informadoPor: string;
  validadoPor: string | null;
  estado: CreamyOperationalMemoryEstado;
  fuente: CreamyOperationalMemoryFuente;
  evidenceId: string | null;
  normalizedKey: string;
  createdAt: string;
  updatedAt: string;
  status: CreamyMemoryStatus;
}

export interface CreamyMemoryEvidence {
  id: string;
  operationalMemoryId: string;
  evidenceType: string;
  evidenceRef: string;
  payload: Record<string, unknown>;
  createdAt: string;
  createdBy: string;
}

export interface CreamyMemoryAuditEvent {
  id: string;
  entityType: CreamyMemoryEntityType;
  entityId: string;
  action: CreamyMemoryAuditAction;
  actorEmail: string;
  actorSector: string;
  detail: Record<string, unknown>;
  createdAt: string;
}

export interface UpsertUserMemoryInput {
  memoryType: string;
  content: string;
  sourceConversationId?: string | null;
}

export interface CreateOperationalMemoryInput {
  client: string;
  product: string;
  productCode?: string | null;
  materiaPrimaOriginal: string;
  materiaPrimaUtilizada: string;
  codigoMpOriginal?: string | null;
  codigoMpUtilizado?: string | null;
  motivo: string;
  observacion?: string | null;
  cantidadOProporcion?: string | null;
  relatedOrderRef?: string | null;
  relatedOrderId?: string | null;
  fecha?: string | null;
}

export interface SearchOperationalMemoriesFilter {
  client?: string;
  product?: string;
  productCode?: string;
  limit?: number;
  includeRevoked?: boolean;
}

export interface CorrectOperationalMemoryPatch {
  materiaPrimaUtilizada?: string;
  codigoMpUtilizado?: string | null;
  motivo?: string;
  observacion?: string | null;
  cantidadOProporcion?: string | null;
}

export interface CreamyContradictionGroup {
  key: string;
  client: string;
  product: string;
  materiaPrimaOriginal: string;
  memories: CreamyOperationalMemory[];
}

export class CreamyMemoryValidationError extends Error {
  readonly status = 400;
  readonly code = "CREAMY_MEMORY_VALIDATION";
  constructor(message: string) {
    super(message);
    this.name = "CreamyMemoryValidationError";
  }
}

export class CreamyMemoryForbiddenError extends Error {
  readonly status = 403;
  readonly code = "CREAMY_MEMORY_FORBIDDEN";
  constructor(message: string) {
    super(message);
    this.name = "CreamyMemoryForbiddenError";
  }
}

export class CreamyMemoryNotFoundError extends Error {
  readonly status = 404;
  readonly code = "CREAMY_MEMORY_NOT_FOUND";
  constructor(message: string) {
    super(message);
    this.name = "CreamyMemoryNotFoundError";
  }
}
