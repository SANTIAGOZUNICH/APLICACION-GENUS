/**
 * Live dry-run 0014 → 0015 → 0017 on disposable Neon branch from Preview.
 * Never writes Preview/Production. Deletes temp branch in finally.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const evidenceDir = path.join(root, "tmp-mig-0014-0015-0017-dryrun");
const PREVIEW_HOST_MARKER = "polished-recipe";
const NEON_API = "https://console.neon.tech/api/v2";
fs.mkdirSync(evidenceDir, { recursive: true });

const MIGRATIONS = [
  "drizzle/0014_codificado_deposito_graneles.sql",
  "drizzle/0015_creamy_memory.sql",
  "drizzle/0017_creamy_userid_notif_idempotency.sql",
];

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

function scrub(raw) {
  return Object.fromEntries(
    Object.entries(raw).filter(([, v]) => v && v !== "[SENSITIVE]")
  );
}

const env = {
  ...scrub(process.env),
  ...scrub(loadEnv(path.join(root, ".env.local"))),
  ...scrub(loadEnv(path.join(root, ".env.preview.local"))),
  ...scrub(loadEnv(path.join(root, ".env.preview.db.local"))),
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
  if (!host.includes(PREVIEW_HOST_MARKER)) {
    throw new Error(`Refusing non-Preview host (${anonHost(url)})`);
  }
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
  if (!response.ok) {
    throw new Error(`Neon API ${pathname} → ${response.status}: ${text.slice(0, 400)}`);
  }
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
  if (!orgId) throw new Error("No Neon organization");
  const projects = await neonFetch(`/projects?org_id=${encodeURIComponent(orgId)}`);
  const previewEndpoint = new URL(previewUrl).hostname.split(".")[0].replace(/-pooler$/, "");
  for (const project of projects.projects || []) {
    const endpoints = await neonFetch(`/projects/${project.id}/endpoints`);
    const match = (endpoints.endpoints || []).find((endpoint) => {
      const name = String(endpoint.host || "").split(".")[0].replace(/-pooler$/, "");
      return name === previewEndpoint || String(endpoint.host || "").includes(PREVIEW_HOST_MARKER);
    });
    if (match) {
      return {
        projectId: project.id,
        parentBranchId: match.branch_id,
        projectName: project.name,
      };
    }
  }
  throw new Error("Could not resolve Preview Neon project");
}

async function snapshot(sql) {
  const tables = await sql`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename IN (
        'deposito_graneles','deposito_graneles_audit',
        'creamy_user_memories','creamy_operational_memories','creamy_conversations',
        'creamy_messages','creamy_memory_evidence','creamy_memory_audit_events',
        'genus_auth_users','os_notifications','work_items'
      )
    ORDER BY tablename
  `;
  const workItemCols = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name='work_items'
      AND column_name IN ('via_codificado','packaging_lote','bulk_remainder_id','sent_to_codificado_at')
    ORDER BY column_name
  `.catch(() => []);
  const creamyUserId = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name='creamy_user_memories' AND column_name='user_id'
  `.catch(() => []);
  const formulas = await sql`
    SELECT
      (SELECT count(*)::int FROM formula_versions) AS versions,
      (SELECT count(*)::int FROM formula_versions WHERE status = 'VIGENTE') AS vigentes
  `.catch(() => [{ versions: null, vigentes: null }]);
  return {
    tables: tables.map((r) => r.tablename),
    workItemCols0014: workItemCols.map((r) => r.column_name),
    creamyUserIdCol: creamyUserId.length > 0,
    formulas: formulas[0],
  };
}

async function applySqlFile(sql, relativePath) {
  const full = path.join(root, relativePath);
  const statements = fs
    .readFileSync(full, "utf8")
    .split("--> statement-breakpoint")
    .map((s) => s.replace(/^\s*\/\*[\s\S]*?\*\//, "").trim())
    .filter(Boolean);
  for (const statement of statements) {
    await sql.query(statement);
  }
  return statements.length;
}

async function main() {
  const report = {
    ok: false,
    startedAt: new Date().toISOString(),
    migrations: MIGRATIONS,
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
    if (!apiKey) throw new Error("NEON_API_KEY required");

    const previewSql = neon(previewUrl);
    report.beforePreview = await snapshot(previewSql);
    report.steps.push({
      step: "preview_readonly_baseline",
      ok: true,
      note: "0014/0015/0017 should be absent before apply",
      has0014cols: report.beforePreview.workItemCols0014.length,
      hasCreamy: report.beforePreview.tables.includes("creamy_user_memories"),
      hasAuth: report.beforePreview.tables.includes("genus_auth_users"),
    });

    const resolved = await resolvePreviewProject();
    projectId = resolved.projectId;
    report.neonProjectIdAnon = `${projectId.slice(0, 8)}***`;
    report.neonProjectName = resolved.projectName || null;
    const name = `dryrun-0014-15-17-${Date.now()}`;
    const created = await neonFetch(`/projects/${projectId}/branches`, {
      method: "POST",
      body: JSON.stringify({
        endpoints: [{ type: "read_write" }],
        branch: { name, parent_id: resolved.parentBranchId },
      }),
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
    if (!connectionUrl) throw new Error("No connection URI for disposable branch");
    connectionUrl = connectionUrl.replace("-pooler", "");
    if (new URL(connectionUrl).hostname.includes(PREVIEW_HOST_MARKER)) {
      throw new Error("Safety: disposable host resembles Preview");
    }
    report.tempHostAnon = anonHost(connectionUrl);

    const tempSql = neon(connectionUrl);
    report.beforeTemp = await snapshot(tempSql);

    for (const migration of MIGRATIONS) {
      const count = await applySqlFile(tempSql, migration);
      report.steps.push({ step: `apply_${path.basename(migration)}`, ok: true, statements: count });
    }

    report.afterApply = await snapshot(tempSql);
    const afterOk =
      report.afterApply.workItemCols0014.length >= 4 &&
      report.afterApply.tables.includes("deposito_graneles") &&
      report.afterApply.tables.includes("creamy_user_memories") &&
      report.afterApply.creamyUserIdCol === true &&
      report.afterApply.formulas.versions === 842 &&
      report.afterApply.formulas.vigentes === 784;
    report.steps.push({
      step: "verify_schema_and_formulas",
      ok: afterOk,
      after: report.afterApply,
    });

    for (const migration of MIGRATIONS) {
      await applySqlFile(tempSql, migration);
    }
    report.afterIdempotent = await snapshot(tempSql);
    report.steps.push({
      step: "rerun_idempotent",
      ok: JSON.stringify(report.afterApply) === JSON.stringify(report.afterIdempotent),
    });

    report.afterPreview = await snapshot(previewSql);
    report.previewUntouched =
      JSON.stringify(report.beforePreview) === JSON.stringify(report.afterPreview);
    report.steps.push({ step: "preview_unchanged", ok: report.previewUntouched });
    report.ok = report.steps.every((s) => s.ok !== false);
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
        report.steps.push({
          step: "delete_disposable_branch",
          ok: false,
          error: String(error?.message || error),
        });
        report.ok = false;
      }
    }
  }

  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(evidenceDir, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
}

main();
