import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { getDb, isDatabaseConfigured } from "@/lib/db/client";
import {
  assertFeatureWritesEnabled,
  isFeatureMemoryAllowed,
  isFeatureSchemaReady,
  SchemaPendingError,
} from "@/lib/db/feature-schema";
import {
  osInternalMessageRecipients,
  osInternalMessages,
  osNotifications,
} from "@/lib/db/schema";
import type { SectorId } from "@/types/operational/sector";
import { assertAvisoSender, canUseAvisos } from "./rbac";
import {
  AVISO_PARTICIPANT_SECTORS,
  type AvisoPriority,
  type AvisoRecord,
  type AvisoTab,
  type CreateAvisoInput,
} from "./types";

export type AvisoActor = { email: string; sector: SectorId };

type MemoryStore = {
  messages: AvisoRecord[];
  notifications: Array<{
    id: string;
    kind: string;
    title: string;
    message: string;
    sectors: SectorId[];
    href: string;
    readBy: string[];
    dismissedBy: string[];
    createdAt: string;
    idempotencyKey: string;
  }>;
};

const g = globalThis as unknown as { __genusAvisosMem?: MemoryStore };
function mem(): MemoryStore {
  if (!g.__genusAvisosMem) {
    g.__genusAvisosMem = { messages: [], notifications: [] };
  }
  return g.__genusAvisosMem;
}

function normalizePriority(p: string): AvisoPriority {
  if (p === "IMPORTANTE" || p === "URGENTE") return p;
  return "NORMAL";
}

function resolveTargets(input: CreateAvisoInput, fromSector: SectorId): SectorId[] {
  const all = [...AVISO_PARTICIPANT_SECTORS] as SectorId[];
  let targets = input.toAll
    ? all
    : [...new Set(input.toSectors.filter((s) => canUseAvisos(s)))];
  if (targets.length === 0) {
    throw new Error("Seleccioná al menos un destinatario.");
  }
  // Remitente siempre recibe copia en enviados; no forzamos auto-inbox.
  return targets;
}

async function emitAvisoNotifications(params: {
  messageId: string;
  title: string;
  priority: AvisoPriority;
  fromSector: SectorId;
  toSectors: SectorId[];
}): Promise<void> {
  const idempotencyKey = `aviso:${params.messageId}`;
  const title = `[${params.priority}] ${params.title}`;
  const message = `Nuevo aviso de ${params.fromSector}`;
  const href = "/avisos";

  if (isDatabaseConfigured()) {
    try {
      const db = getDb();
      // Idempotencia vía kind+href+title único aproximado: chequear existentes por mensaje.
      const existing = await db
        .select({ id: osNotifications.id })
        .from(osNotifications)
        .where(eq(osNotifications.href, `/avisos?id=${params.messageId}`))
        .limit(1);
      if (existing.length) return;
      await db.insert(osNotifications).values({
        kind: "aviso_interno",
        title,
        message,
        sectors: params.toSectors,
        href: `/avisos?id=${params.messageId}`,
        orderId: null,
        readBy: [],
        dismissedBy: [],
      });
      return;
    } catch {
      // fallback memoria
    }
  }

  const store = mem();
  if (store.notifications.some((n) => n.idempotencyKey === idempotencyKey)) return;
  store.notifications.push({
    id: randomUUID(),
    kind: "aviso_interno",
    title,
    message,
    sectors: params.toSectors,
    href,
    readBy: [],
    dismissedBy: [],
    createdAt: new Date().toISOString(),
    idempotencyKey,
  });
}

function toRecord(
  row: typeof osInternalMessages.$inferSelect,
  recipients: Array<typeof osInternalMessageRecipients.$inferSelect>
): AvisoRecord {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    priority: normalizePriority(row.priority),
    fromSector: row.fromSector as SectorId,
    fromEmail: row.fromEmail,
    toSectors: row.toSectors as SectorId[],
    recipients: recipients.map((r) => ({
      sector: r.sector as SectorId,
      readAt: r.readAt ? r.readAt.toISOString() : null,
      archivedAt: r.archivedAt ? r.archivedAt.toISOString() : null,
    })),
    createdAt: row.createdAt.toISOString(),
  };
}

export class AvisosService {
  async create(actor: AvisoActor, input: CreateAvisoInput): Promise<AvisoRecord> {
    assertAvisoSender(actor.sector);
    await assertFeatureWritesEnabled();
    const title = input.title.trim();
    const body = input.body.trim();
    if (!title) throw new Error("El título es obligatorio.");
    if (!body) throw new Error("El mensaje es obligatorio.");
    const toSectors = resolveTargets(input, actor.sector);
    const priority = normalizePriority(input.priority);
    const now = new Date();

    if (isDatabaseConfigured() && (await isFeatureSchemaReady())) {
      try {
        const db = getDb();
        const [msg] = await db
          .insert(osInternalMessages)
          .values({
            title,
            body,
            priority,
            fromSector: actor.sector,
            fromEmail: actor.email,
            toSectors,
            audit: {
              createdBy: actor.email,
              createdBySector: actor.sector,
              at: now.toISOString(),
              action: "create",
            },
          })
          .returning();
        if (!msg) throw new Error("No se pudo crear el aviso.");
        const recipientRows = toSectors.map((sector) => ({
          messageId: msg.id,
          sector,
        }));
        await db.insert(osInternalMessageRecipients).values(recipientRows);
        const recipients = await db
          .select()
          .from(osInternalMessageRecipients)
          .where(eq(osInternalMessageRecipients.messageId, msg.id));
        const record = toRecord(msg, recipients);
        await emitAvisoNotifications({
          messageId: record.id,
          title: record.title,
          priority: record.priority,
          fromSector: record.fromSector,
          toSectors: record.toSectors,
        });
        return record;
      } catch (err) {
        if (err instanceof SchemaPendingError) throw err;
        if (!isFeatureMemoryAllowed()) throw new SchemaPendingError();
      }
    }

    if (!isFeatureMemoryAllowed()) throw new SchemaPendingError();

    const id = randomUUID();
    const record: AvisoRecord = {
      id,
      title,
      body,
      priority,
      fromSector: actor.sector,
      fromEmail: actor.email,
      toSectors,
      recipients: toSectors.map((sector) => ({
        sector,
        readAt: null,
        archivedAt: null,
      })),
      createdAt: now.toISOString(),
    };
    mem().messages.unshift(record);
    await emitAvisoNotifications({
      messageId: id,
      title,
      priority,
      fromSector: actor.sector,
      toSectors,
    });
    return record;
  }

  async list(
    actor: AvisoActor,
    tab: AvisoTab,
    q = ""
  ): Promise<AvisoRecord[]> {
    assertAvisoSender(actor.sector);
    const query = q.trim().toLowerCase();
    const filterQ = (m: AvisoRecord) =>
      !query ||
      `${m.title} ${m.body} ${m.fromSector} ${m.priority}`.toLowerCase().includes(query);

    if (isDatabaseConfigured() && (await isFeatureSchemaReady())) {
      try {
        const db = getDb();
        if (tab === "enviados") {
          const rows = await db
            .select()
            .from(osInternalMessages)
            .where(eq(osInternalMessages.fromSector, actor.sector))
            .orderBy(desc(osInternalMessages.createdAt));
          const out: AvisoRecord[] = [];
          for (const row of rows) {
            const recipients = await db
              .select()
              .from(osInternalMessageRecipients)
              .where(eq(osInternalMessageRecipients.messageId, row.id));
            out.push(toRecord(row, recipients));
          }
          return out.filter(filterQ);
        }

        const archived = tab === "archivados";
        const recips = await db
          .select()
          .from(osInternalMessageRecipients)
          .where(
            and(
              eq(osInternalMessageRecipients.sector, actor.sector),
              archived
                ? isNotNull(osInternalMessageRecipients.archivedAt)
                : isNull(osInternalMessageRecipients.archivedAt)
            )
          );
        const ids = recips.map((r) => r.messageId);
        if (!ids.length) return [];
        const rows = await db
          .select()
          .from(osInternalMessages)
          .where(inArray(osInternalMessages.id, ids))
          .orderBy(desc(osInternalMessages.createdAt));
        const out: AvisoRecord[] = [];
        for (const row of rows) {
          const recipients = await db
            .select()
            .from(osInternalMessageRecipients)
            .where(eq(osInternalMessageRecipients.messageId, row.id));
          out.push(toRecord(row, recipients));
        }
        return out.filter(filterQ);
      } catch {
        if (!isFeatureMemoryAllowed()) return [];
      }
    }

    if (!isFeatureMemoryAllowed()) return [];

    const all = mem().messages;
    if (tab === "enviados") {
      return all.filter((m) => m.fromSector === actor.sector).filter(filterQ);
    }
    return all
      .filter((m) => {
        const mine = m.recipients.find((r) => r.sector === actor.sector);
        if (!mine) return false;
        if (tab === "archivados") return !!mine.archivedAt;
        return !mine.archivedAt;
      })
      .filter(filterQ);
  }

  async markRead(actor: AvisoActor, messageId: string): Promise<AvisoRecord | null> {
    assertAvisoSender(actor.sector);
    await assertFeatureWritesEnabled();
    const now = new Date();
    if (isDatabaseConfigured() && (await isFeatureSchemaReady())) {
      try {
        const db = getDb();
        await db
          .update(osInternalMessageRecipients)
          .set({ readAt: now })
          .where(
            and(
              eq(osInternalMessageRecipients.messageId, messageId),
              eq(osInternalMessageRecipients.sector, actor.sector),
              isNull(osInternalMessageRecipients.readAt)
            )
          );
        return this.getForActor(actor, messageId);
      } catch {
        if (!isFeatureMemoryAllowed()) throw new SchemaPendingError();
      }
    }
    if (!isFeatureMemoryAllowed()) throw new SchemaPendingError();
    const msg = mem().messages.find((m) => m.id === messageId);
    if (!msg) return null;
    const r = msg.recipients.find((x) => x.sector === actor.sector);
    if (r && !r.readAt) r.readAt = now.toISOString();
    return msg;
  }

  async archive(actor: AvisoActor, messageId: string): Promise<AvisoRecord | null> {
    assertAvisoSender(actor.sector);
    await assertFeatureWritesEnabled();
    const now = new Date();
    if (isDatabaseConfigured() && (await isFeatureSchemaReady())) {
      try {
        const db = getDb();
        await db
          .update(osInternalMessageRecipients)
          .set({ archivedAt: now })
          .where(
            and(
              eq(osInternalMessageRecipients.messageId, messageId),
              eq(osInternalMessageRecipients.sector, actor.sector)
            )
          );
        return this.getForActor(actor, messageId);
      } catch {
        if (!isFeatureMemoryAllowed()) throw new SchemaPendingError();
      }
    }
    if (!isFeatureMemoryAllowed()) throw new SchemaPendingError();
    const msg = mem().messages.find((m) => m.id === messageId);
    if (!msg) return null;
    const r = msg.recipients.find((x) => x.sector === actor.sector);
    if (r) r.archivedAt = now.toISOString();
    return msg;
  }

  /** Restaura un aviso archivado a la bandeja del receptor (limpia archivedAt). */
  async restore(actor: AvisoActor, messageId: string): Promise<AvisoRecord | null> {
    assertAvisoSender(actor.sector);
    await assertFeatureWritesEnabled();
    if (isDatabaseConfigured() && (await isFeatureSchemaReady())) {
      try {
        const db = getDb();
        await db
          .update(osInternalMessageRecipients)
          .set({ archivedAt: null })
          .where(
            and(
              eq(osInternalMessageRecipients.messageId, messageId),
              eq(osInternalMessageRecipients.sector, actor.sector)
            )
          );
        return this.getForActor(actor, messageId);
      } catch {
        if (!isFeatureMemoryAllowed()) throw new SchemaPendingError();
      }
    }
    if (!isFeatureMemoryAllowed()) throw new SchemaPendingError();
    const msg = mem().messages.find((m) => m.id === messageId);
    if (!msg) return null;
    const r = msg.recipients.find((x) => x.sector === actor.sector);
    if (r) r.archivedAt = null;
    return msg;
  }

  async getForActor(actor: AvisoActor, messageId: string): Promise<AvisoRecord | null> {
    const list = [
      ...(await this.list(actor, "recibidos")),
      ...(await this.list(actor, "enviados")),
      ...(await this.list(actor, "archivados")),
    ];
    return list.find((m) => m.id === messageId) ?? null;
  }
}

let singleton: AvisosService | null = null;
export function getAvisosService(): AvisosService {
  if (!singleton) singleton = new AvisosService();
  return singleton;
}

/** Solo tests. */
export function resetAvisosMemoryForTests(): void {
  g.__genusAvisosMem = { messages: [], notifications: [] };
  singleton = null;
}
