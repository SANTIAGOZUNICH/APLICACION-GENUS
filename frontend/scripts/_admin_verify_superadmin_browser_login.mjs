/**
 * Re-verify SUPERADMIN against Production HTTP login (same body shape as GenusAuthAdapter).
 * Password via stdin (one line). Never prints password/email/hash.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
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
  return String(raw ?? "").replace(/^\uFEFF/, "").replace(/[\r\n]+/g, "").trimEnd();
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

const email =
  process.env.GENUS_SUPERADMIN_EMAIL ||
  load(path.join(root, "tmp-prod-neon-bootstrap", ".env.superadmin.local"))
    .GENUS_SUPERADMIN_EMAIL;
const emailNormalized = normalizeEmail(email);
if (!emailNormalized) {
  console.log(JSON.stringify({ ok: false, reason: "email_unresolved" }));
  process.exit(1);
}

let password = "";
for await (const line of readline.createInterface({
  input: process.stdin,
  terminal: false,
})) {
  password = sanitizePassword(line);
  break;
}
if (!password || password.length < 8) {
  console.log(JSON.stringify({ ok: false, reason: "password_too_short", len: password.length }));
  process.exit(1);
}

const jar = new Map();
const login = await fetchJar(`${BASE}/api/v1/auth/login`, jar, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    email: emailNormalized,
    password,
    rememberMe: true,
  }),
});
password = "";
const body = await login.json().catch(() => ({}));
const cookieEmitted = jar.has("genus_session");
const me = await fetchJar(`${BASE}/api/v1/auth/me`, jar);
const meBody = await me.json().catch(() => ({}));
const adminPage = await fetchJar(`${BASE}/administracion/usuarios`, jar);
const role =
  meBody?.user?.role || meBody?.user?.roleId || meBody?.role || null;
const sector = meBody?.user?.sector || meBody?.sector || null;

const report = {
  httpLoginStatus: login.status,
  httpLoginOk: login.status === 200,
  cookieEmitted,
  meStatus: me.status,
  meRole: role,
  meSector: sector,
  adminPanelStatus: adminPage.status,
  adminPanelOk: adminPage.status === 200,
  errorCode: body?.code || body?.error || null,
  secretsInLogs: false,
  ok: login.status === 200 && cookieEmitted && me.status === 200 && adminPage.status === 200,
  at: new Date().toISOString(),
};

fs.mkdirSync(path.join(root, "tmp-cutover"), { recursive: true });
fs.writeFileSync(
  path.join(root, "tmp-cutover", "superadmin-browser-verify-result.json"),
  JSON.stringify(report, null, 2)
);
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
