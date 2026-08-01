/**
 * Dry-run aislado de drizzle/0016_genus_auth.sql.
 * Crea una rama Neon descartable desde Preview; nunca escribe Preview/Production.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const evidenceDir = path.join(root, "tmp-mig-0016-dryrun");
const migrationPath = path.join(root, "drizzle", "0016_genus_auth.sql");
const PREVIEW_HOST_MARKER = "polished-recipe";
const NEON_API = "https://console.neon.tech/api/v2";
fs.mkdirSync(evidenceDir, { recursive: true });

function loadEnv(file) {
  if (!fs.existsSync(file)) return {};
  return Object.fromEntries(
    fs.readFileSync(file, "utf8")
      .split(/\r?\n/)
      .filter((line) => line && !line.trimStart().startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        const key = line.slice(0, index).trim();
        let value = line.slice(index + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        return [key, value];
      })
  );
}

const envFiles = [".env.local", ".env.preview.local", ".env.preview.db.local"];
function scrubEnv(raw) {
  return Object.fromEntries(
    Object.entries(raw).filter(([, value]) => value && value !== "[SENSITIVE]")
  );
}
// Prefer resolved Preview DB file last among files; process.env never overrides
// real file URLs with empty/redacted placeholders.
const env = {
  ...scrubEnv(Object.fromEntries(Object.entries(process.env))),
  ...scrubEnv(loadEnv(path.join(root, envFiles[0]))),
  ...scrubEnv(loadEnv(path.join(root, envFiles[1]))),
  ...scrubEnv(loadEnv(path.join(root, envFiles[2]))),
};
const apiKey = (env.NEON_API_KEY || env.NEON_API_TOKEN || "").trim();
const previewUrl = (
  env.DATABASE_URL_UNPOOLED ||
  env.DATABASE_URL ||
  env.POSTGRES_URL_NON_POOLING ||
  env.POSTGRES_URL ||
  ""
).trim();

function anonHost(url) {
  try {
    const endpoint = new URL(url).hostname.split(".")[0].replace(/-pooler$/, "");
    return `${endpoint.split("-").slice(0, 3).join("-")}-***`;
  } catch {
    return "(invalid)";
  }
}

function assertPreviewUrl(url) {
  const host = new URL(url).hostname;
  if (!host.includes(PREVIEW_HOST_MARKER)) throw new Error(`Refusing non-Preview host (${anonHost(url)})`);
  if (/prod|production/i.test(host)) throw new Error("Refusing Production-looking host");
}

async function neonFetch(pathname, options = {}) {
  if (!apiKey) throw new Error("NEON_API_KEY required");
  const response = await fetch(`${NEON_API}${pathname}`, {
    ...options,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Neon API ${options.method || "GET"} ${pathname} → ${response.status}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : null;
}

async function waitOperations(projectId, operations) {
  for (const operation of operations || []) {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const current = await neonFetch(`/projects/${projectId}/operations/${operation.id}`);
      const status = current.operation?.status || current.status;
      if (status === "finished" || status === "completed") break;
      if (status === "failed" || status === "error" || status === "cancelled") {
        throw new Error(`Neon operation ${operation.id} failed: ${status}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

async function resolvePreviewProject() {
  const organizations = await neonFetch("/users/me/organizations");
  const orgId = organizations.organizations?.[0]?.id;
  if (!orgId) throw new Error("No Neon organization available for this API key");
  const projects = await neonFetch(`/projects?org_id=${encodeURIComponent(orgId)}`);
  const previewEndpoint = new URL(previewUrl).hostname.split(".")[0].replace(/-pooler$/, "");
  for (const project of projects.projects || []) {
    const endpoints = await neonFetch(`/projects/${project.id}/endpoints`);
    const match = (endpoints.endpoints || []).find((endpoint) => {
      const name = String(endpoint.host || "").split(".")[0].replace(/-pooler$/, "");
      return name === previewEndpoint || String(endpoint.host || "").includes(PREVIEW_HOST_MARKER);
    });
    if (match) return { projectId: project.id, parentBranchId: match.branch_id, projectName: project.name };
  }
  throw new Error("Could not resolve the Neon project that owns Preview");
}

async function snapshot(sql) {
  const tables = await sql`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename IN ('genus_auth_users', 'genus_auth_sessions', 'genus_auth_audit_events')
    ORDER BY tablename
  `;
  const formulas = await sql`
    SELECT
      (SELECT count(*)::int FROM formula_versions) AS versions,
      (SELECT count(*)::int FROM formula_versions WHERE status = 'VIGENTE') AS vigentes
  `.catch(() => [{ versions: null, vigentes: null }]);
  return { authTables: tables.map((row) => row.tablename), formulas: formulas[0] };
}

async function applyMigration(sql) {
  const statements = fs.readFileSync(migrationPath, "utf8")
    .split("--> statement-breakpoint")
    .map((statement) => statement.replace(/^\s*\/\*[\s\S]*?\*\//, "").trim())
    .filter(Boolean);
  for (const statement of statements) await sql.query(statement);
  return statements.length;
}

async function main() {
  const report = {
    ok: false,
    startedAt: new Date().toISOString(),
    envFilesConsidered: envFiles,
    migration: "drizzle/0016_genus_auth.sql",
    previewUntouched: true,
    productionUntouched: true,
    steps: [],
  };
  let projectId = null;
  let branchId = null;

  try {
    if (!previewUrl || previewUrl === "[SENSITIVE]") throw new Error("Missing Preview DATABASE_URL");
    assertPreviewUrl(previewUrl);
    report.previewHostAnon = anonHost(previewUrl);
    if (!apiKey) {
      report.blocked = "NEON_API_KEY_MISSING";
      throw new Error("NEON_API_KEY required");
    }

    const previewSql = neon(previewUrl);
    report.beforePreview = await snapshot(previewSql);
    report.steps.push({ step: "preview_readonly_baseline", ok: true });

    const resolved = await resolvePreviewProject();
    projectId = resolved.projectId;
    report.neonProjectIdAnon = `${projectId.slice(0, 8)}***`;
    report.neonProjectName = resolved.projectName || null;
    const name = `dryrun-0016-${Date.now()}`;
    const created = await neonFetch(`/projects/${projectId}/branches`, {
      method: "POST",
      body: JSON.stringify({ endpoints: [{ type: "read_write" }], branch: { name, parent_id: resolved.parentBranchId } }),
    });
    await waitOperations(projectId, created.operations);
    branchId = created.branch.id;
    report.tempBranch = { name, idAnon: `${String(branchId).slice(0, 8)}***` };

    let connectionUrl = created.connection_uris?.[0]?.connection_uri;
    if (!connectionUrl) {
      const preview = new URL(previewUrl);
      const uri = await neonFetch(
        `/projects/${projectId}/connection_uri?branch_id=${encodeURIComponent(branchId)}&database_name=${encodeURIComponent(preview.pathname.slice(1) || "neondb")}&role_name=${encodeURIComponent(preview.username || "neondb_owner")}`
      );
      connectionUrl = uri.uri || uri.connection_uri;
    }
    if (!connectionUrl) throw new Error("No connection URI returned for disposable branch");
    connectionUrl = connectionUrl.replace("-pooler", "");
    if (new URL(connectionUrl).hostname.includes(PREVIEW_HOST_MARKER)) {
      throw new Error("Safety check failed: disposable branch host resembles Preview");
    }
    report.tempHostAnon = anonHost(connectionUrl);

    const tempSql = neon(connectionUrl);
    report.beforeTemp = await snapshot(tempSql);
    const appliedStatements = await applyMigration(tempSql);
    report.afterApply = await snapshot(tempSql);
    report.steps.push({
      step: "apply_only_0016",
      ok: report.afterApply.authTables.length === 3,
      statements: appliedStatements,
      tables: report.afterApply.authTables,
    });

    await applyMigration(tempSql);
    report.afterIdempotent = await snapshot(tempSql);
    report.steps.push({
      step: "rerun_0016_idempotent",
      ok: JSON.stringify(report.afterApply.authTables) === JSON.stringify(report.afterIdempotent.authTables),
    });
    const formula = report.afterIdempotent.formulas;
    report.steps.push({
      step: "formulas_842_784",
      ok: formula.versions === 842 && formula.vigentes === 784,
      formulas: formula,
    });

    report.afterPreview = await snapshot(previewSql);
    report.previewUntouched = JSON.stringify(report.beforePreview) === JSON.stringify(report.afterPreview);
    report.steps.push({ step: "preview_unchanged", ok: report.previewUntouched });
    report.ok = report.steps.every((step) => step.ok !== false);
  } catch (error) {
    report.ok = false;
    report.error = String(error?.message || error);
  } finally {
    if (projectId && branchId) {
      try {
        await neonFetch(`/projects/${projectId}/branches/${branchId}`, { method: "DELETE" });
        report.tempBranchDeleted = true;
        report.steps.push({ step: "delete_disposable_branch", ok: true });
      } catch (error) {
        report.tempBranchDeleted = false;
        report.steps.push({ step: "delete_disposable_branch", ok: false, error: String(error?.message || error) });
        report.ok = false;
      }
    }
  }

  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(evidenceDir, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : report.blocked === "NEON_API_KEY_MISSING" ? 3 : 1);
}

main();
