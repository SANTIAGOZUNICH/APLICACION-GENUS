import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { hashPassword } from "@/lib/auth/password";
import { ACTIVATION_TTL_MINUTES, ADMIN_ACCOUNT, validateNewPassword } from "@/lib/auth/admin-activation-rules";
import { AuthConflictError, AuthNotFoundError, AuthValidationError } from "@/lib/auth/types";

type Row = Record<string, unknown>;
type Tx = { execute: (q: ReturnType<typeof sql>) => Promise<{ rows: unknown[] }> };

const PURPOSE = "ADMIN_ACCOUNT";
const hashToken = (token: string) => createHash("sha256").update(token, "utf8").digest("hex");
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export type AdminAccountStatus = {
  email: string;
  exists: boolean;
  userStatus: string | null;
  sector: string | null;
  pendingActivation: { expiresAt: string } | null;
};

/** Estado de la cuenta para el superadministrador: ¿existe? ¿hay un enlace vigente? */
export async function getAdminAccountStatus(): Promise<AdminAccountStatus> {
  const db = getDb() as unknown as Tx;
  const user = ((await db.execute(sql`select status, sector from genus_auth_users where email_normalized = ${ADMIN_ACCOUNT.email}`)).rows as Row[])[0];
  const act = ((await db.execute(sql`select expires_at from genus_auth_activations where email_normalized = ${ADMIN_ACCOUNT.email} and purpose = ${PURPOSE} and used_at is null and revoked_at is null and expires_at > now() order by created_at desc limit 1`)).rows as Row[])[0];
  return {
    email: ADMIN_ACCOUNT.email,
    exists: Boolean(user),
    userStatus: user ? String(user.status) : null,
    sector: user ? String(user.sector) : null,
    pendingActivation: act ? { expiresAt: new Date(String(act.expires_at)).toISOString() } : null,
  };
}

/**
 * Emite un enlace de activación de un solo uso. Solo lo invoca la ruta de superadministrador (ya autenticada).
 * Rechaza si la cuenta ya existe (nunca pisa una cuenta). Revoca enlaces anteriores sin usar.
 */
export async function issueAdminActivation(actorEmail: string): Promise<{ token: string; expiresAt: string }> {
  return getDb().transaction(async (tx: Tx) => {
    const exists = ((await tx.execute(sql`select 1 from genus_auth_users where email_normalized = ${ADMIN_ACCOUNT.email}`)).rows as Row[]).length > 0;
    if (exists) throw new AuthConflictError("La cuenta de Administración ya existe: no se emite un enlace de activación.");
    await tx.execute(sql`update genus_auth_activations set revoked_at = now() where email_normalized = ${ADMIN_ACCOUNT.email} and purpose = ${PURPOSE} and used_at is null and revoked_at is null`);
    const token = randomBytes(32).toString("base64url");
    const expires = new Date(Date.now() + ACTIVATION_TTL_MINUTES * 60_000);
    await tx.execute(sql`insert into genus_auth_activations (purpose, email_normalized, token_hash, expires_at, created_by) values (${PURPOSE}, ${ADMIN_ACCOUNT.email}, ${hashToken(token)}, ${expires.toISOString()}::timestamptz, ${actorEmail})`);
    await tx.execute(sql`insert into genus_auth_audit_events (id, event_type, email_normalized, user_id, detail, created_at) values (gen_random_uuid(), 'ADMIN_USER_UPDATE', ${ADMIN_ACCOUNT.email}, null, ${JSON.stringify({ action: "activation_issued", by: actorEmail, expiresAt: expires.toISOString() })}::jsonb, now())`);
    return { token, expiresAt: expires.toISOString() };
  });
}

export async function revokeAdminActivation(actorEmail: string): Promise<number> {
  const res = (await (getDb() as unknown as Tx).execute(sql`update genus_auth_activations set revoked_at = now() where email_normalized = ${ADMIN_ACCOUNT.email} and purpose = ${PURPOSE} and used_at is null and revoked_at is null returning id`)).rows;
  if (res.length > 0) {
    await (getDb() as unknown as Tx).execute(sql`insert into genus_auth_audit_events (id, event_type, email_normalized, user_id, detail, created_at) values (gen_random_uuid(), 'ADMIN_USER_UPDATE', ${ADMIN_ACCOUNT.email}, null, ${JSON.stringify({ action: "activation_revoked", by: actorEmail })}::jsonb, now())`);
  }
  return res.length;
}

/** ¿El enlace sirve todavía? Respuesta mínima: no distingue entre inexistente, vencido o usado. */
export async function inspectAdminActivation(token: string): Promise<{ valid: boolean; email?: string; expiresAt?: string }> {
  if (!TOKEN_RE.test(token)) return { valid: false };
  const row = ((await (getDb() as unknown as Tx).execute(sql`
    select a.expires_at from genus_auth_activations a
     where a.token_hash = ${hashToken(token)} and a.purpose = ${PURPOSE} and a.used_at is null and a.revoked_at is null and a.expires_at > now()
       and not exists (select 1 from genus_auth_users u where u.email_normalized = a.email_normalized)`)).rows as Row[])[0];
  return row ? { valid: true, email: ADMIN_ACCOUNT.email, expiresAt: new Date(String(row.expires_at)).toISOString() } : { valid: false };
}

/**
 * Canjea el enlace (un solo uso) y crea la cuenta: sector ADMINISTRACION, rol ROL-AD, ACTIVO, sin privilegios de superadmin.
 * Todo en una transacción: el enlace se consume con un UPDATE atómico; si la cuenta ya existe o algo falla, nada queda a medias.
 */
export async function redeemAdminActivation(token: string, password: string): Promise<{ email: string }> {
  const invalid = new AuthNotFoundError();
  if (!TOKEN_RE.test(token)) throw invalid;
  const weak = validateNewPassword(password);
  if (weak) throw new AuthValidationError(weak);
  const passwordHash = await hashPassword(password);
  return getDb().transaction(async (tx: Tx) => {
    const used = ((await tx.execute(sql`
      update genus_auth_activations set used_at = now()
       where token_hash = ${hashToken(token)} and purpose = ${PURPOSE} and used_at is null and revoked_at is null and expires_at > now()
       returning id, created_by`)).rows as Row[])[0];
    if (!used) throw invalid;
    const dup = ((await tx.execute(sql`select 1 from genus_auth_users where email_normalized = ${ADMIN_ACCOUNT.email} for update`)).rows as Row[]).length > 0;
    if (dup) throw new AuthConflictError("La cuenta de Administración ya existe.");
    const a = ADMIN_ACCOUNT;
    const ins = ((await tx.execute(sql`
      insert into genus_auth_users (id, email, email_normalized, display_name, sector, role_id, role_label, sector_label, job_title, status, password_hash, redirect_to, created_at, updated_at)
      values (gen_random_uuid(), ${a.email}, ${a.email}, ${a.displayName}, ${a.sector}, ${a.roleId}, ${a.roleLabel}, ${a.sectorLabel}, ${a.jobTitle}, 'ACTIVO', ${passwordHash}, ${a.redirectTo}, now(), now())
      returning id`)).rows as Row[])[0];
    await tx.execute(sql`insert into genus_auth_audit_events (id, event_type, email_normalized, user_id, detail, created_at) values (gen_random_uuid(), 'ADMIN_USER_UPDATE', ${a.email}, ${String(ins.id)}::uuid, ${JSON.stringify({ action: "activation_redeemed", sector: a.sector, role: a.roleId, issuedBy: String(used.created_by), superadmin: false })}::jsonb, now())`);
    return { email: a.email };
  });
}
