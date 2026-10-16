/**
 * Modo demostración del Portal de Clientes.
 *
 * Quién: solo usuarios internos de Producción y Dirección (validado en el servidor con su sesión de GENUS OS).
 * Cómo: el panel pide un token temporal (2 min, un solo uso, solo se guarda el hash) y abre el portal con él en el FRAGMENTO de
 * la URL (nunca viaja al servidor ni queda en registros); el portal lo canjea por POST y obtiene una sesión demo (60 min,
 * cookie HttpOnly propia, solo el hash en base).
 * Aislamiento: ningún dato de la demo sale de tablas reales (ver demo-data.ts) y confirmar una recepción solo escribe en
 * `portal_demo_sessions.confirmations`: no crea constancias reales, ni avisos a Producción, ni toca GENUS OS.
 * Interruptor: `PORTAL_DEMO_ENABLED=0` apaga la demostración por completo.
 */
import "server-only";

import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { canManagePortal, type Staff } from "./admin-service";
import { portalPublicBaseUrl } from "./config";
import { buildDemoPayload, findDemoDelivery, type DemoState } from "./demo-data";
import { loadCalendarOptions, type ConfirmResult } from "./data-service";
import { clientIpHash, createToken, hmac } from "./security";
import { audit, isoOrNull, rateLimitHit, requireDb, PortalError, type Row, type SqlExec } from "./store";

export const DEMO_TOKEN_TTL_SECONDS = 120;
export const DEMO_SESSION_TTL_SECONDS = 60 * 60;

export const demoEnabled = () => (process.env.PORTAL_DEMO_ENABLED ?? "1").trim() !== "0";
const needDemo = () => {
  if (!demoEnabled()) throw new PortalError("El modo demostración está desactivado.", 403, "DEMO_DISABLED");
};
const tokenHash = (t: string) => hmac("demo-token", t);
const sessionHash = (t: string) => hmac("demo-session", t);
const TOKEN_RE = /^[A-Za-z0-9_-]{30,100}$/;

export type DemoSession = { id: string; createdBy: string; expiresAt: string; state: DemoState };

/** Emite un token de un solo uso para el usuario interno autorizado y devuelve la URL de apertura (token en el fragmento). */
export async function createDemoToken(staff: Staff, db: SqlExec = requireDb()): Promise<{ url: string; expiresInSeconds: number }> {
  needDemo();
  if (!canManagePortal(staff.sector)) throw new PortalError("Solo Producción y Dirección pueden abrir el portal de prueba.", 403, "FORBIDDEN");
  const lim = await rateLimitHit(db, `demo-launch:${hmac("email", staff.email).slice(0, 24)}`, 3600, 30);
  if (!lim.allowed) throw new PortalError("Demasiadas aperturas del portal de prueba. Probá de nuevo en un rato.", 429, "RATE_LIMITED");
  const token = createToken();
  await db.execute(sql`
    insert into portal_demo_tokens (id, token_hash, created_by, created_by_sector, expires_at)
    values (${randomUUID()}::uuid, ${tokenHash(token)}, ${staff.email}, ${staff.sector}, now() + (${DEMO_TOKEN_TTL_SECONDS} * interval '1 second'))`);
  await audit(db, { type: "DEMO_TOKEN_EMITIDO", kind: "STAFF", actor: staff.email });
  return { url: `${portalPublicBaseUrl()}/demo#t=${token}`, expiresInSeconds: DEMO_TOKEN_TTL_SECONDS };
}

export type RedeemResult = { ok: true; sessionToken: string; expiresAt: string } | { ok: false; reason: "invalid" | "rate_limited" | "disabled" };

/** Canjea el token (una sola vez, antes de que venza) por una sesión demo. Todos los fallos son indistinguibles. */
export async function redeemDemoToken(input: { token: unknown; headers: Headers }, db: SqlExec = requireDb()): Promise<RedeemResult> {
  if (!demoEnabled()) return { ok: false, reason: "disabled" };
  const ipHash = clientIpHash(input.headers);
  if (!(await rateLimitHit(db, `demo-redeem:ip:${ipHash}`, 600, 30)).allowed) return { ok: false, reason: "rate_limited" };
  const token = typeof input.token === "string" && TOKEN_RE.test(input.token) ? input.token : null;
  if (!token) return { ok: false, reason: "invalid" };
  const rows = (await db.execute(sql`
    update portal_demo_tokens set consumed_at = now(), ip_hash = ${ipHash}
     where token_hash = ${tokenHash(token)} and consumed_at is null and expires_at > now()
    returning created_by, created_by_sector`)).rows as Row[];
  const t = rows[0];
  if (!t) {
    await audit(db, { type: "DEMO_TOKEN_RECHAZADO", kind: "SISTEMA", ipHash });
    return { ok: false, reason: "invalid" };
  }
  const sessionToken = createToken();
  const ins = (await db.execute(sql`
    insert into portal_demo_sessions (id, token_hash, created_by, created_by_sector, expires_at, ip_hash, user_agent)
    values (${randomUUID()}::uuid, ${sessionHash(sessionToken)}, ${String(t.created_by)}, ${String(t.created_by_sector)},
            now() + (${DEMO_SESSION_TTL_SECONDS} * interval '1 second'), ${ipHash}, ${input.headers.get("user-agent")?.slice(0, 240) ?? null})
    returning expires_at`)).rows as Row[];
  await audit(db, { type: "DEMO_SESION_INICIADA", kind: "STAFF", actor: String(t.created_by), ipHash });
  return { ok: true, sessionToken, expiresAt: isoOrNull(ins[0]?.expires_at)! };
}

/** Sesión demo vigente (no vencida ni cerrada) a partir del token de la cookie. */
export async function resolveDemoSession(token: string | null, db: SqlExec = requireDb()): Promise<DemoSession | null> {
  if (!token || !demoEnabled()) return null;
  const rows = (await db.execute(sql`
    select id::text as id, created_by, expires_at, confirmations from portal_demo_sessions
     where token_hash = ${sessionHash(token)} and revoked_at is null and expires_at > now() limit 1`)).rows as Row[];
  const r = rows[0];
  if (!r) return null;
  const conf = r.confirmations && typeof r.confirmations === "object" ? (r.confirmations as Record<string, string>) : {};
  return { id: String(r.id), createdBy: String(r.created_by), expiresAt: isoOrNull(r.expires_at)!, state: { confirmations: conf } };
}

export async function demoPayload(session: DemoSession, now = new Date(), db: SqlExec = requireDb()) {
  return buildDemoPayload(session.id, now, session.state, await loadCalendarOptions(db));
}

export async function demoReceiptPreview(session: DemoSession, opaqueId: string, db: SqlExec = requireDb()) {
  return findDemoDelivery(session.id, opaqueId, new Date(), session.state, await loadCalendarOptions(db))?.view ?? null;
}

/** Confirmación SIMULADA: solo marca la entrega ficticia dentro de la sesión demo. Nada real se crea ni se modifica. */
export async function demoConfirmReceipt(session: DemoSession, opaqueId: string, db: SqlExec = requireDb()): Promise<ConfirmResult> {
  const now = new Date();
  const found = findDemoDelivery(session.id, opaqueId, now, session.state, await loadCalendarOptions(db));
  if (!found) return { ok: false, reason: "not_found" };
  if (found.view.confirmation) return { ok: false, reason: "already_confirmed" };
  const rows = (await db.execute(sql`
    update portal_demo_sessions set confirmations = confirmations || jsonb_build_object(${found.key}::text, ${now.toISOString()}::text)
     where id = ${session.id}::uuid and revoked_at is null and expires_at > now() and not (confirmations ? ${found.key}::text)
    returning id`)).rows;
  if (!rows.length) return { ok: false, reason: "already_confirmed" };
  const v = found.view;
  return { ok: true, confirmation: { id: v.id, confirmedAt: now.toISOString(), deliveredAt: v.deliveredAt, product: v.product, orderRef: v.orderRef, quantity: v.quantity, unit: v.unit } };
}

/** Vuelve la demo al estado inicial (borra las recepciones simuladas de esta sesión). */
export async function demoReset(session: DemoSession, db: SqlExec = requireDb()): Promise<void> {
  await db.execute(sql`update portal_demo_sessions set confirmations = '{}'::jsonb where id = ${session.id}::uuid`);
}

export async function demoLogout(token: string | null, db: SqlExec = requireDb()): Promise<void> {
  if (!token) return;
  await db.execute(sql`update portal_demo_sessions set revoked_at = now() where token_hash = ${sessionHash(token)} and revoked_at is null`);
}
