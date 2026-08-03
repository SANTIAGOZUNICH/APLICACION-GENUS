import { randomUUID } from "node:crypto";
import type { CreamyMemoryRepository } from "@/lib/creamy-memory/repository";
import {
  canMutateUserMemory,
  canReadOperationalMemory,
  canReadUserMemory,
  canReportOperationalMemory,
  canValidateOperationalMemory,
} from "@/lib/creamy-memory/rbac";
import { isTestLikeValue, normalizeMemoryKey } from "@/lib/creamy-memory/sanitize";
import {
  CreamyMemoryForbiddenError,
  CreamyMemoryNotFoundError,
  CreamyMemoryValidationError,
  type CorrectOperationalMemoryPatch,
  type CreamyContradictionGroup,
  type CreamyMemoryActor,
  type CreamyMemoryAuditAction,
  type CreamyMemoryEntityType,
  type CreamyOperationalMemory,
  type CreamyUserMemory,
  type CreateOperationalMemoryInput,
  type SearchOperationalMemoriesFilter,
  type UpsertUserMemoryInput,
} from "@/lib/creamy-memory/types";

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Ownership: prefer stable userId when both sides have it; else email (0015 legacy rows). */
function ownsUserMemory(
  actor: CreamyMemoryActor,
  memory: Pick<CreamyUserMemory, "userEmail" | "userId">,
  targetEmail = actor.email
): boolean {
  if (actor.userId && memory.userId) {
    return memory.userId === actor.userId;
  }
  return normalizeEmail(memory.userEmail) === normalizeEmail(targetEmail);
}

export interface CreateOperationalMemoryResult {
  memory: CreamyOperationalMemory;
  deduped: boolean;
}

/**
 * Reglas de negocio de la memoria de Creamy.
 * - Nunca auto-valida hechos operativos reportados desde el chat.
 * - Nunca lee ni escribe el banco de fórmulas (formula_bank / 842 / 784).
 * - Deduplica memoria operativa por clave normalizada (client+product+original+utilizada).
 */
export class CreamyMemoryService {
  constructor(private readonly repo: CreamyMemoryRepository) {}

  // ---------------------------------------------------------------------
  // Memoria personal
  // ---------------------------------------------------------------------

  async upsertUserMemory(actor: CreamyMemoryActor, input: UpsertUserMemoryInput): Promise<CreamyUserMemory> {
    const content = input.content?.trim() ?? "";
    const memoryType = input.memoryType?.trim() ?? "";
    if (!content) throw new CreamyMemoryValidationError("El contenido de la memoria no puede estar vacío.");
    if (!memoryType) throw new CreamyMemoryValidationError("Falta el tipo de memoria (memoryType).");

    const normalizedKey = normalizeMemoryKey(`${memoryType}|${content}`);
    const owner = { userEmail: actor.email, userId: actor.userId };
    const existing = await this.repo.findUserMemoryByKey(owner, normalizedKey);
    const now = nowIso();

    if (existing) {
      const updated = await this.repo.updateUserMemory(existing.id, {
        content,
        updatedAt: now,
        lastUsedAt: now,
        sourceConversationId: input.sourceConversationId ?? existing.sourceConversationId,
      });
      await this.audit("user_memory", existing.id, "UPDATE", actor, { memoryType });
      return updated as CreamyUserMemory;
    }

    const record: CreamyUserMemory = {
      id: randomUUID(),
      userEmail: actor.email,
      userId: actor.userId ?? null,
      sector: actor.sector,
      memoryType,
      content,
      normalizedKey,
      createdAt: now,
      updatedAt: now,
      lastUsedAt: now,
      status: "active",
      sourceConversationId: input.sourceConversationId ?? null,
    };
    const inserted = await this.repo.insertUserMemory(record);
    await this.audit("user_memory", inserted.id, "CREATE", actor, { memoryType });
    return inserted;
  }

  async listUserMemories(actor: CreamyMemoryActor, targetEmail: string, limit = 5): Promise<CreamyUserMemory[]> {
    if (!canReadUserMemory(actor.email, targetEmail)) {
      await this.audit("user_memory", targetEmail, "READ_DENIED", actor, {});
      throw new CreamyMemoryForbiddenError("Solo el propio usuario puede leer su memoria personal.");
    }
    // targetEmail was authorized above; durable ownership is still session userId when available.
    const list = await this.repo.listUserMemories({ userEmail: targetEmail, userId: actor.userId });
    return list.slice(0, Math.max(1, Math.min(50, limit)));
  }

  async softDeleteUserMemory(actor: CreamyMemoryActor, targetEmail: string, id: string): Promise<CreamyUserMemory> {
    if (!canMutateUserMemory(actor.email, targetEmail)) {
      throw new CreamyMemoryForbiddenError("Solo el propio usuario puede olvidar su memoria personal.");
    }
    const current = await this.repo.getUserMemory(id);
    if (!current || !ownsUserMemory(actor, current, targetEmail)) {
      throw new CreamyMemoryNotFoundError("Memoria personal no encontrada.");
    }
    const updated = await this.repo.updateUserMemory(id, { status: "deleted", updatedAt: nowIso() });
    await this.audit("user_memory", id, "FORGET", actor, {});
    return updated as CreamyUserMemory;
  }

  async confirmUserMemory(actor: CreamyMemoryActor, id: string): Promise<CreamyUserMemory> {
    const current = await this.repo.getUserMemory(id);
    if (!current) throw new CreamyMemoryNotFoundError("Memoria personal no encontrada.");
    if (!canMutateUserMemory(actor.email, current.userEmail) || !ownsUserMemory(actor, current)) {
      throw new CreamyMemoryForbiddenError("Solo el propio usuario puede confirmar su memoria personal.");
    }
    const updated = await this.repo.updateUserMemory(id, { lastUsedAt: nowIso(), status: "active" });
    await this.audit("user_memory", id, "CONFIRM", actor, {});
    return updated as CreamyUserMemory;
  }

  // ---------------------------------------------------------------------
  // Memoria operativa compartida
  // ---------------------------------------------------------------------

  async createOperationalMemory(
    actor: CreamyMemoryActor,
    input: CreateOperationalMemoryInput
  ): Promise<CreateOperationalMemoryResult> {
    if (!canReportOperationalMemory(actor.sector)) {
      throw new CreamyMemoryForbiddenError("Tu sector no puede reportar hechos operativos a Creamy.");
    }
    const candidates = [input.client, input.product, input.productCode, input.materiaPrimaOriginal, input.materiaPrimaUtilizada];
    if (candidates.some(isTestLikeValue)) {
      throw new CreamyMemoryValidationError(
        "No se registran datos operativos con valores de prueba (TEST_/fixture/mock)."
      );
    }
    if (
      !input.client?.trim() ||
      !input.product?.trim() ||
      !input.materiaPrimaOriginal?.trim() ||
      !input.materiaPrimaUtilizada?.trim() ||
      !input.motivo?.trim()
    ) {
      throw new CreamyMemoryValidationError(
        "Faltan datos obligatorios (cliente, producto, MP original, MP utilizada, motivo)."
      );
    }

    const normalizedKey = normalizeMemoryKey(
      `${input.client}|${input.product}|${input.materiaPrimaOriginal}|${input.materiaPrimaUtilizada}`
    );
    const existing = await this.repo.findOperationalMemoryByKey(normalizedKey);
    const now = nowIso();

    if (existing) {
      const updated = await this.repo.updateOperationalMemory(existing.id, {
        motivo: input.motivo.trim(),
        observacion: input.observacion?.trim() || existing.observacion,
        cantidadOProporcion: input.cantidadOProporcion?.trim() || existing.cantidadOProporcion,
        relatedOrderRef: input.relatedOrderRef?.trim() || existing.relatedOrderRef,
        relatedOrderId: input.relatedOrderId?.trim() || existing.relatedOrderId,
        updatedAt: now,
      });
      await this.audit("operational_memory", existing.id, "UPDATE", actor, { reason: "dedupe_on_create" });
      return { memory: updated as CreamyOperationalMemory, deduped: true };
    }

    const record: CreamyOperationalMemory = {
      id: randomUUID(),
      client: input.client.trim(),
      product: input.product.trim(),
      productCode: input.productCode?.trim() || null,
      materiaPrimaOriginal: input.materiaPrimaOriginal.trim(),
      materiaPrimaUtilizada: input.materiaPrimaUtilizada.trim(),
      codigoMpOriginal: input.codigoMpOriginal?.trim() || null,
      codigoMpUtilizado: input.codigoMpUtilizado?.trim() || null,
      motivo: input.motivo.trim(),
      observacion: input.observacion?.trim() || null,
      cantidadOProporcion: input.cantidadOProporcion?.trim() || null,
      relatedOrderRef: input.relatedOrderRef?.trim() || null,
      relatedOrderId: input.relatedOrderId?.trim() || null,
      fecha: input.fecha ?? null,
      informadoPor: actor.email,
      validadoPor: null,
      // Siempre REPORTADA + CHAT: Creamy nunca auto-valida un hecho operativo.
      estado: "REPORTADA",
      fuente: "CHAT",
      evidenceId: null,
      normalizedKey,
      createdAt: now,
      updatedAt: now,
      status: "active",
    };
    const inserted = await this.repo.insertOperationalMemory(record);
    await this.audit("operational_memory", inserted.id, "CREATE", actor, { fuente: "CHAT" });
    return { memory: inserted, deduped: false };
  }

  async searchOperationalMemories(
    actor: CreamyMemoryActor,
    filter: SearchOperationalMemoriesFilter
  ): Promise<CreamyOperationalMemory[]> {
    if (!canReadOperationalMemory(actor.sector)) {
      throw new CreamyMemoryForbiddenError("Tu sector no puede consultar la memoria operativa.");
    }
    const list = await this.repo.listOperationalMemories({
      client: filter.client,
      product: filter.product,
      productCode: filter.productCode,
    });
    const limit = Math.max(1, Math.min(20, filter.limit ?? 5));
    return list
      .filter((memory) => filter.includeRevoked || memory.estado !== "REVOCADA")
      .filter(
        (memory) =>
          !isTestLikeValue(memory.client) &&
          !isTestLikeValue(memory.product) &&
          !isTestLikeValue(memory.productCode)
      )
      .slice(0, limit);
  }

  async validateOperationalMemory(actor: CreamyMemoryActor, id: string): Promise<CreamyOperationalMemory> {
    if (!canValidateOperationalMemory(actor.sector)) {
      throw new CreamyMemoryForbiddenError("Solo Calidad, Producción o Dirección pueden validar hechos operativos.");
    }
    const current = await this.repo.getOperationalMemory(id);
    if (!current) throw new CreamyMemoryNotFoundError("Memoria operativa no encontrada.");
    if (current.estado === "REVOCADA") {
      throw new CreamyMemoryValidationError("No se puede validar un hecho revocado.");
    }
    const updated = await this.repo.updateOperationalMemory(id, {
      estado: "VALIDADA",
      validadoPor: actor.email,
      updatedAt: nowIso(),
    });
    await this.audit("operational_memory", id, "VALIDATE", actor, {});
    return updated as CreamyOperationalMemory;
  }

  async revokeOperationalMemory(
    actor: CreamyMemoryActor,
    id: string,
    reason?: string
  ): Promise<CreamyOperationalMemory> {
    if (!canValidateOperationalMemory(actor.sector)) {
      throw new CreamyMemoryForbiddenError("Solo Calidad, Producción o Dirección pueden revocar hechos operativos.");
    }
    const current = await this.repo.getOperationalMemory(id);
    if (!current) throw new CreamyMemoryNotFoundError("Memoria operativa no encontrada.");
    const updated = await this.repo.updateOperationalMemory(id, {
      estado: "REVOCADA",
      validadoPor: actor.email,
      updatedAt: nowIso(),
    });
    await this.audit("operational_memory", id, "REVOKE", actor, { reason: reason?.trim() || null });
    return updated as CreamyOperationalMemory;
  }

  async correctOperationalMemory(
    actor: CreamyMemoryActor,
    id: string,
    patch: CorrectOperationalMemoryPatch
  ): Promise<CreamyOperationalMemory> {
    const current = await this.repo.getOperationalMemory(id);
    if (!current) throw new CreamyMemoryNotFoundError("Memoria operativa no encontrada.");

    const isOwner = normalizeEmail(current.informadoPor) === normalizeEmail(actor.email);
    if (!isOwner && !canValidateOperationalMemory(actor.sector)) {
      throw new CreamyMemoryForbiddenError(
        "Solo quien reportó el hecho, o Calidad/Producción/Dirección, puede corregirlo."
      );
    }
    if (patch.materiaPrimaUtilizada !== undefined && isTestLikeValue(patch.materiaPrimaUtilizada)) {
      throw new CreamyMemoryValidationError("No se registran correcciones con valores de prueba (TEST_).");
    }

    const before = {
      motivo: current.motivo,
      materiaPrimaUtilizada: current.materiaPrimaUtilizada,
      codigoMpUtilizado: current.codigoMpUtilizado,
      observacion: current.observacion,
      cantidadOProporcion: current.cantidadOProporcion,
      estado: current.estado,
    };
    // Una corrección invalida una validación previa: vuelve a REPORTADA para re-revisión.
    const nextEstado = current.estado === "VALIDADA" ? "REPORTADA" : current.estado;
    const updated = await this.repo.updateOperationalMemory(id, {
      ...patch,
      estado: nextEstado,
      validadoPor: nextEstado === "REPORTADA" ? null : current.validadoPor,
      updatedAt: nowIso(),
    });
    await this.audit("operational_memory", id, "CORRECT", actor, { before, after: patch });
    return updated as CreamyOperationalMemory;
  }

  /**
   * Agrupa por client+product+materiaPrimaOriginal y marca contradicciones
   * cuando hay más de una materiaPrimaUtilizada distinta reportada (activa, no revocada).
   */
  detectContradictions(memories: CreamyOperationalMemory[]): CreamyContradictionGroup[] {
    const groups = new Map<string, CreamyOperationalMemory[]>();
    for (const memory of memories) {
      if (memory.estado === "REVOCADA") continue;
      const key = normalizeMemoryKey(`${memory.client}|${memory.product}|${memory.materiaPrimaOriginal}`);
      const list = groups.get(key) ?? [];
      list.push(memory);
      groups.set(key, list);
    }
    const contradictions: CreamyContradictionGroup[] = [];
    for (const [key, list] of groups) {
      const distinctUtilizada = new Set(list.map((m) => normalizeMemoryKey(m.materiaPrimaUtilizada)));
      if (distinctUtilizada.size > 1) {
        const [first] = list;
        contradictions.push({
          key,
          client: first.client,
          product: first.product,
          materiaPrimaOriginal: first.materiaPrimaOriginal,
          memories: list,
        });
      }
    }
    return contradictions;
  }

  private async audit(
    entityType: CreamyMemoryEntityType,
    entityId: string,
    action: CreamyMemoryAuditAction,
    actor: CreamyMemoryActor,
    detail: Record<string, unknown>
  ): Promise<void> {
    await this.repo.insertAuditEvent({
      id: randomUUID(),
      entityType,
      entityId,
      action,
      actorEmail: actor.email,
      actorSector: actor.sector,
      detail,
      createdAt: nowIso(),
    });
  }
}
