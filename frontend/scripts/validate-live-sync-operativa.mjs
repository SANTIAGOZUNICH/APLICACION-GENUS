#!/usr/bin/env node
/**
 * Validación operativa Live Sync — Preview con datos reales.
 *
 * Uso:
 *   BASE_URL=https://preview.vercel.app \
 *   VERCEL_AUTOMATION_BYPASS_SECRET=xxx \
 *   node frontend/scripts/validate-live-sync-operativa.mjs
 *
 * Flujo A (Sheets): requiere edición manual en SEMANAS mientras corre --flow-a
 *   node ... --flow-a --marker "VALIDACION-XYZ-123"
 */

import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";

const BASE = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const BYPASS = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim() ?? "";
const FLOW_A = process.argv.includes("--flow-a");
const MARKER = process.env.VALIDATION_MARKER ?? "GENUS-VALIDACION-MARKER";

const USERS = [
  { persona: "Francisco", sector: "ENVASADO_MASIVO", query: "sector=ENVASADO_MASIVO" },
  { persona: "Agustina", sector: "PRODUCCION", query: "sector=PRODUCCION" },
  { persona: "Santiago", sector: "CALIDAD", query: "sector=CALIDAD" },
  { persona: "Dirección", sector: "DIRECCION", query: "sector=PRODUCCION" },
];

const results = [];

function isoNow() {
  return new Date().toISOString();
}

function msSince(t0) {
  return Math.round(performance.now() - t0);
}

function headers(extra = {}) {
  const h = { Accept: "application/json", ...extra };
  if (BYPASS) {
    h["x-vercel-protection-bypass"] = BYPASS;
  }
  return h;
}

async function fetchJson(path, options = {}) {
  const t0 = performance.now();
  const url = `${BASE}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: headers(options.headers),
  });
  const elapsed = Math.round(performance.now() - t0);
  const text = await res.text();
  let body = null;
  try {
    body = text.trim() ? JSON.parse(text) : null;
  } catch {
    body = { _raw: text.slice(0, 200) };
  }
  return { ok: res.ok, status: res.status, body, elapsed, url };
}

function record(row) {
  results.push(row);
}

function printTable() {
  console.log("\n## Tabla final de validación\n");
  console.log(
    "| Flujo | Usuario | Dato modificado | Origen | Destino | Hora inicio | Hora aparición | Latencia | PASS/FAIL | Observaciones |"
  );
  console.log(
    "|-------|---------|-----------------|--------|---------|-------------|----------------|----------|-----------|---------------|"
  );
  for (const r of results) {
    console.log(
      `| ${r.flujo} | ${r.usuario} | ${r.dato} | ${r.origen} | ${r.destino} | ${r.inicio} | ${r.aparicion} | ${r.latencia} | ${r.pass} | ${r.obs} |`
    );
  }
}

async function checkAccess() {
  const t0 = isoNow();
  const env = await fetchJson("/api/v1/env-check");
  if (env.status === 302 || env.body?._raw?.includes("sso-api") || env.body?._raw?.includes("Redirecting")) {
    record({
      flujo: "ACCESO",
      usuario: "—",
      dato: "env-check",
      origen: BASE,
      destino: "API",
      inicio: t0,
      aparicion: "—",
      latencia: `${env.elapsed}ms HTTP ${env.status}`,
      pass: "FAIL",
      obs: "Preview bloqueado por Vercel SSO — configurar VERCEL_AUTOMATION_BYPASS_SECRET",
    });
    return false;
  }
  if (!env.ok) {
    const errMsg =
      typeof env.body?.error === "string"
        ? env.body.error
        : env.body?._raw?.slice(0, 80) ?? `HTTP ${env.status}`;
    record({
      flujo: "ACCESO",
      usuario: "—",
      dato: "env-check",
      origen: BASE,
      destino: "API",
      inicio: t0,
      aparicion: isoNow(),
      latencia: `${env.elapsed}ms`,
      pass: "FAIL",
      obs: errMsg,
    });
    return false;
  }
  record({
    flujo: "ACCESO",
    usuario: "—",
    dato: `mode=${env.body?.mode}`,
    origen: BASE,
    destino: "API",
    inicio: t0,
    aparicion: isoNow(),
    latencia: `${env.elapsed}ms`,
    pass: env.body?.canUseDriveAdapter ? "PASS" : "FAIL",
    obs: env.body?.canUseDriveAdapter ? "Drive OK" : "Drive no disponible",
  });
  return env.body?.canUseDriveAdapter === true;
}

async function measureLoad(sector, label) {
  const cold = await fetchJson(`/api/v1/work-items?sector=${sector}`);
  const warm = await fetchJson(`/api/v1/work-items?sector=${sector}`);
  const revision = warm.body?.operationalOverlay?.revision ?? cold.body?.headers ?? "—";
  record({
    flujo: "CARGA",
    usuario: label,
    dato: `${cold.body?.workItems?.length ?? 0} WorkItems`,
    origen: "/mi-trabajo API",
    destino: sector,
    inicio: isoNow(),
    aparicion: isoNow(),
    latencia: `cold ${cold.elapsed}ms · warm ${warm.elapsed}ms`,
    pass: warm.elapsed < 500 ? "PASS" : warm.elapsed < 2000 ? "WARN" : "FAIL",
    obs: `source=${cold.body?.source ?? "?"} · objetivo warm <500ms`,
  });
  return warm;
}

async function testSse(sector) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const started = isoNow();
    let connected = false;
    let error = null;
    const url = `${BASE}/api/v1/live-sync/stream?sector=${sector}${BYPASS ? `&x-vercel-set-bypass-cookie=true&x-vercel-protection-bypass=${BYPASS}` : ""}`;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
      resolve({ connected, error: error ?? "timeout 8s", ms: msSince(t0), started });
    }, 8000);

    fetch(url, { headers: headers(), signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) {
          error = `HTTP ${res.status}`;
          clearTimeout(timer);
          resolve({ connected: false, error, ms: msSince(t0), started });
          return;
        }
        const reader = res.body?.getReader();
        if (!reader) {
          error = "no body";
          clearTimeout(timer);
          resolve({ connected: false, error, ms: msSince(t0), started });
          return;
        }
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value);
          if (chunk.includes('"type"')) {
            connected = true;
            clearTimeout(timer);
            controller.abort();
            resolve({ connected: true, error: null, ms: msSince(t0), started });
            break;
          }
        }
      })
      .catch((err) => {
        error = err instanceof Error ? err.message : String(err);
        clearTimeout(timer);
        resolve({ connected: false, error, ms: msSince(t0), started });
      });
  });
}

function findItem(items, predicate) {
  return items?.find(predicate) ?? null;
}

function progressOf(body, itemId) {
  return body?.operationalOverlay?.progress?.[itemId]?.finishedQty ?? null;
}

async function flowB() {
  const masivo = await fetchJson("/api/v1/work-items?sector=ENVASADO_MASIVO");
  const items = masivo.body?.workItems ?? [];
  if (items.length === 0) {
    record({
      flujo: "B",
      usuario: "Francisco",
      dato: "—",
      origen: "Genus OS",
      destino: "—",
      inicio: isoNow(),
      aparicion: "—",
      latencia: "—",
      pass: "FAIL",
      obs: "Sin WorkItems reales en Envasado Masivo",
    });
    return;
  }

  const target = items[0];
  const terminadas = "300";
  const t0 = isoNow();
  const perf0 = performance.now();

  await fetchJson("/api/v1/live-sync/operations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "save_progress",
      itemId: target.id,
      sector: "ENVASADO_MASIVO",
      finishedQty: terminadas,
      observation: `Validación Live Sync ${MARKER}`,
      updatedBy: "Francisco Zapata",
    }),
  });

  const observers = [
    { persona: "Francisco", query: "sector=ENVASADO_MASIVO" },
    { persona: "Agustina", query: "sector=PRODUCCION" },
    { persona: "Dirección", query: "sector=PRODUCCION" },
  ];

  for (const obs of observers) {
    const tObs = performance.now();
    const res = await fetchJson(`/api/v1/work-items?${obs.query}`);
    const qty = progressOf(res.body, target.id) ?? findItem(res.body?.workItems, (i) => i.id === target.id)?.finishedQty;
    const lat = Math.round(performance.now() - perf0);
    record({
      flujo: "B1",
      usuario: obs.persona,
      dato: `Terminadas=${terminadas}`,
      origen: "Genus OS / Francisco",
      destino: obs.persona,
      inicio: t0,
      aparicion: isoNow(),
      latencia: `${lat}ms (fetch ${res.elapsed}ms)`,
      pass: qty === terminadas ? "PASS" : "FAIL",
      obs: qty === terminadas ? `item ${target.product ?? target.id}` : `visto=${qty ?? "null"}`,
    });
  }

  const tComplete = isoNow();
  const perfC = performance.now();
  await fetchJson("/api/v1/live-sync/operations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "complete_work",
      item: target,
      finishedQty: terminadas,
      observation: `Entrega validación ${MARKER}`,
      completedBy: "Francisco Zapata",
    }),
  });

  const calidad = await fetchJson("/api/v1/work-items?sector=CALIDAD");
  const latC = Math.round(performance.now() - perfC);
  const qItems = calidad.body?.qualityItems ?? [];
  const received = qItems.some(
    (q) => q.relatedWorkItemId === target.id || q.observation?.includes(MARKER)
  );

  for (const obs of [
    { persona: "Francisco", query: "sector=ENVASADO_MASIVO", check: (b) => findItem(b.workItems, (i) => i.id === target.id)?.status === "revision" },
    { persona: "Santiago", query: "sector=CALIDAD", check: () => received },
    { persona: "Agustina", query: "sector=PRODUCCION", check: (b) => findItem(b.workItems, (i) => i.id === target.id)?.status === "revision" },
    { persona: "Dirección", query: "sector=PRODUCCION", check: (b) => findItem(b.workItems, (i) => i.id === target.id)?.status === "revision" },
  ]) {
    const res = await fetchJson(`/api/v1/work-items?${obs.query}`);
    const ok = obs.check(res.body);
    record({
      flujo: "B2",
      usuario: obs.persona,
      dato: "Entregar a Calidad",
      origen: "Francisco",
      destino: obs.persona,
      inicio: tComplete,
      aparicion: isoNow(),
      latencia: `${latC}ms`,
      pass: ok ? "PASS" : "FAIL",
      obs: ok ? "transferencia OK" : "no detectado",
    });
  }

  const qualityId = qItems.find((q) => q.relatedWorkItemId === target.id)?.id ?? `quality:${target.id}`;
  const tDecide = isoNow();
  const perfD = performance.now();
  await fetchJson("/api/v1/live-sync/operations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "quality_decision",
      itemId: qualityId,
      status: "aprobado",
      decidedBy: "Santiago Zunich",
      observation: `Aprobado validación ${MARKER}`,
    }),
  });

  for (const obs of [
    { persona: "Agustina", query: "sector=PRODUCCION" },
    { persona: "Dirección", query: "sector=PRODUCCION" },
  ]) {
    const res = await fetchJson(`/api/v1/work-items?${obs.query}`);
    const lat = Math.round(performance.now() - perfD);
    const approved = (res.body?.operationalOverlay?.decisions?.[qualityId]?.status ?? null) === "aprobado";
    record({
      flujo: "B3",
      usuario: obs.persona,
      dato: "Aprobación Santiago",
      origen: "Calidad",
      destino: obs.persona,
      inicio: tDecide,
      aparicion: isoNow(),
      latencia: `${lat}ms`,
      pass: approved ? "PASS" : "FAIL",
      obs: approved ? "decisión propagada" : "decisión no visible",
    });
  }
}

async function flowA() {
  console.log(`\n[Flow A] Editar SEMANAS 2026 ahora con marker único: ${MARKER}`);
  console.log("Polling cada 500ms hasta 30s por sector...\n");

  const sectors = [
    { usuario: "Francisco", query: "sector=ENVASADO_MASIVO", field: "product" },
    { usuario: "Francisco Premium", query: "sector=ENVASADO_PREMIUM", field: "product" },
    { usuario: "Cristian", query: "sector=ELABORACION&ownerPerson=Cristian", field: "product" },
  ];

  const baselines = {};
  for (const s of sectors) {
    const res = await fetchJson(`/api/v1/work-items?${s.query}`);
    baselines[s.query] = JSON.stringify(res.body?.workItems?.slice(0, 5) ?? []);
  }

  const t0 = isoNow();
  const perf0 = performance.now();
  let detected = false;

  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    for (const s of sectors) {
      const res = await fetchJson(`/api/v1/work-items?${s.query}`);
      const snap = JSON.stringify(res.body?.workItems?.slice(0, 5) ?? []);
      if (snap !== baselines[s.query]) {
        const lat = Math.round(performance.now() - perf0);
        record({
          flujo: "A",
          usuario: s.usuario,
          dato: MARKER,
          origen: "Google Sheets SEMANAS",
          destino: "Genus OS API",
          inicio: t0,
          aparicion: isoNow(),
          latencia: `${lat}ms`,
          pass: lat <= 5000 ? "PASS" : "FAIL",
          obs: lat <= 5000 ? "dentro objetivo 2-5s" : "supera 5s — revisar poll/SSE",
        });
        detected = true;
      }
    }
    if (detected) break;
  }

  if (!detected) {
    record({
      flujo: "A",
      usuario: "todos",
      dato: MARKER,
      origen: "Google Sheets",
      destino: "Genus OS",
      inicio: t0,
      aparicion: "—",
      latencia: ">30s",
      pass: "FAIL",
      obs: "No se detectó cambio — editar SEMANAS durante --flow-a o revisar sync",
    });
  }
}

async function main() {
  console.log(`\n=== Validación Live Sync Operativa ===`);
  console.log(`BASE_URL=${BASE}`);
  console.log(`BYPASS=${BYPASS ? "configurado" : "NO"}`);
  console.log(`Commit objetivo: PR #53 · ${isoNow()}\n`);

  const ok = await checkAccess();
  if (!ok) {
    printTable();
    process.exit(1);
  }

  await fetchJson("/api/v1/drive/refresh?scope=critical_sheets");

  for (const u of USERS) {
    await measureLoad(u.sector, u.persona);
  }

  for (const u of USERS) {
    const sse = await testSse(u.sector === "DIRECCION" ? "PRODUCCION" : u.sector);
    record({
      flujo: "SSE",
      usuario: u.persona,
      dato: "EventSource",
      origen: "live-sync/stream",
      destino: u.persona,
      inicio: sse.started,
      aparicion: sse.connected ? isoNow() : "—",
      latencia: `${sse.ms}ms`,
      pass: sse.connected ? "PASS" : "FAIL",
      obs: sse.error ?? "conectado",
    });
  }

  await flowB();

  if (FLOW_A) {
    await flowA();
  } else {
    record({
      flujo: "A",
      usuario: "—",
      dato: "—",
      origen: "Sheets",
      destino: "Genus OS",
      inicio: "—",
      aparicion: "—",
      latencia: "—",
      pass: "SKIP",
      obs: "Ejecutar con --flow-a mientras se edita SEMANAS en vivo",
    });
  }

  printTable();

  const fails = results.filter((r) => r.pass === "FAIL").length;
  console.log(`\nGate: ${fails === 0 ? "PASS" : "FAIL"} (${fails} fallos)\n`);
  process.exit(fails > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
