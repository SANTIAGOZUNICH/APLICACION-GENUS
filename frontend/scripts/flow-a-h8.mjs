#!/usr/bin/env node
/**
 * Flujo A manual — SEMANAS 2026 / ELABORACION / celda H8 (95KG ↔ 96KG).
 *
 * Uso:
 *   BASE_URL=https://preview.vercel.app \
 *   VERCEL_AUTOMATION_BYPASS_SECRET=xxx \
 *   node frontend/scripts/flow-a-h8.mjs
 *
 * El script calienta snapshot, abre SSE y espera tu edición.
 * Al estar listo imprime: EDITAR AHORA
 * Al finalizar recordá restaurar 96KG → 95KG en H8.
 */

import { performance } from "node:perf_hooks";

const BASE = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const BYPASS = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim() ?? "";
const POLL_MS = 250;
const TIMEOUT_MS = 120_000;
const GATE_MIN_MS = 2000;
const GATE_MAX_MS = 5000;

const metrics = {
  editDetectedAt: null,
  statusRevisionAt: null,
  sseElaboracionAt: null,
  sseProduccionAt: null,
  cristianAt: null,
  produccionAt: null,
  baselineRevision: 0,
  finalRevision: 0,
};

function headers(extra = {}) {
  const h = { Accept: "application/json", ...extra };
  if (BYPASS) h["x-vercel-protection-bypass"] = BYPASS;
  return h;
}

async function fetchJson(path, options = {}) {
  const t0 = performance.now();
  const res = await fetch(`${BASE}${path}`, {
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
  return { ok: res.ok, status: res.status, body, elapsed };
}

function sseUrl(sector) {
  const params = new URLSearchParams({ sector });
  if (BYPASS) {
    params.set("x-vercel-set-bypass-cookie", "true");
    params.set("x-vercel-protection-bypass", BYPASS);
  }
  return `${BASE}/api/v1/live-sync/stream?${params.toString()}`;
}

function connectSse(sector, onSnapshot) {
  const t0 = performance.now();
  const controller = new AbortController();

  fetch(sseUrl(sector), { headers: headers(), signal: controller.signal })
    .then(async (res) => {
      if (!res.ok) return;
      const reader = res.body?.getReader();
      if (!reader) return;
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        if (chunk.includes("snapshot.updated")) {
          onSnapshot(Math.round(performance.now() - t0));
        }
      }
    })
    .catch(() => {});

  return () => controller.abort();
}

function findH8Item(items) {
  return (
    items.find((item) => {
      const range = `${item.sourceRange ?? ""} ${item.sourceSheet ?? ""}`.toUpperCase();
      return range.includes("ELABORACION") && (range.includes("H8") || range.includes(":8"));
    }) ??
    items.find((item) => String(item.quantity ?? "").includes("95KG")) ??
    items[0] ??
    null
  );
}

function itemReflectsEdit(item, baselineQty) {
  if (!item) return false;
  const qty = String(item.quantity ?? "");
  if (qty.includes("96KG")) return true;
  if (baselineQty && qty !== baselineQty) return true;
  return false;
}

async function warmSnapshot() {
  const sectors = [
    "sector=ELABORACION&ownerPerson=Cristian",
    "sector=PRODUCCION",
    "sector=ENVASADO_MASIVO",
  ];
  for (const q of sectors) {
    await fetchJson(`/api/v1/work-items?${q}`);
  }
  const status = await fetchJson("/api/v1/live-sync/status");
  return status.body;
}

async function main() {
  console.log(`\n=== Flujo A — SEMANAS H8 (95KG → 96KG) ===\nBASE=${BASE}\n`);

  if (!BYPASS && BASE.includes("vercel.app")) {
    console.warn("⚠ VERCEL_AUTOMATION_BYPASS_SECRET no configurado — preview puede fallar.\n");
  }

  const env = await fetchJson("/api/v1/env-check");
  if (!env.ok || !env.body?.canUseDriveAdapter) {
    console.error("FAIL: Drive no disponible", env.status, env.body);
    process.exit(1);
  }

  console.log("Calentando snapshot…");
  const warmStatus = await warmSnapshot();
  metrics.baselineRevision = warmStatus?.revision ?? 0;
  console.log(
    `Snapshot listo — revision=${metrics.baselineRevision} · items=${warmStatus?.workItemCount ?? "?"}`
  );

  const cristianBase = await fetchJson(
    "/api/v1/work-items?sector=ELABORACION&ownerPerson=Cristian"
  );
  const prodBase = await fetchJson("/api/v1/work-items?sector=PRODUCCION");
  const h8Item = findH8Item(cristianBase.body?.workItems ?? []);
  const baselineQty = h8Item?.quantity ?? null;

  console.log("\n--- Instrucción manual ---");
  console.log("Archivo: SEMANAS 2026");
  console.log("Pestaña: ELABORACION");
  console.log("Celda: H8");
  console.log("Cambio: 95KG → 96KG");
  if (h8Item) {
    console.log(`Ítem API vinculado: ${h8Item.product ?? h8Item.id} · cantidad actual=${baselineQty ?? "?"}`);
  }
  console.log("Al finalizar: restaurar 96KG → 95KG\n");

  const perf0 = performance.now();
  let editPerf0 = null;
  let waitingForEdit = true;

  const stopElab = connectSse("ELABORACION", (ms) => {
    if (!metrics.sseElaboracionAt) metrics.sseElaboracionAt = ms;
  });
  const stopProd = connectSse("PRODUCCION", (ms) => {
    if (!metrics.sseProduccionAt) metrics.sseProduccionAt = ms;
  });

  console.log("Monitoreo activo (SSE + API cada 250ms).");
  console.log("\n══════════════════════════════════════");
  console.log("              EDITAR AHORA");
  console.log("══════════════════════════════════════\n");

  const deadline = Date.now() + TIMEOUT_MS;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_MS));

    const status = await fetchJson("/api/v1/live-sync/status");
    const revision = status.body?.revision ?? 0;

    const cristian = await fetchJson(
      "/api/v1/work-items?sector=ELABORACION&ownerPerson=Cristian"
    );
    const produccion = await fetchJson("/api/v1/work-items?sector=PRODUCCION");

    const editedItem = findH8Item(cristian.body?.workItems ?? []);
    const editSeen = itemReflectsEdit(editedItem, baselineQty);

    if (editSeen && waitingForEdit) {
      waitingForEdit = false;
      editPerf0 = performance.now();
      metrics.editDetectedAt = Math.round(editPerf0 - perf0);
    }

    if (!waitingForEdit && revision > metrics.baselineRevision && !metrics.statusRevisionAt) {
      metrics.statusRevisionAt = Math.round(performance.now() - editPerf0);
      metrics.finalRevision = revision;
    }

    const cristianOk = itemReflectsEdit(
      findH8Item(cristian.body?.workItems ?? []),
      baselineQty
    );
    if (!waitingForEdit && cristianOk && !metrics.cristianAt) {
      metrics.cristianAt = Math.round(performance.now() - editPerf0);
    }

    const prodItem =
      (produccion.body?.workItems ?? []).find((i) => i.id === editedItem?.id) ??
      findH8Item(produccion.body?.workItems ?? []);
    if (!waitingForEdit && itemReflectsEdit(prodItem, baselineQty) && !metrics.produccionAt) {
      metrics.produccionAt = Math.round(performance.now() - editPerf0);
    }

    if (
      metrics.cristianAt &&
      metrics.produccionAt &&
      (metrics.sseElaboracionAt || metrics.statusRevisionAt)
    ) {
      break;
    }
  }

  stopElab();
  stopProd();

  const totalLatency = metrics.produccionAt ?? metrics.cristianAt ?? metrics.editDetectedAt;
  const gatePass =
    totalLatency !== null && totalLatency >= GATE_MIN_MS && totalLatency <= GATE_MAX_MS;

  console.log("\n## Métricas Flujo A\n");
  console.log("| Etapa | Latencia (ms desde edición) |");
  console.log("|-------|----------------------------|");
  console.log(`| Detección cambio API | ${metrics.editDetectedAt ?? "—"} |`);
  console.log(`| Revisión snapshot (status) | ${metrics.statusRevisionAt ?? "—"} |`);
  console.log(`| SSE Elaboración | ${metrics.sseElaboracionAt ?? "—"} |`);
  console.log(`| SSE Producción | ${metrics.sseProduccionAt ?? "—"} |`);
  console.log(`| Aparición Cristian | ${metrics.cristianAt ?? "—"} |`);
  console.log(`| Aparición Producción | ${metrics.produccionAt ?? "—"} |`);
  console.log(`| **Total gate** | **${totalLatency ?? "TIMEOUT"}** |`);

  const pass =
    metrics.cristianAt &&
    metrics.produccionAt &&
    totalLatency !== null &&
    totalLatency <= GATE_MAX_MS;

  console.log(`\nGate 2–5s sin F5: ${gatePass ? "PASS (rango)" : totalLatency && totalLatency <= GATE_MAX_MS ? "PASS (≤5s)" : "FAIL"}`);
  console.log(`Resultado global: ${pass ? "PASS" : "FAIL"}`);

  if (!pass) {
    console.log("\nRecordatorio: restaurar H8 a 95KG si aún está en 96KG.");
    process.exit(1);
  }

  console.log("\n✓ Restaurar H8: 96KG → 95KG cuando termines de revisar.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
