/**
 * Autenticación del Portal de Clientes: código de cliente + correo autorizado + código temporal (o enlace seguro).
 *
 * Garantías:
 *  - El código de cliente NO alcanza: hace falta un correo autorizado por Producción/Dirección Y el código temporal.
 *  - Protección contra enumeración: pedir un código responde SIEMPRE lo mismo (exista o no el cliente/correo) y el envío
 *    del correo ocurre DESPUÉS de responder (mismo tiempo de respuesta). Los fallos de verificación son todos iguales.
 *  - Código temporal de un solo uso, 10 minutos, 5 intentos, guardado solo como HMAC (nunca en claro).
 *  - Límites en base por IP, por correo y por código de cliente; cuenta cada intento.
 *  - Sesión: token opaco de 256 bits (solo se guarda su hash), 12 horas, revocable; cliente suspendido o correo bloqueado
 *    la invalidan en el acto (se revalida en cada solicitud).
 *  - Auditoría de cada acceso y fallo.
 */
import "server-only";

import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { OTP_MAX_ATTEMPTS, OTP_TTL_MINUTES, PORTAL_SESSION_TTL_SECONDS, emailMode, portalPublicBaseUrl } from "./config";
import { loginEmail } from "./email-templates";
import { deliverEmail } from "./email";
import { audit, isoOrNull, rateLimitHit, requireDb, type Row, type SqlExec } from "./store";
import { clientIpHash, constantTimeEqual, createToken, generateOtp, hmac, normalizeEmail, normalizeOtp, normalizePublicCode, sha256 } from "./security";

export const LIMITS = {
  request: { ip: { windowSeconds: 600, max: 20 }, email: { windowSeconds: 900, max: 5 }, code: { windowSeconds: 900, max: 20 } },
  verify: { ip: { windowSeconds: 600, max: 40 }, email: { windowSeconds: 900, max: 12 }, code: { windowSeconds: 900, max: 40 } },
  /** Entre dos códigos pedidos para el mismo correo tienen que pasar al menos estos segundos. */
  cooldownSeconds: 30,
};

export type PortalSession = { id: string; clientId: string; email: string; clientName: string; publicCode: string };

type Target = { clientId: string; clientName: string; email: string } | null;

/** Cliente activo + correo autorizado activo para el par (código, correo). null si algo no coincide. */
async function findTarget(db: SqlExec, publicCode: string | null, email: string | null): Promise<Target> {
  if (!publicCode || !email) return null;
  const rows = (await db.execute(sql`
    select c.id as client_id, c.display_name, e.email
      from portal_clients c
      join portal_authorized_emails e on e.client_id = c.id and e.email = ${email} and e.removed_at is null and e.status = 'ACTIVO'
     where c.public_code = ${publicCode} and c.status = 'ACTIVO' and c.access_enabled
     limit 1`)).rows as Row[];
  const r = rows[0];
  return r ? { clientId: String(r.client_id), clientName: String(r.display_name), email: String(r.email) } : null;
}

async function limits(db: SqlExec, scope: "request" | "verify", ipHash: string, email: string | null, publicCode: string | null) {
  const L = LIMITS[scope];
  const checks = [
    await rateLimitHit(db, `${scope}:ip:${ipHash}`, L.ip.windowSeconds, L.ip.max),
    await rateLimitHit(db, `${scope}:email:${hmac("email", email ?? "none").slice(0, 32)}`, L.email.windowSeconds, L.email.max),
    await rateLimitHit(db, `${scope}:code:${publicCode ?? "none"}`, L.code.windowSeconds, L.code.max),
  ];
  return checks.every((c) => c.allowed);
}

export type RequestCodeResult =
  | { status: "accepted"; /** Envío del correo: se ejecuta DESPUÉS de responder. */ deliver: () => Promise<void> }
  | { status: "rate_limited" };

/** Pide un código de acceso. La respuesta no revela si el cliente o el correo existen. */
export async function requestLoginCode(input: { code: unknown; email: unknown; headers: Headers }): Promise<RequestCodeResult> {
  const db = requireDb();
  const ipHash = clientIpHash(input.headers);
  const publicCode = normalizePublicCode(input.code);
  const email = normalizeEmail(input.email);
  if (!(await limits(db, "request", ipHash, email, publicCode))) {
    await audit(db, { type: "LOGIN_REQUEST_RATE_LIMITED", kind: "SISTEMA", ipHash, detail: { emailHash: email ? hmac("email", email).slice(0, 16) : null } });
    return { status: "rate_limited" };
  }
  const target = await findTarget(db, publicCode, email);
  if (!target) {
    // Mismo trabajo visible desde afuera: nada. El motivo queda solo en la auditoría interna.
    await audit(db, { type: "LOGIN_REQUEST_REJECTED", kind: "SISTEMA", ipHash, detail: { emailHash: email ? hmac("email", email).slice(0, 16) : null, codeGiven: Boolean(publicCode) } });
    return { status: "accepted", deliver: async () => undefined };
  }
  const recent = (await db.execute(sql`
    select 1 from portal_login_challenges
     where client_id = ${target.clientId}::uuid and email = ${target.email} and created_at > now() - (${LIMITS.cooldownSeconds} * interval '1 second') limit 1`)).rows;
  if (recent.length) return { status: "accepted", deliver: async () => undefined };

  const id = randomUUID();
  const otp = generateOtp();
  const linkToken = createToken();
  await db.execute(sql`
    update portal_login_challenges set consumed_at = now()
     where client_id = ${target.clientId}::uuid and email = ${target.email} and consumed_at is null`);
  await db.execute(sql`
    insert into portal_login_challenges (id, client_id, email, code_hash, link_hash, max_attempts, expires_at, ip_hash)
    values (${id}::uuid, ${target.clientId}::uuid, ${target.email}, ${hmac("otp", `${id}:${otp}`)}, ${hmac("link", linkToken)}, ${OTP_MAX_ATTEMPTS},
            now() + (${OTP_TTL_MINUTES} * interval '1 minute'), ${ipHash})`);
  await audit(db, { clientId: target.clientId, type: "LOGIN_CODE_ISSUED", kind: "CLIENTE", actor: target.email, ipHash });

  const content = loginEmail({ clientName: target.clientName, otp, link: `${portalPublicBaseUrl()}/acceso?t=${linkToken}`, ttlMinutes: OTP_TTL_MINUTES });
  const mode = emailMode();
  const deliver = async () => {
    const outboxId = randomUUID();
    // El código NO se guarda en claro: solo en modo «capture» (pruebas locales, nunca en Vercel).
    const keep = mode === "capture";
    const redacted = "[Código de acceso oculto por seguridad]";
    await db.execute(sql`
      insert into portal_email_outbox (id, client_id, kind, to_email, subject, body_text, body_html)
      values (${outboxId}::uuid, ${target.clientId}::uuid, 'LOGIN', ${target.email}, ${content.subject}, ${keep ? content.text : redacted}, ${keep ? content.html : redacted})`);
    const res = await deliverEmail({ to: target.email, subject: content.subject, text: content.text, html: content.html }, mode);
    await db.execute(sql`
      update portal_email_outbox set status = ${res.status}, provider = ${"provider" in res ? res.provider : null},
             provider_message_id = ${"providerMessageId" in res ? res.providerMessageId : null}, error = ${"error" in res ? res.error : null},
             attempts = 1, sent_at = ${res.status === "ENVIADO" ? new Date().toISOString() : null}::timestamptz
       where id = ${outboxId}::uuid`);
    if (res.status === "ERROR" || res.status === "SIN_PROVEEDOR") {
      await audit(db, { clientId: target.clientId, type: "LOGIN_EMAIL_NOT_SENT", kind: "SISTEMA", detail: { status: res.status, error: "error" in res ? res.error : null } });
    }
  };
  return { status: "accepted", deliver };
}

export type VerifyResult =
  | { ok: true; token: string; expiresAt: string; session: PortalSession }
  | { ok: false; reason: "invalid" | "rate_limited" };

async function createSession(db: SqlExec, t: { clientId: string; clientName: string; email: string; publicCode: string }, ipHash: string, userAgent: string | null): Promise<VerifyResult> {
  const token = createToken();
  const id = randomUUID();
  const rows = (await db.execute(sql`
    insert into portal_sessions (id, client_id, email, token_hash, ip_hash, user_agent, expires_at)
    values (${id}::uuid, ${t.clientId}::uuid, ${t.email}, ${sha256(token)}, ${ipHash}, ${userAgent?.slice(0, 240) ?? null}, now() + (${PORTAL_SESSION_TTL_SECONDS} * interval '1 second'))
    returning expires_at`)).rows as Row[];
  await db.execute(sql`update portal_authorized_emails set last_login_at = now() where client_id = ${t.clientId}::uuid and email = ${t.email} and removed_at is null`);
  await audit(db, { clientId: t.clientId, type: "LOGIN_OK", kind: "CLIENTE", actor: t.email, ipHash });
  return { ok: true, token, expiresAt: isoOrNull(rows[0]?.expires_at)!, session: { id, clientId: t.clientId, email: t.email, clientName: t.clientName, publicCode: t.publicCode } };
}

/** Verifica código de cliente + correo + código temporal y abre la sesión. Todos los fallos son indistinguibles. */
export async function verifyLoginCode(input: { code: unknown; email: unknown; otp: unknown; headers: Headers }): Promise<VerifyResult> {
  const db = requireDb();
  const ipHash = clientIpHash(input.headers);
  const publicCode = normalizePublicCode(input.code);
  const email = normalizeEmail(input.email);
  const otp = normalizeOtp(input.otp);
  if (!(await limits(db, "verify", ipHash, email, publicCode))) {
    await audit(db, { type: "LOGIN_VERIFY_RATE_LIMITED", kind: "SISTEMA", ipHash });
    return { ok: false, reason: "rate_limited" };
  }
  const fail = async (why: string, clientId: string | null) => {
    await audit(db, { clientId, type: "LOGIN_FAIL", kind: "CLIENTE", actor: email ?? null, ipHash, detail: { why } });
    return { ok: false as const, reason: "invalid" as const };
  };
  const target = await findTarget(db, publicCode, email);
  if (!target || !otp) return fail(!target ? "datos_no_autorizados" : "codigo_con_formato_invalido", target?.clientId ?? null);

  const ch = (await db.execute(sql`
    select id from portal_login_challenges
     where client_id = ${target.clientId}::uuid and email = ${target.email} and consumed_at is null and expires_at > now()
     order by created_at desc limit 1`)).rows as Row[];
  if (!ch[0]) return fail("sin_codigo_vigente", target.clientId);
  const challengeId = String(ch[0].id);
  // Cada intento cuenta ANTES de comparar: no se puede probar códigos en paralelo más allá del máximo.
  const attempt = (await db.execute(sql`
    update portal_login_challenges set attempts = attempts + 1
     where id = ${challengeId}::uuid and consumed_at is null and expires_at > now() and attempts < max_attempts
    returning code_hash`)).rows as Row[];
  if (!attempt[0]) return fail("intentos_agotados_o_vencido", target.clientId);
  if (!constantTimeEqual(String(attempt[0].code_hash), hmac("otp", `${challengeId}:${otp}`))) return fail("codigo_incorrecto", target.clientId);

  const consumed = (await db.execute(sql`update portal_login_challenges set consumed_at = now() where id = ${challengeId}::uuid and consumed_at is null returning id`)).rows;
  if (!consumed.length) return fail("codigo_ya_usado", target.clientId);
  const pc = (await db.execute(sql`select public_code from portal_clients where id = ${target.clientId}::uuid`)).rows as Row[];
  return createSession(db, { ...target, publicCode: String(pc[0]?.public_code ?? publicCode) }, ipHash, input.headers.get("user-agent"));
}

/** Entra con el enlace seguro del correo (el token es de un solo uso). */
export async function verifyLoginLink(input: { token: unknown; headers: Headers }): Promise<VerifyResult> {
  const db = requireDb();
  const ipHash = clientIpHash(input.headers);
  if (!(await limits(db, "verify", ipHash, null, null))) return { ok: false, reason: "rate_limited" };
  const token = typeof input.token === "string" && /^[A-Za-z0-9_-]{30,100}$/.test(input.token) ? input.token : null;
  const fail = async (why: string, clientId: string | null) => {
    await audit(db, { clientId, type: "LOGIN_FAIL", kind: "CLIENTE", ipHash, detail: { why, via: "enlace" } });
    return { ok: false as const, reason: "invalid" as const };
  };
  if (!token) return fail("enlace_con_formato_invalido", null);
  const rows = (await db.execute(sql`
    update portal_login_challenges set consumed_at = now()
     where link_hash = ${hmac("link", token)} and consumed_at is null and expires_at > now()
    returning client_id, email`)).rows as Row[];
  if (!rows[0]) return fail("enlace_invalido_o_vencido", null);
  const info = (await db.execute(sql`
    select c.id as client_id, c.display_name, c.public_code, e.email
      from portal_clients c join portal_authorized_emails e on e.client_id = c.id and e.email = ${String(rows[0].email)} and e.removed_at is null and e.status = 'ACTIVO'
     where c.id = ${String(rows[0].client_id)}::uuid and c.status = 'ACTIVO' and c.access_enabled limit 1`)).rows as Row[];
  if (!info[0]) return fail("cliente_o_correo_inhabilitado", String(rows[0].client_id));
  return createSession(db, { clientId: String(info[0].client_id), clientName: String(info[0].display_name), email: String(info[0].email), publicCode: String(info[0].public_code) }, ipHash, input.headers.get("user-agent"));
}

/** Resuelve la sesión del portal desde el token de la cookie. Revalida cliente y correo en cada llamada. */
export async function resolvePortalSession(token: string | null): Promise<PortalSession | null> {
  if (!token) return null;
  const db = requireDb();
  const rows = (await db.execute(sql`
    select s.id, s.client_id, s.email, s.last_seen_at, c.display_name, c.public_code
      from portal_sessions s
      join portal_clients c on c.id = s.client_id and c.status = 'ACTIVO' and c.access_enabled
      join portal_authorized_emails e on e.client_id = s.client_id and e.email = s.email and e.removed_at is null and e.status = 'ACTIVO'
     where s.token_hash = ${sha256(token)} and s.revoked_at is null and s.expires_at > now()
     limit 1`)).rows as Row[];
  const r = rows[0];
  if (!r) return null;
  const seen = new Date(String(r.last_seen_at)).getTime();
  if (Date.now() - seen > 5 * 60_000) await db.execute(sql`update portal_sessions set last_seen_at = now() where id = ${String(r.id)}::uuid`).catch(() => undefined);
  return { id: String(r.id), clientId: String(r.client_id), email: String(r.email), clientName: String(r.display_name), publicCode: String(r.public_code) };
}

export async function logoutPortalSession(token: string | null): Promise<void> {
  if (!token) return;
  const db = requireDb();
  const rows = (await db.execute(sql`
    update portal_sessions set revoked_at = now(), revoked_reason = 'logout' where token_hash = ${sha256(token)} and revoked_at is null returning client_id, email`)).rows as Row[];
  if (rows[0]) await audit(db, { clientId: String(rows[0].client_id), type: "LOGOUT", kind: "CLIENTE", actor: String(rows[0].email) });
}

/** Cierra todas las sesiones de un cliente (suspensión) o de un correo (bloqueo/baja). */
export async function revokeSessions(db: SqlExec, scope: { clientId: string; email?: string }, reason: string): Promise<number> {
  const rows = scope.email
    ? (await db.execute(sql`update portal_sessions set revoked_at = now(), revoked_reason = ${reason} where client_id = ${scope.clientId}::uuid and email = ${scope.email} and revoked_at is null returning id`)).rows
    : (await db.execute(sql`update portal_sessions set revoked_at = now(), revoked_reason = ${reason} where client_id = ${scope.clientId}::uuid and revoked_at is null returning id`)).rows;
  return rows.length;
}
