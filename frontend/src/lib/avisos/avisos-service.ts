import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
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
  osInternalMessageUsers,
  osNotifications,
} from "@/lib/db/schema";
import { SECTOR_LABELS } from "@/types/operational/sector";
import { listAvisoDirectory, type AvisoDirectoryUser } from "./directory";
import type { SectorId } from "@/types/operational/sector";
import { assertAvisoSender, canUseAvisos } from "./rbac";
import {
  AVISO_PARTICIPANT_SECTORS,
  type AvisoPriority,
  type AvisoRecord,
  type AvisoTab,
  type AvisoUserRecipient,
  type CreateAvisoInput,
} from "./types";

export type AvisoActor = { email: string; sector: SectorId; displayName?: string };

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
    targetEmails?: string[] | null;
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

export type ResolvedUser = { email: string; name: string; sector: SectorId; via: "USUARIO" | "RESPONSABLE" };

/**
 * Destinatarios de un aviso: sectores completos (como siempre), personas concretas y/o «solo los responsables» de
 * sectores. Valida que cada persona exista y esté activa; quien envía no se avisa a sí mismo; una persona de un sector
 * ya incluido completo no se repite.
 */
export async function resolveRecipients(
  actor: AvisoActor,
  input: CreateAvisoInput,
  directory: () => Promise<AvisoDirectoryUser[]> = listAvisoDirectory
): Promise<{ sectorWide: SectorId[]; users: ResolvedUser[] }> {
  const wantedSectors = input.toAll || input.toSectors?.length ? resolveTargetsLoose(input, actor.sector) : [];
  const emails = [...new Set((input.toUsers ?? []).map((e) => String(e).trim().toLowerCase()).filter(Boolean))];
  const sectorWide = input.onlyResponsables ? [] : wantedSectors;
  const users = new Map<string, ResolvedUser>();
  if (emails.length > 0 || (input.onlyResponsables && wantedSectors.length > 0)) {
    const dir = await directory();
    if (dir.length === 0) throw new Error("No se pudo consultar el directorio de usuarios para elegir destinatarios.");
    const byEmail = new Map(dir.map((u) => [u.email.toLowerCase(), u]));
    for (const e of emails) {
      const u = byEmail.get(e);
      if (!u) throw new Error(`No existe un usuario activo con el correo ${e}.`);
      users.set(e, { email: u.email, name: u.name, sector: u.sector, via: "USUARIO" });
    }
    if (input.onlyResponsables) {
      for (const sector of wantedSectors) {
        const resp = dir.filter((u) => u.sector === sector && u.responsable);
        if (resp.length === 0) throw new Error(`${SECTOR_LABELS[sector]} no tiene responsables cargados: elegí personas concretas.`);
        for (const u of resp) if (!users.has(u.email.toLowerCase())) users.set(u.email.toLowerCase(), { email: u.email, name: u.name, sector: u.sector, via: "RESPONSABLE" });
      }
    }
  }
  const final = [...users.values()].filter((u) => u.email.toLowerCase() !== actor.email.toLowerCase() && !sectorWide.includes(u.sector));
  if (sectorWide.length === 0 && final.length === 0) throw new Error("Seleccioná al menos un destinatario.");
  return { sectorWide, users: final };
}

function resolveTargetsLoose(input: CreateAvisoInput, fromSector: SectorId): SectorId[] {
  try {
    return resolveTargets(input, fromSector);
  } catch {
    return [];
  }
}

function noticeText(actor: AvisoActor, body: string): string {
  const from = SECTOR_LABELS[actor.sector] ?? actor.sector;
  const who = actor.displayName?.trim() || actor.email;
  const text = body.length > 600 ? `${body.slice(0, 600)}…` : body;
  return `De: ${from} — ${who}\n${text}`;
}

async function emitAvisoNotifications(params: {
  messageId: string;
  title: string;
  priority: AvisoPriority;
  actor: AvisoActor;
  body: string;
  sectorWide: SectorId[];
  users: ResolvedUser[];
}): Promise<void> {
  const title = `[${params.priority}] ${params.title}`;
  const message = noticeText(params.actor, params.body);
  const drafts: Array<{ key: string; sectors: SectorId[]; targetEmails: string[] | null }> = [];
  if (params.sectorWide.length) drafts.push({ key: "sectors", sectors: params.sectorWide, targetEmails: null });
  if (params.users.length) drafts.push({ key: "users", sectors: [...new Set(params.users.map((u) => u.sector))], targetEmails: params.users.map((u) => u.email) });

  for (const d of drafts) {
    const href = `/avisos?id=${params.messageId}${d.key === "users" ? "&dest=u" : ""}`;
    const idempotencyKey = `aviso:${params.messageId}:${d.key}`;
    if (isDatabaseConfigured()) {
      try {
        const db = getDb();
        const existing = await db.select({ id: osNotifications.id }).from(osNotifications).where(eq(osNotifications.href, href)).limit(1);
        if (existing.length) continue;
        await db.insert(osNotifications).values({
          kind: "aviso_interno",
          title,
          message,
          sectors: d.sectors,
          href,
          orderId: null,
          readBy: [],
          dismissedBy: [],
          deletedBy: [],
          targetEmails: d.targetEmails,
        });
        continue;
      } catch {
        // fallback memoria
      }
    }
    const store = mem();
    if (store.notifications.some((n) => n.idempotencyKey === idempotencyKey)) continue;
    store.notifications.push({
      id: randomUUID(),
      kind: "aviso_interno",
      title,
      message,
      sectors: d.sectors,
      href,
      readBy: [],
      dismissedBy: [],
      targetEmails: d.targetEmails,
      createdAt: new Date().toISOString(),
      idempotencyKey,
    });
  }
}

/** Estado del aviso para quien lo consulta: su fila individual si la tiene; si no, la de su sector. */
function mineOf(viewer: AvisoActor, sectorRows: Array<{ sector: SectorId; readAt: string | null; archivedAt: string | null }>, userRows: AvisoUserRecipient[]) {
  const u = userRows.find((x) => x.email.toLowerCase() === viewer.email.toLowerCase());
  if (u) return { readAt: u.readAt, archivedAt: u.archivedAt };
  const r = sectorRows.find((x) => x.sector === viewer.sector);
  return r ? { readAt: r.readAt, archivedAt: r.archivedAt } : null;
}

function toRecord(
  row: typeof osInternalMessages.$inferSelect,
  recipients: Array<typeof osInternalMessageRecipients.$inferSelect>,
  userRows: Array<typeof osInternalMessageUsers.$inferSelect> = [],
  viewer?: AvisoActor
): AvisoRecord {
  const userRecipients: AvisoUserRecipient[] = userRows.map((u) => ({
    email: u.userEmail,
    name: u.userName,
    sector: u.sector as SectorId,
    via: u.via === "RESPONSABLE" ? "RESPONSABLE" : "USUARIO",
    readAt: u.readAt ? u.readAt.toISOString() : null,
    archivedAt: u.archivedAt ? u.archivedAt.toISOString() : null,
  }));
  const audit = (row.audit ?? {}) as { createdByName?: string };
  return {
    userRecipients,
    fromName: audit.createdByName,
    mine: viewer ? mineOf(viewer, recipients.map((r) => ({ sector: r.sector as SectorId, readAt: r.readAt ? r.readAt.toISOString() : null, archivedAt: r.archivedAt ? r.archivedAt.toISOString() : null })), userRecipients) : undefined,
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
  constructor(private readonly directory: () => Promise<AvisoDirectoryUser[]> = listAvisoDirectory) {}

  async create(actor: AvisoActor, input: CreateAvisoInput): Promise<AvisoRecord> {
    assertAvisoSender(actor.sector);
    await assertFeatureWritesEnabled();
    const title = input.title.trim();
    const body = input.body.trim();
    if (!title) throw new Error("El título es obligatorio.");
    if (!body) throw new Error("El mensaje es obligatorio.");
    const { sectorWide, users } = await resolveRecipients(actor, input, this.directory);
    const priority = normalizePriority(input.priority);
    const now = new Date();
    const audit = { createdBy: actor.email, createdByName: actor.displayName ?? null, createdBySector: actor.sector, at: now.toISOString(), action: "create" };

    if (isDatabaseConfigured() && (await isFeatureSchemaReady())) {
      try {
        const db = getDb();
        const [msg] = await db
          .insert(osInternalMessages)
          .values({ title, body, priority, fromSector: actor.sector, fromEmail: actor.email, toSectors: sectorWide, audit })
          .returning();
        if (!msg) throw new Error("No se pudo crear el aviso.");
        if (sectorWide.length) await db.insert(osInternalMessageRecipients).values(sectorWide.map((sector) => ({ messageId: msg.id, sector })));
        if (users.length) {
          await db.insert(osInternalMessageUsers).values(users.map((u) => ({ messageId: msg.id, userEmail: u.email, userName: u.name, sector: u.sector, via: u.via })));
        }
        const recipients = await db.select().from(osInternalMessageRecipients).where(eq(osInternalMessageRecipients.messageId, msg.id));
        const userRows = await db.select().from(osInternalMessageUsers).where(eq(osInternalMessageUsers.messageId, msg.id));
        const record = toRecord(msg, recipients, userRows, actor);
        await emitAvisoNotifications({ messageId: record.id, title: record.title, priority: record.priority, actor, body, sectorWide, users });
        return record;
      } catch (err) {
        if (err instanceof SchemaPendingError) throw err;
        // Sin la migración de destinatarios individuales no se puede enviar a personas: se informa (nunca se envía a otro alcance).
        if (users.length && /os_internal_message_users|target_emails/i.test(String((err as Error)?.message ?? ""))) {
          throw new SchemaPendingError();
        }
        if (!isFeatureMemoryAllowed()) throw err instanceof Error ? err : new SchemaPendingError();
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
      fromName: actor.displayName,
      toSectors: sectorWide,
      recipients: sectorWide.map((sector) => ({ sector, readAt: null, archivedAt: null })),
      userRecipients: users.map((u) => ({ email: u.email, name: u.name, sector: u.sector, via: u.via, readAt: null, archivedAt: null })),
      createdAt: now.toISOString(),
    };
    mem().messages.unshift(record);
    await emitAvisoNotifications({ messageId: id, title, priority, actor, body, sectorWide, users });
    return { ...record, mine: mineOf(actor, record.recipients, record.userRecipients) };
  }

  async list(actor: AvisoActor, tab: AvisoTab, q = ""): Promise<AvisoRecord[]> {
    assertAvisoSender(actor.sector);
    const query = q.trim().toLowerCase();
    const filterQ = (m: AvisoRecord) =>
      !query || `${m.title} ${m.body} ${m.fromSector} ${m.priority}`.toLowerCase().includes(query);
    const me = actor.email.toLowerCase();

    if (isDatabaseConfigured() && (await isFeatureSchemaReady())) {
      try {
        const db = getDb();
        const build = async (rows: Array<typeof osInternalMessages.$inferSelect>) => {
          const out: AvisoRecord[] = [];
          for (const row of rows) {
            const recipients = await db.select().from(osInternalMessageRecipients).where(eq(osInternalMessageRecipients.messageId, row.id));
            const userRows = await db.select().from(osInternalMessageUsers).where(eq(osInternalMessageUsers.messageId, row.id));
            out.push(toRecord(row, recipients, userRows, actor));
          }
          return out.filter(filterQ);
        };
        if (tab === "enviados") {
          // Los envía la persona (o su sector, como hasta ahora): se ven los de todo el sector.
          const rows = await db.select().from(osInternalMessages).where(eq(osInternalMessages.fromSector, actor.sector)).orderBy(desc(osInternalMessages.createdAt));
          return build(rows);
        }
        const archived = tab === "archivados";
        const sectorRecips = await db
          .select({ messageId: osInternalMessageRecipients.messageId })
          .from(osInternalMessageRecipients)
          .where(and(eq(osInternalMessageRecipients.sector, actor.sector), archived ? isNotNull(osInternalMessageRecipients.archivedAt) : isNull(osInternalMessageRecipients.archivedAt)));
        // Si la persona tiene fila individual, MANDA su estado: el archivado del sector no la afecta (y viceversa).
        const myRows = await db.select().from(osInternalMessageUsers).where(eq(osInternalMessageUsers.userEmail, actor.email));
        const myById = new Map(myRows.map((r) => [r.messageId, r]));
        const ids = new Set<string>();
        for (const r of sectorRecips) if (!myById.has(r.messageId)) ids.add(r.messageId);
        for (const r of myRows) if (archived ? r.archivedAt != null : r.archivedAt == null) ids.add(r.messageId);
        if (!ids.size) return [];
        const rows = await db.select().from(osInternalMessages).where(inArray(osInternalMessages.id, [...ids])).orderBy(desc(osInternalMessages.createdAt));
        return build(rows);
      } catch {
        if (!isFeatureMemoryAllowed()) return [];
      }
    }

    if (!isFeatureMemoryAllowed()) return [];

    const all = mem().messages;
    if (tab === "enviados") {
      return all.filter((m) => m.fromSector === actor.sector).map((m) => ({ ...m, mine: mineOf(actor, m.recipients, m.userRecipients) })).filter(filterQ);
    }
    return all
      .map((m) => ({ ...m, mine: mineOf(actor, m.recipients, m.userRecipients) }))
      .filter((m) => {
        const hasUser = m.userRecipients.some((u) => u.email.toLowerCase() === me);
        if (!m.mine || (!hasUser && !m.recipients.some((r) => r.sector === actor.sector))) return false;
        return tab === "archivados" ? !!m.mine.archivedAt : !m.mine.archivedAt;
      })
      .filter(filterQ);
  }

  /** Aplica `patch` a la fila INDIVIDUAL de quien consulta (si la tiene) o, si no, a la de su sector. Nunca a las de otros. */
  private async patchMine(actor: AvisoActor, messageId: string, patch: { readAt?: Date; archivedAt?: Date | null }, onlyIfUnread = false): Promise<AvisoRecord | null> {
    assertAvisoSender(actor.sector);
    await assertFeatureWritesEnabled();
    if (isDatabaseConfigured() && (await isFeatureSchemaReady())) {
      try {
        const db = getDb();
        const [own] = await db.select({ id: osInternalMessageUsers.id }).from(osInternalMessageUsers).where(and(eq(osInternalMessageUsers.messageId, messageId), eq(osInternalMessageUsers.userEmail, actor.email))).limit(1);
        if (own) {
          await db
            .update(osInternalMessageUsers)
            .set(patch)
            .where(and(eq(osInternalMessageUsers.id, own.id), onlyIfUnread ? isNull(osInternalMessageUsers.readAt) : sqlTrue()));
        } else {
          await db
            .update(osInternalMessageRecipients)
            .set(patch)
            .where(and(eq(osInternalMessageRecipients.messageId, messageId), eq(osInternalMessageRecipients.sector, actor.sector), onlyIfUnread ? isNull(osInternalMessageRecipients.readAt) : sqlTrue()));
        }
        return this.getForActor(actor, messageId);
      } catch {
        if (!isFeatureMemoryAllowed()) throw new SchemaPendingError();
      }
    }
    if (!isFeatureMemoryAllowed()) throw new SchemaPendingError();
    const msg = mem().messages.find((m) => m.id === messageId);
    if (!msg) return null;
    const target: { readAt: string | null; archivedAt: string | null } | undefined =
      msg.userRecipients.find((u) => u.email.toLowerCase() === actor.email.toLowerCase()) ?? msg.recipients.find((x) => x.sector === actor.sector);
    if (target) {
      if (patch.readAt && !(onlyIfUnread && target.readAt)) target.readAt = patch.readAt.toISOString();
      if ("archivedAt" in patch) target.archivedAt = patch.archivedAt ? patch.archivedAt.toISOString() : null;
    }
    return { ...msg, mine: mineOf(actor, msg.recipients, msg.userRecipients) };
  }

  markRead(actor: AvisoActor, messageId: string): Promise<AvisoRecord | null> {
    return this.patchMine(actor, messageId, { readAt: new Date() }, true);
  }

  archive(actor: AvisoActor, messageId: string): Promise<AvisoRecord | null> {
    return this.patchMine(actor, messageId, { archivedAt: new Date() });
  }

  /** Restaura un aviso archivado a la bandeja del receptor (limpia archivedAt). */
  restore(actor: AvisoActor, messageId: string): Promise<AvisoRecord | null> {
    return this.patchMine(actor, messageId, { archivedAt: null });
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

const sqlTrue = () => sql`true`;

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
