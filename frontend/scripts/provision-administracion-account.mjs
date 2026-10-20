/**
 * Alta segura de la cuenta de Administración / Facturación — Production Neon (la corre EL PROPIETARIO, no la app).
 *
 *   DATABASE_URL=<neon prod> node scripts/provision-administracion-account.mjs [--check] [--verify]
 *
 * Qué hace:
 *  - Verifica si el correo YA existe. Si existe, NO crea nada ni toca su contraseña, sector ni estado (informa y termina).
 *  - Si no existe, crea UNA cuenta (sector ADMINISTRACION, rol ROL-AD, estado ACTIVO) con la contraseña que el
 *    propietario escribe (dos veces) en un prompt oculto, o por stdin (2 líneas) si no hay TTY.
 *  - Guarda solo el hash bcrypt (costo 12). Registra un evento de auditoría SIN contraseña ni hash.
 *  - Con --verify hace un login HTTP real contra CUTOVER_URL (por defecto https://appgenus.vercel.app) para comprobar que entra.
 *  - Con --check no escribe nada: solo informa si el correo existe.
 *
 * Nunca imprime la contraseña ni el hash. No hay contraseña en el repo, en variables ni en logs. No usa `admin123`.
 * No cambia contraseñas ni privilegios de NINGUNA otra cuenta.
 */
import readline from "node:readline";
import bcrypt from "bcryptjs";
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";

neonConfig.webSocketConstructor = ws;

const EMAIL = (process.env.GENUS_ADMIN_ACCOUNT_EMAIL || "admin@laboratoriogenus.com.ar").trim().toLowerCase();
const BASE = process.env.CUTOVER_URL || "https://appgenus.vercel.app";
const COST = 12;
const MIN_LEN = 10;
const FORBIDDEN = new Set(["admin123", "admin1234", "administracion", "password", "12345678", "123456789", "1234567890", "genus123", "laboratoriogenus"]);
const args = new Set(process.argv.slice(2));

const out = (o) => console.log(JSON.stringify(o));
const sanitize = (raw) => String(raw ?? "").replace(/^﻿/, "").replace(/[\r\n]+/g, "");
const masked = (email) => email.replace(/^(.).*(@.*)$/, "$1***$2");

function hiddenPrompt(label) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(label)) process.stderr.write(s); };
    rl.question(label, (answer) => { rl.close(); process.stderr.write("\n"); resolve(sanitize(answer)); });
  });
}
async function readPair() {
  if (process.stdin.isTTY) return [await hiddenPrompt("Nueva contraseña (oculta): "), await hiddenPrompt("Repetir contraseña: ")];
  const lines = [];
  for await (const line of readline.createInterface({ input: process.stdin, terminal: false })) {
    lines.push(sanitize(line));
    if (lines.length >= 2) break;
  }
  return [lines[0] ?? "", lines[1] ?? ""];
}

if (!process.env.DATABASE_URL) {
  out({ ok: false, reason: "DATABASE_URL_missing" });
  process.exit(1);
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();
try {
  const found = await client.query("select id, status, sector from genus_auth_users where email_normalized = $1", [EMAIL]);
  if (found.rows[0]) {
    out({ ok: true, created: false, reason: "already_registered", email: masked(EMAIL), status: found.rows[0].status, sector: found.rows[0].sector, note: "No se modificó nada. Para cambiar su contraseña usá /administracion/usuarios (superadmin)." });
    process.exit(0);
  }
  if (args.has("--check")) {
    out({ ok: true, created: false, reason: "not_registered_dry_run", email: masked(EMAIL) });
    process.exit(0);
  }

  const [a, b] = await readPair();
  if (a.length < MIN_LEN) { out({ ok: false, reason: "password_too_short", min: MIN_LEN }); process.exit(1); }
  if (a !== b) { out({ ok: false, reason: "password_mismatch" }); process.exit(1); }
  if (FORBIDDEN.has(a.toLowerCase())) { out({ ok: false, reason: "password_too_common" }); process.exit(1); }

  const hash = await bcrypt.hash(a, COST);
  await client.query("begin");
  const dup = await client.query("select 1 from genus_auth_users where email_normalized = $1 for update", [EMAIL]);
  if (dup.rowCount) { await client.query("rollback"); out({ ok: true, created: false, reason: "already_registered_race" }); process.exit(0); }
  const ins = await client.query(
    `insert into genus_auth_users (id, email, email_normalized, display_name, sector, role_id, role_label, sector_label, job_title, status, password_hash, redirect_to, created_at, updated_at)
     values (gen_random_uuid(), $1, $1, 'Administración / Facturación', 'ADMINISTRACION', 'ROL-AD', 'Administración', 'Administración / Facturación', 'Administración y Facturación', 'ACTIVO', $2, '/mi-trabajo', now(), now())
     returning id`,
    [EMAIL, hash]
  );
  await client.query(
    `insert into genus_auth_audit_events (id, event_type, email_normalized, user_id, detail, created_at)
     values (gen_random_uuid(), 'ADMIN_USER_UPDATE', $1, $2, $3::jsonb, now())`,
    [EMAIL, ins.rows[0].id, JSON.stringify({ action: "provision_account", sector: "ADMINISTRACION", via: "provision-administracion-account.mjs", otherUsersUntouched: true })]
  );
  await client.query("commit");
  out({ ok: true, created: true, email: masked(EMAIL), sector: "ADMINISTRACION", status: "ACTIVO" });

  if (args.has("--verify")) {
    const res = await fetch(`${BASE}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: EMAIL, password: a }) });
    out({ verifyLogin: res.ok ? "ok" : `http_${res.status}`, base: BASE });
  }
} catch (error) {
  try { await client.query("rollback"); } catch { /* ignore */ }
  out({ ok: false, reason: "error", message: error instanceof Error ? error.message.replace(/postgres(ql)?:\/\/\S+/gi, "[redacted]") : "unknown" });
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
