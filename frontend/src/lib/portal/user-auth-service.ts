/**
 * Ingreso al Portal de Clientes por USUARIO + CONTRASEÑA (complementa —no reemplaza— el ingreso por correo + código temporal).
 *
 * Garantías:
 *  - Contraseña con bcrypt (`@/lib/auth/password`, el mismo esquema de GENUS OS): nunca texto plano, nunca en auditoría ni logs.
 *  - Sin enumeración: usuario inexistente, desactivado, cliente suspendido o contraseña mala responden IGUAL y tardan parecido
 *    (se compara contra un hash señuelo cuando el usuario no existe).
 *  - Fuerza bruta: límite persistente por IP y por usuario (portal_rate_limits) + bloqueo progresivo persistente por usuario
 *    (failed_attempts / locked_until). Un usuario bloqueado no puede ingresar ni con la contraseña correcta hasta que venza.
 *  - Sesión: mismo token opaco de 256 bits (solo se guarda su hash), 12 h, cookie HttpOnly/SameSite=Lax/Secure en producción.
 *    Desactivar el usuario, restablecer o cambiar la contraseña revoca sus sesiones.
 *  - Cada ingreso, fallo, bloqueo y cambio queda en portal_audit_events.
 */
import "server-only";

import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { PORTAL_SESSION_TTL_SECONDS } from "./config";
import { actorLabel, revokeSessions, type PortalSession } from "./auth-service";
import { clientIpHash, createToken, hmac, sha256 } from "./security";
import { audit, isoOrNull, rateLimitHit, requireDb, PortalError, type Row, type SqlExec } from "./store";
import {
  FAILURE_FORGET_SECONDS,
  PASSWORD_LOGIN_LIMITS,
  PASSWORD_PROBLEM_MESSAGES,
  isLocked,
  lockSecondsFor,
  normalizeUsername,
  passwordProblem,
} from "./user-rules";

export type PasswordLoginResult =
  | { ok: true; token: string; expiresAt: string; mustChangePassword: boolean; session: PortalSession }
  | { ok: false; reason: "invalid" | "rate_limited" | "locked"; retryAfterSeconds?: number };

/** Hash válido de una contraseña imposible: iguala el costo de comparar cuando el usuario no existe. */
let decoy: Promise<string> | null = null;
const decoyHash = () => (decoy ??= hashPassword(`decoy-${randomUUID()}-Aa1`));

export async function passwordLogin(input: { username: unknown; password: unknown; headers: Headers }): Promise<PasswordLoginResult> {
  const db = requireDb();
  const ipHash = clientIpHash(input.headers);
  const username = normalizeUsername(input.username);
  const password = typeof input.password === "string" && input.password.length > 0 && input.password.length <= 256 ? input.password : null;

  const L = PASSWORD_LOGIN_LIMITS;
  const checks = [
    await rateLimitHit(db, `pwd:ip:${ipHash}`, L.ip.windowSeconds, L.ip.max),
    await rateLimitHit(db, `pwd:user:${hmac("username", username ?? "none").slice(0, 32)}`, L.username.windowSeconds, L.username.max),
  ];
  if (!checks.every((c) => c.allowed)) {
    await audit(db, { type: "PWD_LOGIN_RATE_LIMITED", kind: "SISTEMA", ipHash, detail: { usernameHash: username ? hmac("username", username).slice(0, 16) : null } });
    return { ok: false, reason: "rate_limited", retryAfterSeconds: L.ip.windowSeconds };
  }

  const rows = username
    ? ((await db.execute(sql`
        select u.id, u.client_id, u.username, u.email, u.password_hash, u.must_change_password, u.status, u.failed_attempts, u.last_failed_at, u.locked_until,
               c.display_name, c.public_code, (c.status = 'ACTIVO' and c.access_enabled) as client_ok
          from portal_users u join portal_clients c on c.id = u.client_id
         where u.username = ${username} and u.removed_at is null limit 1`)).rows as Row[])
    : [];
  const u = rows[0];

  const fail = async (why: string, u0: Row | undefined) => {
    await audit(db, { clientId: u0 ? String(u0.client_id) : null, type: "PWD_LOGIN_FAIL", kind: "CLIENTE", actor: username ? `usuario:${username}` : null, ipHash, detail: { why } });
    return { ok: false as const, reason: "invalid" as const };
  };

  if (!u || !password) {
    await verifyPassword(password ?? "x", await decoyHash());
    return fail(!username ? "usuario_con_formato_invalido" : !u ? "usuario_inexistente" : "sin_contraseña", u);
  }

  const locked = isLocked(isoOrNull(u.locked_until));
  const passwordOk = await verifyPassword(password, String(u.password_hash));
  if (locked) {
    await audit(db, { clientId: String(u.client_id), type: "PWD_LOGIN_LOCKED", kind: "CLIENTE", actor: `usuario:${String(u.username)}`, ipHash });
    const wait = Math.max(1, Math.ceil((new Date(String(u.locked_until)).getTime() - Date.now()) / 1000));
    return { ok: false, reason: "locked", retryAfterSeconds: wait };
  }
  if (!passwordOk) {
    // Fallos consecutivos: se olvidan si pasó mucho tiempo desde el último. El incremento es atómico en base.
    const forgotten = u.last_failed_at != null && Date.now() - new Date(String(u.last_failed_at)).getTime() > FAILURE_FORGET_SECONDS * 1000;
    const upd = (await db.execute(sql`
      update portal_users set failed_attempts = (case when ${forgotten} then 0 else failed_attempts end) + 1, last_failed_at = now()
       where id = ${String(u.id)}::uuid returning failed_attempts`)).rows as Row[];
    const attempts = Number(upd[0]?.failed_attempts ?? 1);
    const lock = lockSecondsFor(attempts);
    if (lock > 0) {
      await db.execute(sql`update portal_users set locked_until = now() + (${lock} * interval '1 second') where id = ${String(u.id)}::uuid`);
      await audit(db, { clientId: String(u.client_id), type: "PWD_USER_LOCKED", kind: "SISTEMA", actor: `usuario:${String(u.username)}`, ipHash, detail: { failedAttempts: attempts, lockSeconds: lock } });
    }
    return fail("contraseña_incorrecta", u);
  }
  if (u.status !== "ACTIVO" || u.client_ok !== true) return fail(u.status !== "ACTIVO" ? "usuario_desactivado" : "cliente_suspendido_o_sin_acceso", u);

  // Éxito: se limpia el contador y se abre la sesión.
  const token = createToken();
  const id = randomUUID();
  const ins = (await db.execute(sql`
    insert into portal_sessions (id, client_id, email, user_id, token_hash, ip_hash, user_agent, expires_at)
    values (${id}::uuid, ${String(u.client_id)}::uuid, null, ${String(u.id)}::uuid, ${sha256(token)}, ${ipHash}, ${input.headers.get("user-agent")?.slice(0, 240) ?? null},
            now() + (${PORTAL_SESSION_TTL_SECONDS} * interval '1 second'))
    returning expires_at`)).rows as Row[];
  await db.execute(sql`update portal_users set failed_attempts = 0, locked_until = null, last_failed_at = null, last_login_at = now() where id = ${String(u.id)}::uuid`);
  await audit(db, { clientId: String(u.client_id), type: "PWD_LOGIN_OK", kind: "CLIENTE", actor: `usuario:${String(u.username)}`, ipHash });
  const email = u.email ? String(u.email) : null;
  const mustChange = u.must_change_password === true;
  return {
    ok: true,
    token,
    expiresAt: isoOrNull(ins[0]?.expires_at)!,
    mustChangePassword: mustChange,
    session: {
      id,
      clientId: String(u.client_id),
      email,
      clientName: String(u.display_name),
      publicCode: String(u.public_code),
      userId: String(u.id),
      username: String(u.username),
      mustChangePassword: mustChange,
      actor: actorLabel(email, String(u.username)),
    },
  };
}

/** El propio usuario cambia su contraseña (exige la actual). Cierra las DEMÁS sesiones y deja viva la actual. */
export async function changeOwnPassword(session: PortalSession, input: { current: unknown; next: unknown; headers: Headers }, db: SqlExec = requireDb()): Promise<void> {
  if (!session.userId || !session.username) throw new PortalError("Tu ingreso es por correo: no tiene contraseña para cambiar.", 400, "NO_PASSWORD_USER");
  const ipHash = clientIpHash(input.headers);
  const lim = await rateLimitHit(db, `pwd-change:${session.userId}`, 900, 10);
  if (!lim.allowed) throw new PortalError("Demasiados intentos. Esperá unos minutos.", 429, "RATE_LIMITED");
  const rows = (await db.execute(sql`select password_hash from portal_users where id = ${session.userId}::uuid and removed_at is null and status = 'ACTIVO'`)).rows as Row[];
  if (!rows[0]) throw new PortalError("Usuario no disponible.", 403, "FORBIDDEN");
  const current = typeof input.current === "string" ? input.current : "";
  if (!(await verifyPassword(current, String(rows[0].password_hash)))) {
    await audit(db, { clientId: session.clientId, type: "PWD_CHANGE_FAIL", kind: "CLIENTE", actor: session.actor, ipHash });
    throw new PortalError("La contraseña actual no es correcta.", 400, "BAD_CURRENT_PASSWORD");
  }
  const next = typeof input.next === "string" ? input.next : "";
  const problem = passwordProblem(next, session.username);
  if (problem) throw new PortalError(PASSWORD_PROBLEM_MESSAGES[problem], 400, "WEAK_PASSWORD");
  if (next === current) throw new PortalError("La contraseña nueva tiene que ser distinta de la actual.", 400, "SAME_PASSWORD");
  await db.execute(sql`
    update portal_users set password_hash = ${await hashPassword(next)}, must_change_password = false, password_changed_at = now(), failed_attempts = 0, locked_until = null, modified_at = now()
     where id = ${session.userId}::uuid`);
  // Misma garantía que un restablecimiento: cualquier otra sesión (otro dispositivo) deja de valer.
  await db.execute(sql`update portal_sessions set revoked_at = now(), revoked_reason = 'cambio_de_contraseña' where user_id = ${session.userId}::uuid and id <> ${session.id}::uuid and revoked_at is null`);
  await audit(db, { clientId: session.clientId, type: "PWD_CHANGED", kind: "CLIENTE", actor: session.actor, ipHash });
}

export { revokeSessions };
