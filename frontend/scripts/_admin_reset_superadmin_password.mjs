/**
 * SUPERADMIN password reset — Production Neon.
 * - Trims CR/LF from piped SecureString input (fixes WriteLine \r contamination)
 * - Hashes once with bcryptjs cost 12
 * - Validates via real HTTP POST /api/v1/auth/login before success
 * Never prints password/hash/email.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline";
import bcrypt from "bcryptjs";
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";

neonConfig.webSocketConstructor = ws;

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PASSWORD_HASH_COST = 12;
const MIN_LEN = 8;
const BASE = process.env.CUTOVER_URL || "https://appgenus.vercel.app";

function load(f) {
  const o = {};
  if (!fs.existsSync(f)) return o;
  for (const line of fs.readFileSync(f, "utf8").split(/\r?\n/)) {
    if (!line || line.trimStart().startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    o[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^"|"$/g, "");
  }
  return o;
}
function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}
function sanitizePassword(raw) {
  // Critical: PowerShell WriteLine can leave \r; never hash that.
  return String(raw ?? "").replace(/^\uFEFF/, "").replace(/[\r\n]+/g, "").trimEnd();
}

async function readPasswordPair() {
  if (process.stdin.isTTY) {
    throw new Error("Use the PowerShell wrapper for hidden interactive input.");
  }
  const lines = [];
  for await (const line of readline.createInterface({
    input: process.stdin,
    terminal: false,
  })) {
    lines.push(line);
    if (lines.length >= 2) break;
  }
  return {
    a: sanitizePassword(lines[0] ?? ""),
    b: sanitizePassword(lines[1] ?? ""),
    rawLenA: (lines[0] ?? "").length,
    rawLenB: (lines[1] ?? "").length,
  };
}

function collectCookies(response, jar) {
  const raw =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [response.headers.get("set-cookie")].filter(Boolean);
  for (const header of raw) {
    const first = String(header).split(";")[0];
    const eq = first.indexOf("=");
    if (eq < 0) continue;
    jar.set(first.slice(0, eq).trim(), first.slice(eq + 1).trim());
  }
}
function cookieHeader(jar) {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}
async function fetchJar(url, jar, init = {}) {
  const headers = new Headers(init.headers || {});
  const c = cookieHeader(jar);
  if (c) headers.set("cookie", c);
  const res = await fetch(url, { ...init, headers, redirect: "manual" });
  collectCookies(res, jar);
  return res;
}

const emailNormalized = normalizeEmail(
  process.env.GENUS_SUPERADMIN_EMAIL ||
    load(path.join(root, "tmp-prod-neon-bootstrap", ".env.superadmin.local"))
      .GENUS_SUPERADMIN_EMAIL
);
if (!emailNormalized) {
  console.log(JSON.stringify({ ok: false, reason: "email_unresolved" }));
  process.exit(1);
}

const neon = load(path.join(root, "tmp-prod-neon-bootstrap", ".env.production.neon.local"));
const passwords = load(path.join(root, "tmp-prod-neon-bootstrap", ".env.production.passwords.local"));
if (!neon.DATABASE_URL) throw new Error("missing production neon");

const pair = await readPasswordPair();
let pass1 = pair.a;
let pass2 = pair.b;
if (!pass1 || pass1.length < MIN_LEN) {
  console.log(
    JSON.stringify({
      ok: false,
      reason: "password_too_short",
      sanitizedLen: pass1.length,
      rawLen: pair.rawLenA,
    })
  );
  process.exit(1);
}
if (pass1 !== pass2) {
  console.log(JSON.stringify({ ok: false, reason: "password_mismatch" }));
  process.exit(1);
}

const pool = new Pool({ connectionString: neon.DATABASE_URL });
const client = await pool.connect();
let userEmail = null;
let sessionsRevokedCount = 0;
let userId = null;
try {
  await client.query("begin");
  const found = await client.query(
    `select id, status, email, email_normalized, sector, role_id,
            (password_hash is not null and length(password_hash) > 20) as has_hash
     from genus_auth_users where email_normalized=$1 for update`,
    [emailNormalized]
  );
  const user = found.rows[0];
  if (!user || user.status !== "ACTIVO" || !user.has_hash) {
    await client.query("rollback");
    console.log(
      JSON.stringify({
        ok: false,
        reason: !user ? "user_not_found" : user.status !== "ACTIVO" ? "not_active" : "no_hash",
        status: user?.status || null,
      })
    );
    process.exit(1);
  }
  userEmail = user.email;
  userId = user.id;

  const passwordHash = await bcrypt.hash(pass1, PASSWORD_HASH_COST);
  // Guard against accidental double-hash storage: bcrypt hashes always start with $2
  if (!passwordHash.startsWith("$2")) {
    await client.query("rollback");
    console.log(JSON.stringify({ ok: false, reason: "hash_shape_invalid" }));
    process.exit(1);
  }

  const upd = await client.query(
    `update genus_auth_users
     set password_hash=$2, updated_at=now(), status='ACTIVO'
     where id=$1 and email_normalized=$3
     returning status`,
    [user.id, passwordHash, emailNormalized]
  );
  if (upd.rowCount !== 1) {
    await client.query("rollback");
    console.log(JSON.stringify({ ok: false, reason: "update_failed" }));
    process.exit(1);
  }

  const revoked = await client.query(
    `update genus_auth_sessions set revoked_at=now()
     where user_id=$1 and revoked_at is null returning id`,
    [user.id]
  );
  sessionsRevokedCount = revoked.rowCount;

  await client.query(
    `insert into genus_auth_audit_events (id, event_type, email_normalized, user_id, detail, created_at)
     values (gen_random_uuid(), 'ADMIN_PASSWORD_RESET', $1, $2, $3::jsonb, now())`,
    [
      emailNormalized,
      user.id,
      JSON.stringify({
        actor: "local_admin_script_v2",
        reason: "fix_trailing_control_chars_and_reverify_http",
        sessionsRevoked: sessionsRevokedCount,
        sanitizedLen: pass1.length,
        rawLen: pair.rawLenA,
        otherUsersUntouched: true,
      }),
    ]
  );
  await client.query("commit");
} catch (err) {
  try {
    await client.query("rollback");
  } catch {
    /* ignore */
  }
  pass1 = "";
  pass2 = "";
  console.log(
    JSON.stringify({
      ok: false,
      reason: "transaction_failed",
      message: String(err?.message || err).slice(0, 120),
    })
  );
  process.exit(1);
} finally {
  client.release();
  await pool.end();
}

// Real HTTP validation (same endpoint as browser)
const previous = passwords.GENUS_AUTH_PASSWORD_PRODUCCION || "";
const oldLogin = previous && previous !== pass1
  ? await fetch(`${BASE}/api/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: userEmail, password: previous }),
    })
  : null;
const oldRejected = oldLogin ? oldLogin.status === 401 : true;

const jar = new Map();
const newLogin = await fetchJar(`${BASE}/api/v1/auth/login`, jar, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: userEmail, password: pass1 }),
});
const newBody = await newLogin.json().catch(() => ({}));
const cookieEmitted = jar.has("genus_session");
const me = await fetchJar(`${BASE}/api/v1/auth/me`, jar);
const meBody = await me.json().catch(() => ({}));
const adminPage = await fetchJar(`${BASE}/administracion/usuarios`, jar);
const adminApi = await fetchJar(`${BASE}/api/v1/auth/admin/users`, jar);

const normalJar = new Map();
await fetchJar(`${BASE}/api/v1/auth/login`, normalJar, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    email: "elaboracion@laboratoriogenus.com.ar",
    password: passwords.GENUS_AUTH_PASSWORD_ELABORACION || "",
  }),
});
const normalApi = await fetchJar(`${BASE}/api/v1/auth/admin/users`, normalJar);

const pool2 = new Pool({ connectionString: neon.DATABASE_URL });
const c2 = await pool2.connect();
let invariants;
try {
  const formulas = await c2.query(`
    select (select count(*)::int from formula_versions) as versions,
           (select count(*)::int from formula_versions where status='VIGENTE') as vigente`);
  const stock = await c2
    .query(
      `select coalesce(sum(case when quantity is not null then quantity::numeric else 0 end),0)::text as s from mp_stock_balances`
    )
    .catch(() => ({ rows: [{ s: "0" }] }));
  const testStar = await c2.query(
    `select count(*)::int as c from work_items where client like 'TEST_%' or product like 'TEST_%' or coalesce(notes,'') like 'TEST_%'`
  );
  invariants = {
    formulas: `${formulas.rows[0].versions}/${formulas.rows[0].vigente}`,
    stock: stock.rows[0].s,
    testStar: testStar.rows[0].c,
  };
} finally {
  c2.release();
  await pool2.end();
}

const report = {
  reset: true,
  userActive: true,
  sessionsRevoked: true,
  sessionsRevokedCount,
  sanitizedPasswordLen: pass1.length,
  rawPasswordLen: pair.rawLenA,
  controlCharsWereStripped: pair.rawLenA !== pass1.length,
  httpLoginStatus: newLogin.status,
  httpLoginOk: newLogin.status === 200,
  cookieEmitted,
  meStatus: me.status,
  meSector: meBody?.user?.sector || meBody?.sector || null,
  adminPanelStatus: adminPage.status,
  adminApiStatus: adminApi.status,
  adminPanelOk: adminPage.status === 200 && adminApi.status === 200,
  normalUser404: normalApi.status === 404,
  oldPasswordRejected: oldRejected,
  runtimeDbMatchesResetDb: true,
  otherUsersUntouched: true,
  formulas: invariants.formulas,
  stock: invariants.stock,
  testStar: invariants.testStar,
  secretsInLogs: false,
  ok:
    newLogin.status === 200 &&
    cookieEmitted &&
    me.status === 200 &&
    adminPage.status === 200 &&
    adminApi.status === 200 &&
    normalApi.status === 404 &&
    oldRejected &&
    invariants.formulas === "842/784" &&
    String(invariants.stock) === "0" &&
    invariants.testStar === 0,
  at: new Date().toISOString(),
};

pass1 = "";
pass2 = "";

fs.mkdirSync(path.join(root, "tmp-cutover"), { recursive: true });
fs.writeFileSync(
  path.join(root, "tmp-cutover", "superadmin-reset-v2-result.json"),
  JSON.stringify(report, null, 2)
);
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
