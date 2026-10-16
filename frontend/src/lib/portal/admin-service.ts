/**
 * Administración del Portal de Clientes (Producción y Dirección). Todo cambio queda auditado.
 * Nunca borra: los clientes se suspenden, los alias y correos se dan de baja con fecha y responsable.
 */
import "server-only";

import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { clientKey } from "@/lib/entregas/rules";
import { revokeSessions } from "./auth-service";
import { loadPortalOverview } from "./data-service";
import { sendInvitation } from "./notify-service";
import { toClientPayload } from "./overview";
import { generatePublicCode, normalizeEmail } from "./security";
import { audit, isoOrNull, requireDb, PortalError, type Row, type SqlExec } from "./store";

export function canManagePortal(sector: string): boolean {
  return sector === "PRODUCCION" || sector === "DIRECCION";
}

export type Staff = { email: string; sector: string };
const who = (s: Staff) => s.email;
const need = (s: Staff) => {
  if (!canManagePortal(s.sector)) throw new PortalError("Solo Producción y Dirección administran el Portal de Clientes.", 403, "FORBIDDEN");
};

export type AdminClient = {
  id: string; publicCode: string; displayName: string; status: "ACTIVO" | "SUSPENDIDO"; suspendReason: string | null; createdAt: string;
  aliases: Array<{ name: string }>;
  emails: Array<{ email: string; status: string; invitedAt: string | null; lastLoginAt: string | null }>;
  confirmations: number; liveSessions: number;
};

export async function listClients(staff: Staff, db: SqlExec = requireDb()): Promise<AdminClient[]> {
  need(staff);
  const clients = (await db.execute(sql`select id::text as id, public_code, display_name, status, suspend_reason, created_at from portal_clients order by display_name`)).rows as Row[];
  const aliases = (await db.execute(sql`select client_id::text as cid, name_label from portal_client_aliases where removed_at is null order by name_label`)).rows as Row[];
  const emails = (await db.execute(sql`select client_id::text as cid, email, status, invited_at, last_login_at from portal_authorized_emails where removed_at is null order by email`)).rows as Row[];
  const conf = (await db.execute(sql`select client_id::text as cid, count(*)::int as n from portal_receipt_confirmations group by client_id`)).rows as Row[];
  const sess = (await db.execute(sql`select client_id::text as cid, count(*)::int as n from portal_sessions where revoked_at is null and expires_at > now() group by client_id`)).rows as Row[];
  return clients.map((c) => {
    const id = String(c.id);
    return {
      id, publicCode: String(c.public_code), displayName: String(c.display_name), status: c.status as "ACTIVO" | "SUSPENDIDO", suspendReason: c.suspend_reason ? String(c.suspend_reason) : null, createdAt: isoOrNull(c.created_at)!,
      aliases: aliases.filter((a) => a.cid === id).map((a) => ({ name: String(a.name_label) })),
      emails: emails.filter((e) => e.cid === id).map((e) => ({ email: String(e.email), status: String(e.status), invitedAt: isoOrNull(e.invited_at), lastLoginAt: isoOrNull(e.last_login_at) })),
      confirmations: Number(conf.find((x) => x.cid === id)?.n ?? 0),
      liveSessions: Number(sess.find((x) => x.cid === id)?.n ?? 0),
    };
  });
}

function cleanName(v: unknown, label: string): string {
  const s = typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
  if (s.length < 2 || s.length > 120) throw new PortalError(`${label} inválido.`, 400, "VALIDATION");
  return s;
}

async function addAliasTx(db: SqlExec, clientId: string, name: string, actor: string) {
  const key = clientKey(name);
  if (!key) throw new PortalError("Nombre de cliente inválido.", 400, "VALIDATION");
  const owner = (await db.execute(sql`
    select c.display_name from portal_client_aliases a join portal_clients c on c.id = a.client_id where a.name_key = ${key} and a.removed_at is null`)).rows as Row[];
  if (owner[0]) throw new PortalError(`Ese nombre ya está asignado a «${String(owner[0].display_name)}». Un nombre pertenece a un solo cliente del portal.`, 409, "ALIAS_TAKEN");
  await db.execute(sql`insert into portal_client_aliases (client_id, name_key, name_label, created_by) values (${clientId}::uuid, ${key}, ${name}, ${actor})`);
}

export async function createClient(staff: Staff, input: { displayName: unknown; aliases?: unknown; emails?: unknown }, db: SqlExec = requireDb()) {
  need(staff);
  const displayName = cleanName(input.displayName, "Nombre");
  const aliasNames = (Array.isArray(input.aliases) ? input.aliases : [displayName]).map((a) => cleanName(a, "Nombre de cliente en GENUS OS"));
  const emails = (Array.isArray(input.emails) ? input.emails : []).map((e) => normalizeEmail(e));
  if (emails.some((e) => !e)) throw new PortalError("Hay un correo con formato inválido.", 400, "VALIDATION");
  const id = randomUUID();
  let code = "";
  for (let i = 0; i < 8 && !code; i++) {
    const candidate = generatePublicCode();
    const taken = (await db.execute(sql`select 1 from portal_clients where public_code = ${candidate}`)).rows;
    if (!taken.length) code = candidate;
  }
  if (!code) throw new PortalError("No se pudo generar un código único. Reintentá.", 500, "CODE_GENERATION");
  await db.execute(sql`insert into portal_clients (id, public_code, display_name, created_by) values (${id}::uuid, ${code}, ${displayName}, ${who(staff)})`);
  for (const a of aliasNames) await addAliasTx(db, id, a, who(staff));
  for (const e of emails as string[]) {
    await db.execute(sql`insert into portal_authorized_emails (client_id, email, added_by) values (${id}::uuid, ${e}, ${who(staff)}) on conflict do nothing`);
  }
  await audit(db, { clientId: id, type: "CLIENTE_CREADO", kind: "STAFF", actor: who(staff), detail: { publicCode: code, aliases: aliasNames, emails: emails.length } });
  return { id, publicCode: code };
}

export async function setClientStatus(staff: Staff, clientId: string, status: "ACTIVO" | "SUSPENDIDO", reason: unknown, db: SqlExec = requireDb()) {
  need(staff);
  const why = typeof reason === "string" ? reason.trim().slice(0, 300) : "";
  if (status === "SUSPENDIDO" && !why) throw new PortalError("Indicá el motivo de la suspensión.", 400, "VALIDATION");
  const rows = (await db.execute(sql`
    update portal_clients set status = ${status}, version = version + 1, modified_at = now(),
      suspended_at = ${status === "SUSPENDIDO" ? new Date().toISOString() : null}::timestamptz, suspended_by = ${status === "SUSPENDIDO" ? who(staff) : null}, suspend_reason = ${status === "SUSPENDIDO" ? why : null}
     where id = ${clientId}::uuid returning id`)).rows;
  if (!rows.length) throw new PortalError("Cliente no encontrado.", 404, "NOT_FOUND");
  const revoked = status === "SUSPENDIDO" ? await revokeSessions(db, { clientId }, "suspension") : 0;
  await audit(db, { clientId, type: status === "SUSPENDIDO" ? "CLIENTE_SUSPENDIDO" : "CLIENTE_REACTIVADO", kind: "STAFF", actor: who(staff), detail: { reason: why || null, sessionsRevoked: revoked } });
  return { revoked };
}

export async function addClientAlias(staff: Staff, clientId: string, name: unknown, db: SqlExec = requireDb()) {
  need(staff);
  const n = cleanName(name, "Nombre de cliente en GENUS OS");
  await addAliasTx(db, clientId, n, who(staff));
  await audit(db, { clientId, type: "ALIAS_AGREGADO", kind: "STAFF", actor: who(staff), detail: { alias: n } });
}

export async function removeClientAlias(staff: Staff, clientId: string, name: unknown, db: SqlExec = requireDb()) {
  need(staff);
  const key = clientKey(String(name ?? ""));
  const rows = (await db.execute(sql`update portal_client_aliases set removed_at = now(), removed_by = ${who(staff)} where client_id = ${clientId}::uuid and name_key = ${key} and removed_at is null returning id`)).rows;
  if (!rows.length) throw new PortalError("Ese nombre no está asignado al cliente.", 404, "NOT_FOUND");
  await audit(db, { clientId, type: "ALIAS_QUITADO", kind: "STAFF", actor: who(staff), detail: { alias: String(name) } });
}

export async function addClientEmail(staff: Staff, clientId: string, email: unknown, db: SqlExec = requireDb()) {
  need(staff);
  const e = normalizeEmail(email);
  if (!e) throw new PortalError("Correo inválido.", 400, "VALIDATION");
  await db.execute(sql`insert into portal_authorized_emails (client_id, email, added_by) values (${clientId}::uuid, ${e}, ${who(staff)}) on conflict do nothing`);
  await audit(db, { clientId, type: "CORREO_AUTORIZADO", kind: "STAFF", actor: who(staff), detail: { email: e } });
  return { email: e };
}

export async function removeClientEmail(staff: Staff, clientId: string, email: unknown, db: SqlExec = requireDb()) {
  need(staff);
  const e = normalizeEmail(email);
  if (!e) throw new PortalError("Correo inválido.", 400, "VALIDATION");
  const rows = (await db.execute(sql`update portal_authorized_emails set removed_at = now(), removed_by = ${who(staff)} where client_id = ${clientId}::uuid and email = ${e} and removed_at is null returning id`)).rows;
  if (!rows.length) throw new PortalError("Ese correo no está autorizado.", 404, "NOT_FOUND");
  const revoked = await revokeSessions(db, { clientId, email: e }, "correo_dado_de_baja");
  await audit(db, { clientId, type: "CORREO_DADO_DE_BAJA", kind: "STAFF", actor: who(staff), detail: { email: e, sessionsRevoked: revoked } });
}

export async function inviteClientEmail(staff: Staff, clientId: string, email: unknown, db: SqlExec = requireDb()) {
  need(staff);
  const e = normalizeEmail(email);
  if (!e) throw new PortalError("Correo inválido.", 400, "VALIDATION");
  return sendInvitation({ clientId, email: e, actor: who(staff) }, db);
}

/** Vista previa segura: exactamente lo que ve el cliente (mismo código), sin iniciar sesión como él. Queda auditada. */
export async function previewClient(staff: Staff, clientId: string, db: SqlExec = requireDb()) {
  need(staff);
  const c = (await db.execute(sql`select display_name, public_code from portal_clients where id = ${clientId}::uuid`)).rows as Row[];
  if (!c[0]) throw new PortalError("Cliente no encontrado.", 404, "NOT_FOUND");
  const { overview } = await loadPortalOverview(clientId, new Date(), db);
  await audit(db, { clientId, type: "VISTA_PREVIA_STAFF", kind: "STAFF", actor: who(staff) });
  return { client: { name: String(c[0].display_name), code: String(c[0].public_code) }, ...toClientPayload(overview) };
}

export async function clientActivity(staff: Staff, clientId: string, db: SqlExec = requireDb()) {
  need(staff);
  const notifications = (await db.execute(sql`select kind, title, body, created_at, read_at, email_outbox_id is not null as emailed from portal_notifications where client_id = ${clientId}::uuid order by created_at desc limit 50`)).rows as Row[];
  const emails = (await db.execute(sql`select kind, to_email, subject, status, error, created_at, sent_at from portal_email_outbox where client_id = ${clientId}::uuid order by created_at desc limit 50`)).rows as Row[];
  const receipts = (await db.execute(sql`select product, order_ref, quantity, unit, delivered_at, confirmed_at, confirmed_by_email from portal_receipt_confirmations where client_id = ${clientId}::uuid order by confirmed_at desc limit 50`)).rows as Row[];
  const events = (await db.execute(sql`select event_type, actor_kind, actor, detail, created_at from portal_audit_events where client_id = ${clientId}::uuid order by created_at desc limit 100`)).rows as Row[];
  return {
    notifications: notifications.map((n) => ({ kind: String(n.kind), title: String(n.title), body: String(n.body), createdAt: isoOrNull(n.created_at), read: n.read_at != null, emailed: n.emailed === true })),
    emails: emails.map((m) => ({ kind: String(m.kind), to: String(m.to_email), subject: String(m.subject), status: String(m.status), error: m.error ? String(m.error) : null, createdAt: isoOrNull(m.created_at), sentAt: isoOrNull(m.sent_at) })),
    receipts: receipts.map((r) => ({ product: String(r.product), orderRef: r.order_ref ? String(r.order_ref) : null, quantity: String(r.quantity), unit: r.unit ? String(r.unit) : null, deliveredAt: isoOrNull(r.delivered_at), confirmedAt: isoOrNull(r.confirmed_at), by: String(r.confirmed_by_email) })),
    audit: events.map((e) => ({ type: String(e.event_type), kind: String(e.actor_kind), actor: e.actor ? String(e.actor) : null, detail: e.detail, createdAt: isoOrNull(e.created_at) })),
  };
}

/** Problemas de vínculo: lo que impide que un cliente vea sus pedidos o que podría verse mal. */
export async function linkingProblems(staff: Staff, db: SqlExec = requireDb()) {
  need(staff);
  const works = (await db.execute(sql`
    select w.client, w.production_pedido_id is null as no_pedido
      from work_items w
     where w.deleted_at is null and w.operational_cancelled_at is null and w.operational_status <> 'cancelado' and w.status::text <> 'CANCELADO'`)).rows as Row[];
  const aliasRows = (await db.execute(sql`select a.name_key, a.name_label, c.display_name, c.status from portal_client_aliases a join portal_clients c on c.id = a.client_id where a.removed_at is null`)).rows as Row[];
  const mapped = new Map(aliasRows.map((a) => [String(a.name_key), a]));
  const byKey = new Map<string, { label: string; works: number; withoutPedido: number }>();
  for (const w of works) {
    const label = String(w.client ?? "").trim();
    const key = clientKey(label);
    if (!key) continue;
    const e = byKey.get(key) ?? { label, works: 0, withoutPedido: 0 };
    e.works++;
    if (w.no_pedido === true) e.withoutPedido++;
    byKey.set(key, e);
  }
  return {
    unmappedClients: [...byKey.entries()].filter(([k]) => !mapped.has(k)).map(([, v]) => v).sort((a, b) => b.works - a.works).slice(0, 200),
    mappedWithoutPedido: [...byKey.entries()].filter(([k, v]) => mapped.has(k) && v.withoutPedido > 0).map(([k, v]) => ({ client: String(mapped.get(k)!.display_name), alias: v.label, worksWithoutPedido: v.withoutPedido })),
    aliasesWithoutWork: aliasRows.filter((a) => !byKey.has(String(a.name_key))).map((a) => ({ client: String(a.display_name), alias: String(a.name_label) })),
  };
}

export async function listHolidayOverrides(staff: Staff, db: SqlExec = requireDb()) {
  need(staff);
  const rows = (await db.execute(sql`select to_char(holiday_date, 'YYYY-MM-DD') as d, name, action from portal_holiday_overrides where removed_at is null order by holiday_date`)).rows as Row[];
  return rows.map((r) => ({ date: String(r.d), name: String(r.name), action: String(r.action) as "AGREGAR" | "QUITAR" }));
}

export async function setHolidayOverride(staff: Staff, input: { date: unknown; name: unknown; action: unknown; remove?: unknown }, db: SqlExec = requireDb()) {
  need(staff);
  const date = typeof input.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? input.date : null;
  if (!date || Number.isNaN(Date.parse(`${date}T12:00:00Z`))) throw new PortalError("Fecha inválida.", 400, "VALIDATION");
  if (input.remove === true) {
    await db.execute(sql`update portal_holiday_overrides set removed_at = now() where holiday_date = ${date}::date and removed_at is null`);
    await audit(db, { type: "FERIADO_EXCEPCION_QUITADA", kind: "STAFF", actor: who(staff), detail: { date } });
    return;
  }
  const action = input.action === "AGREGAR" || input.action === "QUITAR" ? input.action : null;
  if (!action) throw new PortalError("Acción inválida.", 400, "VALIDATION");
  const name = cleanName(input.name, "Nombre del feriado");
  await db.execute(sql`update portal_holiday_overrides set removed_at = now() where holiday_date = ${date}::date and removed_at is null`);
  await db.execute(sql`insert into portal_holiday_overrides (holiday_date, name, action, created_by) values (${date}::date, ${name}, ${action}, ${who(staff)})`);
  await audit(db, { type: "FERIADO_EXCEPCION", kind: "STAFF", actor: who(staff), detail: { date, name, action } });
}
