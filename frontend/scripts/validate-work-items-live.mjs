#!/usr/bin/env node
/**
 * Validación runtime contra Google Sheets vivos.
 * Uso: BASE_URL=https://preview... node frontend/scripts/validate-work-items-live.mjs
 */

const BASE = process.env.BASE_URL?.replace(/\/$/, "") ?? "http://localhost:3000";

const ENDPOINTS = [
  "/api/v1/drive/refresh?scope=all",
  "/api/v1/env-check",
  "/api/v1/work-items?sector=ENVASADO_MASIVO",
  "/api/v1/work-items?sector=ENVASADO_PREMIUM",
  "/api/v1/work-items?sector=ELABORACION&ownerPerson=Cristian",
  "/api/v1/work-items?sector=ELABORACION&ownerPerson=Nicolás",
  "/api/v1/work-items?sector=ELABORACION",
  "/api/v1/work-items?sector=CALIDAD",
  "/api/v1/work-items?sector=PRODUCCION",
  "/api/v1/work-items?sector=DEPOSITO",
  "/api/v1/work-items/debug",
];

function summarizeWorkItems(body) {
  if (!body || typeof body !== "object") return { count: 0, sample: [], warnings: [], error: "invalid json" };
  const items = body.workItems ?? [];
  const sample = items.slice(0, 5).map((i) => ({
    id: i.id,
    client: i.client,
    product: i.product,
    line: i.line,
    ownerPerson: i.ownerPerson,
    sector: i.sector,
    pedidoRef: i.pedidoRef,
    loteRef: i.loteRef,
  }));
  return {
    source: body.source ?? "—",
    count: items.length ?? body.totalCount ?? 0,
    message: body.message ?? body.error ?? null,
    warnings: body.warnings ?? body.mapperWarnings ?? [],
    sample,
    error: body.error ?? null,
  };
}

async function fetchJson(path) {
  const url = `${BASE}${path}`;
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    const text = await res.text();
    const isJson = text.trim().startsWith("{") || text.trim().startsWith("[");
    if (!isJson) {
      return {
        ok: false,
        status: res.status,
        error: `Non-JSON (${res.status}): ${text.slice(0, 120)}`,
        body: null,
      };
    }
    return { ok: res.ok, status: res.status, body: JSON.parse(text), error: null };
  } catch (err) {
    return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err), body: null };
  }
}

console.log(`\nValidación live — BASE_URL=${BASE}\n`);

const rows = [];

for (const path of ENDPOINTS) {
  const result = await fetchJson(path);
  let row;

  if (!result.ok || result.error) {
    row = {
      endpoint: path,
      source: "—",
      count: 0,
      sample: [],
      warnings: [],
      error: result.error ?? `HTTP ${result.status}`,
    };
  } else if (path.includes("work-items")) {
    row = { endpoint: path, ...summarizeWorkItems(result.body) };
  } else if (path.includes("env-check")) {
    row = {
      endpoint: path,
      source: result.body.mode ?? "—",
      count: 0,
      sample: [result.body],
      warnings: [],
      error: result.body.canUseDriveAdapter === false ? "Drive no disponible" : null,
    };
  } else {
    row = {
      endpoint: path,
      source: result.body.source ?? "drive",
      count: result.body.documentsIndexed ?? result.body.rowsMappable ?? 0,
      sample: [result.body.message ?? result.body],
      warnings: result.body.warnings ?? [],
      error: null,
    };
  }

  rows.push(row);
  console.log(JSON.stringify(row, null, 2));
  console.log("---");
}

console.log("\n## Tabla resumen\n");
console.log("| Endpoint | source | count | error |");
console.log("|----------|--------|-------|-------|");
for (const r of rows) {
  console.log(`| \`${r.endpoint}\` | ${r.source} | ${r.count} | ${r.error ?? "—"} |`);
}
