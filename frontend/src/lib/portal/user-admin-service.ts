/**
 * Administración de usuarios del Portal de Clientes (usuario + contraseña). SOLO Dirección y Administración.
 * Nunca guarda ni devuelve una contraseña salvo la temporal recién generada (se muestra UNA vez y solo existe su hash).
 * Desactivar, restablecer o dar de baja un usuario revoca sus sesiones en el acto. Todo cambio queda auditado.
 */
import "server-only";

import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { hashPassword } from "@/lib/auth/password";
import { revokeSessions } from "./auth-service";
import { pickAvailableUsername, slugifyUsername } from "./access-credentials";
import { normalizeEmail } from "./security";
import { audit, isoOrNull, requireDb, PortalError, type Row, type SqlExec } from "./store";
import { PASSWORD_PROBLEM_MESSAGES, generateTemporaryPassword, isLocked, normalizeUsername, passwordProblem } from "./user-rules";

export type UserStaff = { email: string; sector: string };

export function canManagePortalUsers(sector: string): boolean {
  return sector === "DIRECCION" || sector === "ADMINISTRACION";
}
const need = (s: UserStaff) => {
  if (!canManagePortalUsers(s.sector)) throw new PortalError("Solo Dirección y Administración gestionan los usuarios del portal.", 403, "FORBIDDEN");
};

export type AdminPortalUser = {
  id: string;
  clientId: string;
  clientName: string;
  username: string;
  displayName: string | null;
  email: string | null;
  status: "ACTIVO" | "DESACTIVADO";
  mustChangePassword: boolean;
  locked: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  liveSessions: number;
};

export async function listPortalUsers(staff: UserStaff, db: SqlExec = requireDb()): Promise<{ users: AdminPortalUser[]; clients: Array<{ id: string; name: string; code: string; status: string }> }> {
  need(staff);
  const users = (await db.execute(sql`
    select u.id::text as id, u.client_id::text as client_id, c.display_name, u.username, u.display_name as user_display, u.email, u.status, u.must_change_password,
           u.locked_until, u.last_login_at, u.created_at,
           (select count(*)::int from portal_sessions s where s.user_id = u.id and s.revoked_at is null and s.expires_at > now()) as live
      from portal_users u join portal_clients c on c.id = u.client_id
     where u.removed_at is null order by c.display_name, u.username`)).rows as Row[];
  const clients = (await db.execute(sql`select id::text as id, display_name, public_code, status from portal_clients order by display_name`)).rows as Row[];
  return {
    users: users.map((u) => ({
      id: String(u.id),
      clientId: String(u.client_id),
      clientName: String(u.display_name),
      username: String(u.username),
      displayName: u.user_display ? String(u.user_display) : null,
      email: u.email ? String(u.email) : null,
      status: u.status as AdminPortalUser["status"],
      mustChangePassword: u.must_change_password === true,
      locked: isLocked(isoOrNull(u.locked_until)),
      lastLoginAt: isoOrNull(u.last_login_at),
      createdAt: isoOrNull(u.created_at)!,
      liveSessions: Number(u.live ?? 0),
    })),
    clients: clients.map((c) => ({ id: String(c.id), name: String(c.display_name), code: String(c.public_code), status: String(c.status) })),
  };
}

function cleanLabel(v: unknown): string | null {
  const s = typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
  if (!s) return null;
  if (s.length > 120) throw new PortalError("El nombre es demasiado largo.", 400, "VALIDATION");
  return s;
}

function optionalEmail(v: unknown): string | null {
  if (v == null || (typeof v === "string" && !v.trim())) return null;
  const e = normalizeEmail(v);
  if (!e) throw new PortalError("El correo tiene un formato inválido (es opcional: podés dejarlo vacío).", 400, "VALIDATION");
  return e;
}

async function takenUsernames(db: SqlExec, base: string): Promise<Set<string>> {
  const rows = (await db.execute(sql`select username from portal_users where removed_at is null and username like ${base + "%"}`)).rows as Row[];
  return new Set(rows.map((r) => String(r.username)));
}

/** Nombre de usuario libre derivado del nombre del cliente («The Minimal Co.» → theminimalco, theminimalco2…). */
export async function suggestPortalUsername(staff: UserStaff, clientId: string, db: SqlExec = requireDb()): Promise<{ username: string }> {
  need(staff);
  const rows = (await db.execute(sql`select display_name from portal_clients where id = ${/^[0-9a-f-]{36}$/i.test(clientId) ? clientId : randomUUID()}::uuid`)).rows as Row[];
  if (!rows[0]) throw new PortalError("Cliente no encontrado.", 404, "NOT_FOUND");
  const base = slugifyUsername(rows[0].display_name);
  return { username: pickAvailableUsername(base, await takenUsernames(db, base)) };
}

export async function createPortalUser(
  staff: UserStaff,
  input: { clientId: unknown; username: unknown; password?: unknown; email?: unknown; displayName?: unknown; autoSuffix?: unknown },
  db: SqlExec = requireDb()
): Promise<{ id: string; username: string; temporaryPassword: string | null }> {
  need(staff);
  const clientId = typeof input.clientId === "string" && /^[0-9a-f-]{36}$/i.test(input.clientId) ? input.clientId : "";
  const base = normalizeUsername(input.username);
  if (!base) throw new PortalError("Usuario inválido: 3 a 40 caracteres (letras, números, punto, guion o guion bajo), sin espacios.", 400, "VALIDATION");
  const client = (await db.execute(sql`select 1 from portal_clients where id = ${clientId || randomUUID()}::uuid`)).rows;
  if (!client.length) throw new PortalError("Cliente no encontrado.", 404, "NOT_FOUND");
  const email = optionalEmail(input.email);
  const given = typeof input.password === "string" && input.password.length > 0 ? input.password : null;
  if (given) {
    const problem = passwordProblem(given, base);
    if (problem) throw new PortalError(PASSWORD_PROBLEM_MESSAGES[problem], 400, "WEAK_PASSWORD");
  }
  const password = given ?? generateTemporaryPassword();
  const id = randomUUID();
  const passwordHash = await hashPassword(password);
  // autoSuffix: si el usuario ya existe (o aparece uno igual en una carrera) se prueba base2, base3… sobre la constraint unique.
  const auto = input.autoSuffix === true;
  let username = base;
  for (let n = 1; ; n++) {
    if (n > 1) username = pickAvailableUsername(base, await takenUsernames(db, base), n);
    try {
      await db.execute(sql`
        insert into portal_users (id, client_id, username, display_name, email, password_hash, must_change_password, created_by)
        values (${id}::uuid, ${clientId}::uuid, ${username}, ${cleanLabel(input.displayName)}, ${email}, ${passwordHash}, true, ${staff.email})`);
      break;
    } catch (err) {
      const e = err as { code?: string; cause?: { code?: string; message?: string }; message?: string };
      const dup = e?.code === "23505" || e?.cause?.code === "23505" || /portal_users_username_active_uidx|duplicate key/i.test(`${e?.message ?? ""} ${e?.cause?.message ?? ""}`);
      if (dup && auto && n < 50) continue;
      if (dup) throw new PortalError("Ese nombre de usuario ya existe.", 409, "USERNAME_TAKEN");
      throw err;
    }
  }
  await audit(db, { clientId, type: "USUARIO_CREADO", kind: "STAFF", actor: staff.email, detail: { username, hasEmail: Boolean(email), generated: !given } });
  // El usuario siempre debe cambiar la contraseña que le entrega el personal en su primer ingreso.
  return { id, username, temporaryPassword: given ? null : password };
}

async function loadUser(db: SqlExec, userId: string): Promise<Row> {
  const rows = (await db.execute(sql`select id::text as id, client_id::text as client_id, username, status from portal_users where id = ${/^[0-9a-f-]{36}$/i.test(userId) ? userId : randomUUID()}::uuid and removed_at is null`)).rows as Row[];
  if (!rows[0]) throw new PortalError("Usuario no encontrado.", 404, "NOT_FOUND");
  return rows[0];
}

/** Activa o desactiva. Desactivar revoca sus sesiones de inmediato. */
export async function setPortalUserStatus(staff: UserStaff, userId: string, active: boolean, db: SqlExec = requireDb()): Promise<{ revoked: number }> {
  need(staff);
  const u = await loadUser(db, userId);
  await db.execute(sql`update portal_users set status = ${active ? "ACTIVO" : "DESACTIVADO"}, modified_at = now() ${active ? sql`, failed_attempts = 0, locked_until = null` : sql``} where id = ${String(u.id)}::uuid`);
  const revoked = active ? 0 : await revokeSessions(db, { clientId: String(u.client_id), userId: String(u.id) }, "usuario_desactivado");
  await audit(db, { clientId: String(u.client_id), type: active ? "USUARIO_ACTIVADO" : "USUARIO_DESACTIVADO", kind: "STAFF", actor: staff.email, detail: { username: String(u.username), sessionsRevoked: revoked } });
  return { revoked };
}

/** Restablece la contraseña: genera una temporal (se muestra una vez), obliga a cambiarla, desbloquea y revoca todas las sesiones. */
export async function resetPortalUserPassword(staff: UserStaff, userId: string, db: SqlExec = requireDb()): Promise<{ username: string; temporaryPassword: string; revoked: number }> {
  need(staff);
  const u = await loadUser(db, userId);
  const temporaryPassword = generateTemporaryPassword();
  await db.execute(sql`
    update portal_users set password_hash = ${await hashPassword(temporaryPassword)}, must_change_password = true, password_changed_at = now(),
           failed_attempts = 0, locked_until = null, last_failed_at = null, modified_at = now()
     where id = ${String(u.id)}::uuid`);
  const revoked = await revokeSessions(db, { clientId: String(u.client_id), userId: String(u.id) }, "contraseña_restablecida");
  await audit(db, { clientId: String(u.client_id), type: "USUARIO_CONTRASENA_RESTABLECIDA", kind: "STAFF", actor: staff.email, detail: { username: String(u.username), sessionsRevoked: revoked } });
  return { username: String(u.username), temporaryPassword, revoked };
}

/** Cambia el correo (opcional) y el nombre visible. */
export async function updatePortalUser(staff: UserStaff, userId: string, input: { email?: unknown; displayName?: unknown }, db: SqlExec = requireDb()): Promise<void> {
  need(staff);
  const u = await loadUser(db, userId);
  const email = optionalEmail(input.email);
  await db.execute(sql`update portal_users set email = ${email}, display_name = ${cleanLabel(input.displayName)}, modified_at = now() where id = ${String(u.id)}::uuid`);
  await audit(db, { clientId: String(u.client_id), type: "USUARIO_ACTUALIZADO", kind: "STAFF", actor: staff.email, detail: { username: String(u.username), hasEmail: Boolean(email) } });
}

/** Baja lógica: libera el nombre de usuario, conserva el historial y revoca sus sesiones. */
export async function removePortalUser(staff: UserStaff, userId: string, db: SqlExec = requireDb()): Promise<{ revoked: number }> {
  need(staff);
  const u = await loadUser(db, userId);
  await db.execute(sql`update portal_users set removed_at = now(), removed_by = ${staff.email}, status = 'DESACTIVADO', modified_at = now() where id = ${String(u.id)}::uuid`);
  const revoked = await revokeSessions(db, { clientId: String(u.client_id), userId: String(u.id) }, "usuario_dado_de_baja");
  await audit(db, { clientId: String(u.client_id), type: "USUARIO_DADO_DE_BAJA", kind: "STAFF", actor: staff.email, detail: { username: String(u.username), sessionsRevoked: revoked } });
  return { revoked };
}
