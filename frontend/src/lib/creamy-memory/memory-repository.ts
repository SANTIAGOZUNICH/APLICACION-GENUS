import { randomUUID } from "node:crypto";
import type { CreamyMemoryRepository } from "@/lib/creamy-memory/repository";
import type {
  CreamyMemoryAuditEvent,
  CreamyMemoryEvidence,
  CreamyOperationalMemory,
  CreamyUserMemory,
} from "@/lib/creamy-memory/types";

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Repositorio en memoria — usado en unit tests y como fallback de proceso
 * mientras la migración 0015 no está aplicada (ver get-creamy-memory-service.ts).
 * No es durable: vive únicamente en el Map mientras el proceso esté activo.
 */
export class MemoryCreamyMemoryRepository implements CreamyMemoryRepository {
  private userMemories = new Map<string, CreamyUserMemory>();
  private operationalMemories = new Map<string, CreamyOperationalMemory>();
  private evidence = new Map<string, CreamyMemoryEvidence>();
  private auditEvents: CreamyMemoryAuditEvent[] = [];

  async findUserMemoryByKey(owner: { userEmail: string; userId?: string }, normalizedKey: string): Promise<CreamyUserMemory | null> {
    const email = normalizeEmail(owner.userEmail);
    for (const memory of this.userMemories.values()) {
      const owns =
        owner.userId && memory.userId
          ? memory.userId === owner.userId
          : normalizeEmail(memory.userEmail) === email;
      if (memory.status === "active" && owns && memory.normalizedKey === normalizedKey) {
        return structuredClone(memory);
      }
    }
    return null;
  }

  async getUserMemory(id: string): Promise<CreamyUserMemory | null> {
    const memory = this.userMemories.get(id);
    return memory ? structuredClone(memory) : null;
  }

  async insertUserMemory(record: CreamyUserMemory): Promise<CreamyUserMemory> {
    this.userMemories.set(record.id, structuredClone(record));
    return structuredClone(record);
  }

  async updateUserMemory(id: string, patch: Partial<CreamyUserMemory>): Promise<CreamyUserMemory | null> {
    const current = this.userMemories.get(id);
    if (!current) return null;
    const updated = { ...current, ...patch };
    this.userMemories.set(id, updated);
    return structuredClone(updated);
  }

  async listUserMemories(owner: { userEmail: string; userId?: string }): Promise<CreamyUserMemory[]> {
    const email = normalizeEmail(owner.userEmail);
    return [...this.userMemories.values()]
      .filter((memory) => {
        const owns =
          owner.userId && memory.userId
            ? memory.userId === owner.userId
            : normalizeEmail(memory.userEmail) === email;
        return owns && memory.status === "active";
      })
      .sort((a, b) => (b.updatedAt > a.updatedAt ? 1 : -1))
      .map((memory) => structuredClone(memory));
  }

  async findOperationalMemoryByKey(normalizedKey: string): Promise<CreamyOperationalMemory | null> {
    for (const memory of this.operationalMemories.values()) {
      if (memory.status === "active" && memory.normalizedKey === normalizedKey && memory.estado !== "REVOCADA") {
        return structuredClone(memory);
      }
    }
    return null;
  }

  async getOperationalMemory(id: string): Promise<CreamyOperationalMemory | null> {
    const memory = this.operationalMemories.get(id);
    return memory ? structuredClone(memory) : null;
  }

  async insertOperationalMemory(record: CreamyOperationalMemory): Promise<CreamyOperationalMemory> {
    this.operationalMemories.set(record.id, structuredClone(record));
    return structuredClone(record);
  }

  async updateOperationalMemory(
    id: string,
    patch: Partial<CreamyOperationalMemory>
  ): Promise<CreamyOperationalMemory | null> {
    const current = this.operationalMemories.get(id);
    if (!current) return null;
    const updated = { ...current, ...patch };
    this.operationalMemories.set(id, updated);
    return structuredClone(updated);
  }

  async listOperationalMemories(filter: {
    client?: string;
    product?: string;
    productCode?: string;
  }): Promise<CreamyOperationalMemory[]> {
    const client = filter.client?.trim().toLowerCase();
    const product = filter.product?.trim().toLowerCase();
    const productCode = filter.productCode?.trim().toLowerCase();
    return [...this.operationalMemories.values()]
      .filter((memory) => memory.status === "active")
      .filter((memory) => !client || memory.client.toLowerCase().includes(client))
      .filter((memory) => !product || memory.product.toLowerCase().includes(product))
      .filter((memory) => !productCode || (memory.productCode ?? "").toLowerCase().includes(productCode))
      .sort((a, b) => (b.updatedAt > a.updatedAt ? 1 : -1))
      .map((memory) => structuredClone(memory));
  }

  async insertEvidence(record: CreamyMemoryEvidence): Promise<CreamyMemoryEvidence> {
    this.evidence.set(record.id, structuredClone(record));
    return structuredClone(record);
  }

  async listEvidence(operationalMemoryId: string): Promise<CreamyMemoryEvidence[]> {
    return [...this.evidence.values()]
      .filter((item) => item.operationalMemoryId === operationalMemoryId)
      .map((item) => structuredClone(item));
  }

  async insertAuditEvent(record: CreamyMemoryAuditEvent): Promise<CreamyMemoryAuditEvent> {
    this.auditEvents.push(structuredClone(record));
    return structuredClone(record);
  }

  async listAuditEvents(entityType: string, entityId: string): Promise<CreamyMemoryAuditEvent[]> {
    return this.auditEvents
      .filter((event) => event.entityType === entityType && event.entityId === entityId)
      .map((event) => structuredClone(event));
  }
}

export function makeMemoryRecordId(): string {
  return randomUUID();
}
