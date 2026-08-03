/**
 * Resolve Preview connection URI via Neon API (NEON_API_KEY).
 * Prints only anonymized hosts — never full URLs/secrets.
 * Optionally writes a gitignored file when WRITE_PREVIEW_DB_ENV=1.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PREVIEW_HOST_MARKER = "polished-recipe";
const API = "https://console.neon.tech/api/v2";

function loadEnv(file) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    if (!line || line.trimStart().startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const key = line.slice(0, i).trim();
    let value = line.slice(i + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (value && value !== "[SENSITIVE]") out[key] = value;
  }
  return out;
}

const env = {
  ...loadEnv(path.join(root, ".env.local")),
  ...loadEnv(path.join(root, ".env.preview.local")),
  ...Object.fromEntries(
    Object.entries(process.env).filter(([, v]) => v && v !== "[SENSITIVE]")
  ),
};

const apiKey = (env.NEON_API_KEY || env.NEON_API_TOKEN || "").trim();
if (!apiKey) {
  console.error("NEON_API_KEY missing");
  process.exit(1);
}

async function neonFetch(pathname, options = {}) {
  const res = await fetch(`${API}${pathname}`, {
    ...options,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Neon ${pathname} → ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

function anonHost(url) {
  try {
    const endpoint = new URL(url).hostname.split(".")[0].replace(/-pooler$/, "");
    return `${endpoint.split("-").slice(0, 3).join("-")}-***`;
  } catch {
    return "(invalid)";
  }
}

const orgs = await neonFetch("/users/me/organizations");
const orgId = orgs.organizations?.[0]?.id;
if (!orgId) throw new Error("No Neon org");

const projects = await neonFetch(`/projects?org_id=${encodeURIComponent(orgId)}`);
let match = null;

for (const project of projects.projects || []) {
  const endpoints = await neonFetch(`/projects/${project.id}/endpoints`);
  for (const endpoint of endpoints.endpoints || []) {
    const host = String(endpoint.host || "");
    if (!host.includes(PREVIEW_HOST_MARKER)) continue;
    if (/prod|production/i.test(host)) continue;
    match = { project, endpoint };
    break;
  }
  if (match) break;
}

if (!match) {
  console.error("No Preview endpoint with polished-recipe found");
  process.exit(2);
}

const projectId = match.project.id;
const branchId = match.endpoint.branch_id;
const databaseName = "neondb";

const roles = await neonFetch(`/projects/${projectId}/branches/${branchId}/roles`);
const roleName =
  (roles.roles || []).find((r) => r.name?.includes("owner"))?.name ||
  roles.roles?.[0]?.name ||
  "neondb_owner";

const uriResp = await neonFetch(
  `/projects/${projectId}/connection_uri?branch_id=${encodeURIComponent(branchId)}&database_name=${encodeURIComponent(databaseName)}&role_name=${encodeURIComponent(roleName)}`
);
const uri = uriResp.uri || uriResp.connection_uri;
if (!uri) throw new Error("No connection URI");

const host = new URL(uri).hostname;
if (!host.includes(PREVIEW_HOST_MARKER)) throw new Error("Resolved URI is not Preview");
if (/prod|production/i.test(host)) throw new Error("Resolved URI looks like Production");

console.log(
  JSON.stringify(
    {
      ok: true,
      projectIdAnon: `${projectId.slice(0, 8)}***`,
      projectName: match.project.name,
      branchIdAnon: `${String(branchId).slice(0, 8)}***`,
      hostAnon: anonHost(uri),
      roleName,
      databaseName,
    },
    null,
    2
  )
);

if (process.env.WRITE_PREVIEW_DB_ENV === "1") {
  const outPath = path.join(root, ".env.preview.db.local");
  const unpooled = uri.replace("-pooler", "");
  fs.writeFileSync(
    outPath,
    [
      "# Gitignored Preview DB URIs resolved via Neon API — DO NOT COMMIT",
      `DATABASE_URL=${uri}`,
      `DATABASE_URL_UNPOOLED=${unpooled}`,
      `NEON_API_KEY=${apiKey}`,
      "",
    ].join("\n"),
    { encoding: "utf8", mode: 0o600 }
  );
  console.log("wrote", path.basename(outPath), "(gitignored pattern .env*.local)");
}
