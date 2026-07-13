#!/usr/bin/env node
/**
 * Flujo A — celda viva desde WorkItem API + verificación Google Sheet.
 *
 * Uso:
 *   # Paso 1: descubrir celda (esperar confirmación humana)
 *   node frontend/scripts/flow-a-live-cell.mjs --discover
 *
 *   # Paso 2: ejecutar prueba tras confirmación
 *   node frontend/scripts/flow-a-live-cell.mjs --run --item-id <id>
 */

import { performance } from "node:perf_hooks";

const BASE = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const BYPASS = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim() ?? "";
const DISCOVER = process.argv.includes("--discover");
const RUN = process.argv.includes("--run");
const ITEM_ID_ARG = process.argv.find((a) => a.startsWith("--item-id="))?.split("=")[1] ?? null;

const OWNERS = ["Cristian", "Nicolás"];
const MIN_ROW = 500;
const POLL_MS = 250;
const TIMEOUT_MS = 120_000;
const GATE_MAX_MS = 5000;

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
    body = { _raw: text.slice(0, 300) };
  }
  return { ok: res.ok, status: res.status, body, elapsed };
}

function colLetter(col1Based) {
  let s = "";
  let n = col1Based;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function parseSourceRange(range) {
  if (!range) return null;
  const m = range.match(/^([^!]+)!(\d+):(\d+)$/);
  if (!m) return { raw: range, ambiguous: true };
  const row = Number(m[2]);
  const col = Number(m[3]);
  return {
    sheet: m[1],
    row,
    col,
    cell: `${colLetter(col)}${row}`,
    ambiguous: false,
  };
}

function normalizeQty(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

function isQuantityLike(text) {
  const t = String(text ?? "").trim();
  if (!t) return false;
  if (/^\d+([.,]\d+)?$/.test(t)) return true;
  if (/\d+\s*(kg|g|ml|u\b|unidades?)/i.test(t)) return true;
  return false;
}

function suggestTestValue(current) {
  const t = String(current ?? "").trim();
  const kg = t.match(/^(\d+)\s*KG$/i);
  if (kg) return `${Number(kg[1]) + 1}KG`;
  const num = t.match(/^(\d+)$/);
  if (num) return String(Number(num[1]) + 1);
  return `${t}-TEST`;
}

async function readLiveCell(sheet, cell) {
  const a1 = `${sheet}!${cell}`;
  return fetchJson(`/api/v1/sheets/cell?key=semanas_2026&a1=${encodeURIComponent(a1)}`);
}

async function fetchElaboracionItems() {
  const all = [];
  for (const owner of OWNERS) {
    const res = await fetchJson(
      `/api/v1/work-items?sector=ELABORACION&ownerPerson=${encodeURIComponent(owner)}`
    );
    for (const item of res.body?.workItems ?? []) {
      all.push(item);
    }
  }
  return all;
}

function rankCandidate(item) {
  const loc = parseSourceRange(item.sourceRange);
  const row = loc?.row ?? 0;
  let score = 0;
  if (row >= MIN_ROW) score += 1000 + row;
  if (item.product && item.quantity) score += 500;
  if (OWNERS.includes(item.ownerPerson ?? "")) score += 100;
  if (loc?.ambiguous) score -= 10000;
  return score;
}

async function resolveCells(item) {
  const loc = parseSourceRange(item.sourceRange);
  if (!loc || loc.ambiguous) {
    return {
      ok: false,
      reason: `sourceRange no parseable: ${item.sourceRange ?? "null"}`,
    };
  }

  const tabRes = await readLiveCell(loc.sheet, "A1");
  if (tabRes.status === 404 && tabRes.body?.code === "TAB_NOT_FOUND") {
    return { ok: false, reason: `pestaña "${loc.sheet}" no existe en Sheet vivo`, tabs: tabRes.body?.tabs };
  }

  const anchorRes = await readLiveCell(loc.sheet, loc.cell);
  if (!anchorRes.ok) {
    return { ok: false, reason: `no se pudo leer ${loc.sheet}!${loc.cell}`, detail: anchorRes.body };
  }

  const anchorValue = anchorRes.body?.value ?? "";
  const qtyNorm = normalizeQty(item.quantity);
  const anchorNorm = normalizeQty(anchorValue);

  let quantityCell = loc.cell;
  let quantityValue = anchorValue;
  let productCell = null;
  let productValue = null;

  if (anchorNorm === qtyNorm || isQuantityLike(anchorValue)) {
    quantityCell = loc.cell;
    quantityValue = anchorValue;
  } else {
    let found = null;
    for (let r = loc.row; r >= Math.max(1, loc.row - 8); r--) {
      const cell = `${colLetter(loc.col)}${r}`;
      const res = await readLiveCell(loc.sheet, cell);
      const val = res.body?.value ?? "";
      if (normalizeQty(val) === qtyNorm || (isQuantityLike(val) && qtyNorm.includes(normalizeQty(val)))) {
        found = { cell, value: val };
        break;
      }
    }
    if (!found) {
      return {
        ok: false,
        reason: `cantidad "${item.quantity}" no encontrada en columna ${colLetter(loc.col)} cerca de fila ${loc.row}`,
        anchor: { cell: loc.cell, value: anchorValue },
      };
    }
    quantityCell = found.cell;
    quantityValue = found.value;
  }

  if (item.product) {
    const prodNorm = normalizeQty(item.product);
    for (let r = loc.row; r >= Math.max(1, loc.row - 8); r--) {
      const cell = `${colLetter(loc.col)}${r}`;
      if (cell === quantityCell) continue;
      const res = await readLiveCell(loc.sheet, cell);
      const val = res.body?.value ?? "";
      if (normalizeQty(val) === prodNorm || normalizeQty(val).includes(prodNorm) || prodNorm.includes(normalizeQty(val))) {
        productCell = cell;
        productValue = val;
        break;
      }
    }
  }

  if (normalizeQty(quantityValue) !== qtyNorm && !qtyNorm.includes(normalizeQty(quantityValue))) {
    return {
      ok: false,
      reason: `valor vivo "${quantityValue}" no coincide con WorkItem quantity "${item.quantity}"`,
      quantityCell,
      quantityValue,
    };
  }

  return {
    ok: true,
    loc,
    quantityCell,
    quantityValue,
    productCell,
    productValue,
    testValue: suggestTestValue(quantityValue),
    restoreValue: quantityValue,
  };
}

async function discover() {
  console.log(`\n=== Flujo A — descubrimiento de celda viva ===\nBASE=${BASE}\n`);

  await fetchJson("/api/v1/work-items?sector=ELABORACION&ownerPerson=Cristian");
  const items = (await fetchElaboracionItems()).filter(
    (i) => i.sourceRange && i.quantity && i.ownerPerson
  );

  if (items.length === 0) {
    console.error("FAIL: sin WorkItems de Elaboración con sourceRange y quantity.");
    process.exit(1);
  }

  const ranked = [...items].sort((a, b) => rankCandidate(b) - rankCandidate(a));
  const candidate = ITEM_ID_ARG
    ? items.find((i) => i.id === ITEM_ID_ARG)
    : ranked.find((i) => (parseSourceRange(i.sourceRange)?.row ?? 0) >= MIN_ROW) ?? ranked[0];

  if (!candidate) {
    console.error("FAIL: no hay candidato.");
    process.exit(1);
  }

  const resolved = await resolveCells(candidate);
  if (!resolved.ok) {
    console.error("\n## Diagnóstico — celda no resuelta\n");
    console.error(`WorkItem: ${candidate.id}`);
    console.error(`sourceRange: ${candidate.sourceRange}`);
    console.error(`Motivo: ${resolved.reason}`);
    if (resolved.anchor) console.error(`Ancla: ${JSON.stringify(resolved.anchor)}`);
    if (resolved.tabs) console.error(`Pestañas disponibles: ${resolved.tabs.join(", ")}`);
    process.exit(1);
  }

  console.log("## Candidato para Flujo A\n");
  console.log(`| Campo | Valor |`);
  console.log(`|-------|-------|`);
  console.log(`| WorkItem id | \`${candidate.id}\` |`);
  console.log(`| Producto | ${candidate.product ?? "—"} |`);
  console.log(`| Responsable | ${candidate.ownerPerson} |`);
  console.log(`| quantity (API) | ${candidate.quantity} |`);
  console.log(`| sourceSheet | ${candidate.sourceSheet} |`);
  console.log(`| sourceRange | ${candidate.sourceRange} |`);
  console.log(`| Celda cantidad | ${resolved.loc.sheet}!${resolved.quantityCell} |`);
  console.log(`| Valor vivo (cantidad) | ${resolved.quantityValue} |`);
  if (resolved.productCell) {
    console.log(`| Celda producto | ${resolved.loc.sheet}!${resolved.productCell} = ${resolved.productValue} |`);
  }
  console.log(`| Valor temporal sugerido | ${resolved.testValue} |`);
  console.log(`| Restaurar a | ${resolved.restoreValue} |`);
  console.log("\nConfirmá visualmente en Google Sheets antes de ejecutar con `--run --item-id=...`.\n");

  return { candidate, resolved };
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
        if (chunk.includes("snapshot.updated")) onSnapshot(Math.round(performance.now() - t0));
      }
    })
    .catch(() => {});
  return () => controller.abort();
}

async function runTest() {
  const { candidate, resolved } = await discover();

  console.log("Monitoreo activo (SSE + API).");
  console.log("\n══════════════════════════════════════");
  console.log("              EDITAR AHORA");
  console.log("══════════════════════════════════════\n");
  console.log(`Archivo: SEMANAS 2026`);
  console.log(`Pestaña: ${resolved.loc.sheet}`);
  console.log(`Celda: ${resolved.quantityCell}`);
  console.log(`Producto: ${candidate.product ?? "—"}`);
  console.log(`Responsable: ${candidate.ownerPerson}`);
  console.log(`Valor actual: ${resolved.restoreValue}`);
  console.log(`Valor temporal: ${resolved.testValue}`);
  console.log(`Valor para restaurar: ${resolved.restoreValue}\n`);

  const owner = candidate.ownerPerson;
  const baselineQty = candidate.quantity;
  const testNorm = normalizeQty(resolved.testValue);
  const baselineRevision = (await fetchJson("/api/v1/live-sync/status")).body?.revision ?? 0;

  const metrics = {
    editDetectedAt: null,
    statusRevisionAt: null,
    sseElaboracionAt: null,
    sseProduccionAt: null,
    ownerViewAt: null,
    produccionAt: null,
  };

  const perf0 = performance.now();
  let editPerf0 = null;
  let waiting = true;

  const stopElab = connectSse("ELABORACION", (ms) => {
    if (!metrics.sseElaboracionAt) metrics.sseElaboracionAt = ms;
  });
  const stopProd = connectSse("PRODUCCION", (ms) => {
    if (!metrics.sseProduccionAt) metrics.sseProduccionAt = ms;
  });

  const deadline = Date.now() + TIMEOUT_MS;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_MS));

    const status = await fetchJson("/api/v1/live-sync/status");
    const revision = status.body?.revision ?? 0;

    const ownerRes = await fetchJson(
      `/api/v1/work-items?sector=ELABORACION&ownerPerson=${encodeURIComponent(owner)}`
    );
    const prodRes = await fetchJson("/api/v1/work-items?sector=PRODUCCION");

    const ownerItem = (ownerRes.body?.workItems ?? []).find((i) => i.id === candidate.id);
    const prodItem = (prodRes.body?.workItems ?? []).find((i) => i.id === candidate.id);

    const ownerChanged =
      ownerItem && normalizeQty(ownerItem.quantity) === testNorm;
    const prodChanged =
      prodItem && normalizeQty(prodItem.quantity) === testNorm;

    if ((ownerChanged || prodChanged) && waiting) {
      waiting = false;
      editPerf0 = performance.now();
      metrics.editDetectedAt = Math.round(editPerf0 - perf0);
    }

    if (!waiting && revision > baselineRevision && !metrics.statusRevisionAt) {
      metrics.statusRevisionAt = Math.round(performance.now() - editPerf0);
    }

    if (!waiting && ownerChanged && !metrics.ownerViewAt) {
      metrics.ownerViewAt = Math.round(performance.now() - editPerf0);
    }

    if (!waiting && prodChanged && !metrics.produccionAt) {
      metrics.produccionAt = Math.round(performance.now() - editPerf0);
    }

    if (metrics.ownerViewAt && metrics.produccionAt) break;
  }

  stopElab();
  stopProd();

  const total = metrics.produccionAt ?? metrics.ownerViewAt ?? metrics.editDetectedAt;
  const pass = Boolean(metrics.ownerViewAt && metrics.produccionAt && total !== null && total <= GATE_MAX_MS);

  console.log("\n## Métricas Flujo A\n");
  console.log(`| Etapa | ms desde edición |`);
  console.log(`|-------|------------------|`);
  console.log(`| Detección cambio | ${metrics.editDetectedAt ?? "—"} |`);
  console.log(`| Rebuild snapshot (revision) | ${metrics.statusRevisionAt ?? "—"} |`);
  console.log(`| SSE Elaboración | ${metrics.sseElaboracionAt ?? "—"} |`);
  console.log(`| SSE Producción | ${metrics.sseProduccionAt ?? "—"} |`);
  console.log(`| ${owner} (Elaboración) | ${metrics.ownerViewAt ?? "—"} |`);
  console.log(`| Producción | ${metrics.produccionAt ?? "—"} |`);
  console.log(`| **Total** | **${total ?? "TIMEOUT"}** |`);
  console.log(`\nResultado: ${pass ? "PASS" : "FAIL"}`);
  console.log(`\nRestaurar ${resolved.loc.sheet}!${resolved.quantityCell} → ${resolved.restoreValue}`);

  process.exit(pass ? 0 : 1);
}

async function main() {
  if (!DISCOVER && !RUN) {
    console.log("Usar --discover o --run");
    process.exit(1);
  }

  if (DISCOVER && !RUN) {
    await discover();
    return;
  }

  if (RUN) {
    await runTest();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
