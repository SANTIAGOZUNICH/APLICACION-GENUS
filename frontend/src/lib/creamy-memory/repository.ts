import type {
  CreamyMemoryAuditEvent,
  CreamyMemoryEvidence,
  CreamyOperationalMemory,
  CreamyUserMemory,
} from "@/lib/creamy-memory/types";

/**
 * Contrato de persistencia de la memoria de Creamy. La implementación en
 * memoria (memory-repository.ts) es la única disponible hasta que se aplique
 * la migración 0015 (APPLY_MIGRATION_0015=1) y se conecte un adaptador
 * Drizzle sobre Neon.
 */
export interface CreamyMemoryRepository {
  // Memoria personal: userId cuando 0017 está disponible; email como compatibilidad 0015.
  findUserMemoryByKey(owner: { userEmail: string; userId?: string }, normalizedKey: string): Promise<CreamyUserMemory | null>;
  getUserMemory(id: string): Promise<CreamyUserMemory | null>;
  insertUserMemory(record: CreamyUserMemory): Promise<CreamyUserMemory>;
  updateUserMemory(id: string, patch: Partial<CreamyUserMemory>): Promise<CreamyUserMemory | null>;
  listUserMemories(owner: { userEmail: string; userId?: string }): Promise<CreamyUserMemory[]>;

  // Memoria operativa (compartida).
  findOperationalMemoryByKey(normalizedKey: string): Promise<CreamyOperationalMemory | null>;
  getOperationalMemory(id: string): Promise<CreamyOperationalMemory | null>;
  insertOperationalMemory(record: CreamyOperationalMemory): Promise<CreamyOperationalMemory>;
  updateOperationalMemory(
    id: string,
    patch: Partial<CreamyOperationalMemory>
  ): Promise<CreamyOperationalMemory | null>;
  listOperationalMemories(filter: {
    client?: string;
    product?: string;
    productCode?: string;
  }): Promise<CreamyOperationalMemory[]>;

  // Evidencia.
  insertEvidence(record: CreamyMemoryEvidence): Promise<CreamyMemoryEvidence>;
  listEvidence(operationalMemoryId: string): Promise<CreamyMemoryEvidence[]>;

  // Auditoría.
  insertAuditEvent(record: CreamyMemoryAuditEvent): Promise<CreamyMemoryAuditEvent>;
  listAuditEvents(entityType: string, entityId: string): Promise<CreamyMemoryAuditEvent[]>;
}
