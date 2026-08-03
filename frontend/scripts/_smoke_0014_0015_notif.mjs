/**
 * Smoke Preview: schema 0014/0015/0017 + notificaciones aprobación→Envasado + Creamy user_id.
 * Prefijo TEST_ — limpia al final. Usa @neondatabase/serverless (sin package postgres).
 *
 * Uso: node scripts/_smoke_0014_0015_notif.mjs
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";
import fs from "node:fs";

const root = resolve(fileURLToPath(import.meta.url), "..", "..");
const OUT = resolve(root, "tmp-smoke-0014-15-notif");
mkdirSync(OUT, { recursive: true });
const PREVIEW_HOST_MARKER = "polished-recipe";

function loadEnv(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    if (!line || line.trimStart().startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    let value = line.slice(i + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (value && value !== "[SENSITIVE]") out[line.slice(0, i).trim()] = value;
  }
  return out;
}

function normalizeSearchKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[.:;/_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function weekStartMonday(isoDate) {
  const d = new Date(`${isoDate}T12:00:00.000Z`);
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

function addDaysIso(iso, days) {
  const d = new Date(`${iso}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function overlapsWeek(row, weekStart) {
  const start = row.plannedDate;
  const end = row.plannedDateTo || row.plannedDate;
  const weekEnd = addDaysIso(weekStart, 4);
  return start <= weekEnd && end >= weekStart;
}

function deterministicId(key) {
  const hex = createHash("sha256").update(key).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${(Number.parseInt(hex[16], 16) & 0x3 | 0x8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function matchSectors(snapshot, rows) {
  const week = weekStartMonday(snapshot.plannedDate);
  const client = normalizeSearchKey(snapshot.client);
  const product = normalizeSearchKey(snapshot.product);
  const matched = rows.filter(
    (row) =>
      normalizeSearchKey(row.client) === client &&
      normalizeSearchKey(row.product) === product &&
      row.status.toUpperCase() !== "CANCELADO" &&
      overlapsWeek(row, week)
  );
  return [...new Set(matched.map((r) => r.sector))];
}

async function insertNotif(sql, { approvalItemId, stage, sector, workItemId, product, client }) {
  const id = deterministicId(`approval:${approvalItemId}:${sector}:${stage}`);
  const message = `${product} de ${client} fue aprobado por ${stage === "CALIDAD" ? "Calidad" : "Producción"} y está listo para continuar.`;
  const result = await sql`
    INSERT INTO os_notifications (id, kind, title, message, sectors, href, read_by, dismissed_by, deleted_by)
    VALUES (
      ${id}::uuid,
      'produccion_aprobada_envasado',
      'Producción aprobada',
      ${message},
      ${JSON.stringify([sector])}::jsonb,
      ${`/mi-trabajo?workItemId=${encodeURIComponent(workItemId)}`},
      '[]'::jsonb,
      '[]'::jsonb,
      '[]'::jsonb
    )
    ON CONFLICT (id) DO NOTHING
    RETURNING id
  `;
  return { id, created: result.length > 0 };
}

const env = { ...process.env, ...loadEnv(resolve(root, ".env.preview.db.local")) };
const url = (env.DATABASE_URL_UNPOOLED || env.DATABASE_URL || "").trim();
if (!url) throw new Error("DATABASE_URL required");
const host = new URL(url).hostname;
if (!host.includes(PREVIEW_HOST_MARKER)) throw new Error(`Refuse non-Preview host: ${host}`);

const sql = neon(url);
const TAG = `TEST_SMOKE_M141517_${Date.now()}`;
const results = [];

function record(name, ok, detail = {}) {
  results.push({ name, ok, ...detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`, detail.message || JSON.stringify(detail));
}

try {
  const schema = await sql`
    SELECT
      to_regclass('public.deposito_graneles') IS NOT NULL AS deposito,
      to_regclass('public.creamy_user_memories') IS NOT NULL AS creamy,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='creamy_user_memories' AND column_name='user_id'
      ) AS creamy_uid,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='work_items' AND column_name='via_codificado'
      ) AS via_cod
  `;
  record("schema_0014_0015_0017", Boolean(schema[0].deposito && schema[0].creamy && schema[0].creamy_uid && schema[0].via_cod), schema[0]);

  const formulas = await sql`
    SELECT
      (SELECT count(*)::int FROM formula_versions) AS versions,
      (SELECT count(*)::int FROM formula_versions WHERE status='VIGENTE') AS vigentes
  `;
  record("formulas_842_784", formulas[0].versions === 842 && formulas[0].vigentes === 784, formulas[0]);

  const weekStart = weekStartMonday(new Date().toISOString().slice(0, 10));
  const planned = weekStart;
  const rangeStart = addDaysIso(weekStart, 1); // martes
  const rangeEnd = addDaysIso(weekStart, 4); // viernes

  const rows = [
    { id: "wm", sector: "ENVASADO_MASIVO", client: `${TAG}_CLI_A`, product: `${TAG}_PROD_A`, plannedDate: planned, plannedDateTo: null, status: "pendiente" },
    { id: "wp", sector: "ENVASADO_PREMIUM", client: `${TAG}_CLI_B`, product: `${TAG}_PROD_B`, plannedDate: planned, plannedDateTo: null, status: "pendiente" },
    { id: "bm", sector: "ENVASADO_MASIVO", client: `${TAG}_CLI_BOTH`, product: `${TAG}_PROD_BOTH`, plannedDate: planned, plannedDateTo: null, status: "pendiente" },
    { id: "bp", sector: "ENVASADO_PREMIUM", client: `${TAG}_CLI_BOTH`, product: `${TAG}_PROD_BOTH`, plannedDate: planned, plannedDateTo: null, status: "pendiente" },
    { id: "wc", sector: "ENVASADO_MASIVO", client: `${TAG}_CLI_OTHER`, product: `${TAG}_PROD_A`, plannedDate: planned, plannedDateTo: null, status: "pendiente" },
    { id: "wpr", sector: "ENVASADO_PREMIUM", client: `${TAG}_CLI_A`, product: `${TAG}_PROD_OTHER`, plannedDate: planned, plannedDateTo: null, status: "pendiente" },
    { id: "wr", sector: "ENVASADO_MASIVO", client: `${TAG}_CLI_RANGE`, product: `${TAG}_PROD_RANGE`, plannedDate: rangeStart, plannedDateTo: rangeEnd, status: "pendiente" },
  ];

  // 1 Masivo only
  const s1 = matchSectors({ client: `${TAG}_CLI_A`, product: `${TAG}_PROD_A`, plannedDate: planned }, rows);
  record("match_masivo_only", s1.length === 1 && s1[0] === "ENVASADO_MASIVO", { s1 });
  const n1 = await insertNotif(sql, {
    approvalItemId: `${TAG}_apr_masivo`,
    stage: "CALIDAD",
    sector: "ENVASADO_MASIVO",
    workItemId: "wm",
    product: `${TAG}_PROD_A`,
    client: `${TAG}_CLI_A`,
  });
  const premiumLeak1 = await sql`
    SELECT count(*)::int AS c FROM os_notifications
    WHERE message LIKE ${`%${TAG}_PROD_A%`} AND sectors @> ${JSON.stringify(["ENVASADO_PREMIUM"])}::jsonb
  `;
  record("notif_masivo_persisted", n1.created && premiumLeak1[0].c === 0, { created: n1.created, premiumLeak: premiumLeak1[0].c });

  // 2 Premium only (Producción)
  const s2 = matchSectors({ client: `${TAG}_CLI_B`, product: `${TAG}_PROD_B`, plannedDate: planned }, rows);
  record("match_premium_only", s2.length === 1 && s2[0] === "ENVASADO_PREMIUM", { s2 });
  await insertNotif(sql, {
    approvalItemId: `${TAG}_apr_premium`,
    stage: "PRODUCCION",
    sector: "ENVASADO_PREMIUM",
    workItemId: "wp",
    product: `${TAG}_PROD_B`,
    client: `${TAG}_CLI_B`,
  });

  // 3 both
  const s3 = matchSectors({ client: `${TAG}_CLI_BOTH`, product: `${TAG}_PROD_BOTH`, plannedDate: planned }, rows);
  record("match_both", s3.length === 2, { s3 });
  await insertNotif(sql, { approvalItemId: `${TAG}_apr_both`, stage: "CALIDAD", sector: "ENVASADO_MASIVO", workItemId: "bm", product: `${TAG}_PROD_BOTH`, client: `${TAG}_CLI_BOTH` });
  await insertNotif(sql, { approvalItemId: `${TAG}_apr_both`, stage: "CALIDAD", sector: "ENVASADO_PREMIUM", workItemId: "bp", product: `${TAG}_PROD_BOTH`, client: `${TAG}_CLI_BOTH` });

  // 4/5 wrong client/product
  record(
    "no_wrong_client",
    matchSectors({ client: `${TAG}_CLI_NOMATCH`, product: `${TAG}_PROD_A`, plannedDate: planned }, rows).length === 0
  );
  record(
    "no_wrong_product",
    matchSectors({ client: `${TAG}_CLI_A`, product: `${TAG}_PROD_NOMATCH`, plannedDate: planned }, rows).length === 0
  );

  // 6 no weekly work
  record(
    "no_match_empty",
    matchSectors({ client: `${TAG}_CLI_NONE`, product: `${TAG}_PROD_NONE`, plannedDate: planned }, rows).length === 0
  );

  // 7 range tue-fri overlaps week
  const s7 = matchSectors({ client: `${TAG}_CLI_RANGE`, product: `${TAG}_PROD_RANGE`, plannedDate: addDaysIso(weekStart, 2) }, rows);
  record("range_tue_fri_overlap", s7.length === 1 && s7[0] === "ENVASADO_MASIVO", { s7 });

  // 8 idempotent retry
  const first = await insertNotif(sql, {
    approvalItemId: `${TAG}_apr_idem`,
    stage: "CALIDAD",
    sector: "ENVASADO_MASIVO",
    workItemId: "wm",
    product: `${TAG}_PROD_A`,
    client: `${TAG}_CLI_A`,
  });
  const second = await insertNotif(sql, {
    approvalItemId: `${TAG}_apr_idem`,
    stage: "CALIDAD",
    sector: "ENVASADO_MASIVO",
    workItemId: "wm",
    product: `${TAG}_PROD_A`,
    client: `${TAG}_CLI_A`,
  });
  record("idempotent_retry", first.created && !second.created, { first: first.created, second: second.created });

  // Creamy user_id durable
  const memId = randomUUID();
  const userId = randomUUID();
  await sql`
    INSERT INTO creamy_user_memories (
      id, user_id, user_email, sector, memory_type, content, normalized_key, created_at, updated_at, status
    ) VALUES (
      ${memId}::uuid, ${userId}, ${`${TAG}@genus.test`}, 'PRODUCCION', 'preferencia',
      ${`${TAG} memoria personal`}, ${`pref:${TAG}`}, now(), now(), 'active'
    )
  `;
  const mem = await sql`SELECT user_id AS uid, content FROM creamy_user_memories WHERE id=${memId}::uuid`;
  record("creamy_userid_persisted", mem[0]?.uid === userId && String(mem[0].content).includes(TAG), { uid: mem[0]?.uid });

  // Cleanup TEST_*
  await sql`DELETE FROM os_notifications WHERE message LIKE ${`%${TAG}%`}`;
  await sql`DELETE FROM creamy_user_memories WHERE content LIKE ${`%${TAG}%`}`;

  const leftover = await sql`
    SELECT
      (SELECT count(*)::int FROM os_notifications WHERE message LIKE ${`%${TAG}%`}) AS notifs,
      (SELECT count(*)::int FROM creamy_user_memories WHERE content LIKE ${`%${TAG}%`}) AS mems
  `;
  record("cleanup_TEST_zero", leftover[0].notifs === 0 && leftover[0].mems === 0, leftover[0]);

  const pass = results.every((r) => r.ok);
  writeFileSync(
    resolve(OUT, "results.json"),
    JSON.stringify(
      {
        pass,
        hostAnon: `${host.split(".")[0].replace(/-pooler$/, "").split("-").slice(0, 3).join("-")}-***`,
        tag: TAG,
        results,
      },
      null,
      2
    )
  );
  console.log(JSON.stringify({ pass, count: results.length }, null, 2));
  process.exit(pass ? 0 : 1);
} catch (e) {
  console.error(e);
  process.exit(1);
}
