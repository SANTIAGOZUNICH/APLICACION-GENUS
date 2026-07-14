#!/usr/bin/env node
/**
 * Flujo A — celda viva desde WorkItem API + verificación Google Sheet.
 *
 * No asume que sourceRange = celda de cantidad.
 * Usa quantitySourceRange / productSourceRange del parser.
 *
 * Uso:
 *   node frontend/scripts/flow-a-live-cell.mjs --discover
 *   node frontend/scripts/flow-a-live-cell.mjs --run --item-id=<id>
 */

import { performance } from "node:perf_hooks";

const BASE = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const BYPASS = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim() ?? "";
const DISCOVER = process.argv.includes("--discover");
const RUN = process.argv.includes("--run");
const ITEM_ID_ARG =
  process.argv.find((a) => a.startsWith("--item-id="))?.split("=")[1] ??
  process.argv[process.argv.indexOf("--item-id") + 1] ??
  null;

const OWNERS = ["Cristian", "Nicolás"];
const MIN_ROW = 500;
const POLL_MS = 250;
const TIMEOUT_MS = 120_000;
const GATE_MAX_MS = 5000;
const PREFERRED_PRODUCT = process.env.FLOW_A_PRODUCT?.trim() || "PROBIOTONIC BALANCE";

function headers(extra = {}) {
  const h = { Accept: "application/json", ...extra };
  if (BYPASS) h["x-vercel-protection-bypass"] = BYPASS;
  return h;
}

async function fetchJson(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: headers(options.headers),
  });
  const text = await res.text();
  let body = null;
  try {
    body = text.trim() ? JSON.parse(text) : null;
  } catch {
    body = { _raw: text.slice(0, 300) };
  }
  return { ok: res.ok, status: res.status, body };
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
    a1: `${m[1]}!${colLetter(col)}${row}`,
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

async function warmPreview() {
  await fetchJson("/api/v1/drive/refresh?scope=critical_sheets");
  for (let attempt = 0; attempt < 20; attempt++) {
    const probe = await readLiveCell("ELABORACION!B536");
    if (probe.ok && probe.body?.value) {
      return;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error("No se pudo calentar índice SEMANAS — reintentar en unos segundos.");
}

async function readLiveCell(a1) {
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
  const slot = parseSourceRange(item.sourceRange);
  const qty = parseSourceRange(item.quantitySourceRange);
  const row = qty?.row ?? slot?.row ?? 0;
  let score = 0;

  if (row >= MIN_ROW) score += row;
  else score -= 5000;

  if (!item.quantitySourceRange) score -= 8000;
  if (slot?.ambiguous || qty?.ambiguous) score -= 10000;

  if (item.product && item.quantity && isQuantityLike(item.quantity) && !isQuantityLike(item.product)) {
    score += 3000;
  }

  if (item.product === PREFERRED_PRODUCT) score += 5000;

  if (OWNERS.includes(item.ownerPerson ?? "")) score += 100;

  return score;
}

async function resolveCells(item) {
  const slotLoc = parseSourceRange(item.sourceRange);
  let qtyLoc = parseSourceRange(item.quantitySourceRange);
  let prodLoc = parseSourceRange(item.productSourceRange);

  if ((!qtyLoc || qtyLoc.ambiguous) && slotLoc && !slotLoc.ambiguous) {
    const derivedQtyRow = slotLoc.row - 1;
    const derivedProdRow = slotLoc.row - 2;
    if (derivedQtyRow >= 1) {
      const derivedQtyA1 = `${slotLoc.sheet}!${colLetter(slotLoc.col)}${derivedQtyRow}`;
      const derivedProdA1 = `${slotLoc.sheet}!${colLetter(slotLoc.col)}${derivedProdRow}`;
      const [qtyLive, prodLive] = await Promise.all([
        readLiveCell(derivedQtyA1),
        readLiveCell(derivedProdA1),
      ]);
      const qtyVal = qtyLive.body?.value ?? "";
      const prodVal = prodLive.body?.value ?? "";
      const qtyMatches = normalizeQty(qtyVal) === normalizeQty(item.quantity);
      const prodMatches =
        !item.product ||
        normalizeQty(prodVal) === normalizeQty(item.product) ||
        normalizeQty(prodVal).includes(normalizeQty(item.product));

      if (qtyMatches && prodMatches) {
        qtyLoc = {
          sheet: slotLoc.sheet,
          row: derivedQtyRow,
          col: slotLoc.col,
          cell: `${colLetter(slotLoc.col)}${derivedQtyRow}`,
          a1: derivedQtyA1,
          ambiguous: false,
          derived: true,
        };
        prodLoc = {
          sheet: slotLoc.sheet,
          row: derivedProdRow,
          col: slotLoc.col,
          cell: `${colLetter(slotLoc.col)}${derivedProdRow}`,
          a1: derivedProdA1,
          ambiguous: false,
          derived: true,
        };
      }
    }
  }

  if (!qtyLoc || qtyLoc.ambiguous) {
    return {
      ok: false,
      reason:
        "quantitySourceRange ausente y no se pudo verificar celda viva (slot−1 / producto slot−2).",
      sourceRange: item.sourceRange,
      quantitySourceRange: item.quantitySourceRange ?? null,
      productSourceRange: item.productSourceRange ?? null,
    };
  }

  const sheet = qtyLoc.sheet;
  const tabProbe = await readLiveCell(`${sheet}!A1`);
  if (tabProbe.status === 404 && tabProbe.body?.code === "TAB_NOT_FOUND") {
    return {
      ok: false,
      reason: `pestaña "${sheet}" no existe en Sheet vivo`,
      tabs: tabProbe.body?.tabs,
    };
  }
  if (tabProbe.status === 404 && String(tabProbe.body?._raw ?? "").includes("<!DOCTYPE")) {
    return {
      ok: false,
      reason:
        "endpoint /api/v1/sheets/cell no disponible en preview — esperar deploy con lectura viva",
    };
  }

  const qtyLive = await readLiveCell(qtyLoc.a1);
  if (!qtyLive.ok || qtyLive.body?.code === "SHEET_READ_FAILED") {
    return {
      ok: false,
      reason: `no se pudo leer celda viva ${qtyLoc.a1}`,
      detail: qtyLive.body,
    };
  }

  const quantityValue = qtyLive.body?.value ?? "";
  const qtyNorm = normalizeQty(item.quantity);
  const liveNorm = normalizeQty(quantityValue);

  if (liveNorm !== qtyNorm && !qtyNorm.includes(liveNorm) && !liveNorm.includes(qtyNorm)) {
    return {
      ok: false,
      reason: `Sheet vivo ${qtyLoc.a1}="${quantityValue}" ≠ WorkItem quantity="${item.quantity}"`,
      quantityCell: qtyLoc.cell,
      quantityValue,
    };
  }

  let productCell = prodLoc?.cell ?? null;
  let productValue = null;

  if (prodLoc) {
    const prodLive = await readLiveCell(prodLoc.a1);
    productValue = prodLive.body?.value ?? null;
    if (item.product && productValue) {
      const pNorm = normalizeQty(item.product);
      const pvNorm = normalizeQty(productValue);
      if (pNorm !== pvNorm && !pNorm.includes(pvNorm) && !pvNorm.includes(pNorm)) {
        return {
          ok: false,
          reason: `producto vivo ${prodLoc.a1}="${productValue}" ≠ WorkItem product="${item.product}"`,
          productCell,
          quantityCell: qtyLoc.cell,
        };
      }
    }
  }

  return {
    ok: true,
    sheet,
    slotCell: slotLoc?.cell ?? null,
    productCell,
    productValue,
    quantityCell: qtyLoc.cell,
    quantityA1: qtyLoc.a1,
    quantityValue,
    testValue: suggestTestValue(quantityValue),
    restoreValue: quantityValue,
    sourceRange: item.sourceRange,
    quantitySourceRange:
      item.quantitySourceRange ??
      (qtyLoc.derived ? `${qtyLoc.sheet}!${qtyLoc.row}:${qtyLoc.col}` : null),
    productSourceRange:
      item.productSourceRange ??
      (prodLoc?.derived ? `${prodLoc.sheet}!${prodLoc.row}:${prodLoc.col}` : prodLoc?.a1 ?? null),
    quantityDerived: Boolean(qtyLoc.derived),
  };
}

function printCandidate(candidate, resolved) {
  console.log("## Candidato Flujo A (verificado contra Sheet vivo)\n");
  console.log(`| Campo | Valor |`);
  console.log(`|-------|-------|`);
  console.log(`| WorkItem | \`${candidate.id}\` |`);
  console.log(`| Producto | ${candidate.product ?? "—"} |`);
  console.log(`| Responsable | ${candidate.ownerPerson} |`);
  console.log(`| sourceRange (slot) | ${resolved.sourceRange ?? "—"} |`);
  console.log(`| quantitySourceRange | ${resolved.quantitySourceRange ?? "—"} |`);
  console.log(`| productSourceRange | ${resolved.productSourceRange ?? "—"} |`);
  console.log(`| productCell | ${resolved.productCell ? `${resolved.sheet}!${resolved.productCell}` : "—"} |`);
  console.log(`| quantityCell | ${resolved.sheet}!${resolved.quantityCell} |`);
  console.log(`| Valor vivo (cantidad) | ${resolved.quantityValue} |`);
  console.log(`| Valor temporal propuesto | ${resolved.testValue} |`);
  console.log(`| Valor original (restaurar) | ${resolved.restoreValue} |`);
}

async function discover() {
  console.log(`\n=== Flujo A — descubrimiento de celda viva ===\nBASE=${BASE}\n`);

  await warmPreview();
  const items = (await fetchElaboracionItems()).filter(
    (i) => i.sourceRange && i.quantity && i.ownerPerson
  );

  if (items.length === 0) {
    console.error("FAIL: sin WorkItems de Elaboración.");
    process.exit(1);
  }

  const ranked = [...items].sort((a, b) => rankCandidate(b) - rankCandidate(a));
  const candidate = ITEM_ID_ARG
    ? items.find((i) => i.id === ITEM_ID_ARG)
    : items.find((i) => i.product === PREFERRED_PRODUCT) ?? ranked[0];

  if (!candidate) {
    console.error("FAIL: candidato no encontrado.");
    process.exit(1);
  }

  const resolved = await resolveCells(candidate);
  if (!resolved.ok) {
    console.error("\n## Diagnóstico — no se puede ejecutar Flujo A\n");
    console.error(`WorkItem: ${candidate.id}`);
    console.error(`sourceRange: ${candidate.sourceRange}`);
    console.error(`quantitySourceRange: ${candidate.quantitySourceRange ?? "—"}`);
    console.error(`Motivo: ${resolved.reason}`);
    if (resolved.tabs) console.error(`Pestañas: ${resolved.tabs.join(", ")}`);
    process.exit(1);
  }

  printCandidate(candidate, resolved);

  if (RUN) {
    return { candidate, resolved, liveVerified: true };
  }

  console.log(
    "\nVerificación vivo: OK — listo para `--run` cuando confirmes.\n" +
      "No se imprime EDITAR AHORA hasta ejecutar con --run.\n"
  );

  return { candidate, resolved, liveVerified: true };
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

  console.log("\n══════════════════════════════════════");
  console.log("              EDITAR AHORA");
  console.log("══════════════════════════════════════\n");
  console.log(`Archivo: SEMANAS 2026`);
  console.log(`Pestaña: ${resolved.sheet}`);
  console.log(`Celda: ${resolved.quantityCell}`);
  console.log(`Producto: ${candidate.product ?? "—"}`);
  console.log(`Responsable: ${candidate.ownerPerson}`);
  console.log(`Valor actual: ${resolved.restoreValue}`);
  console.log(`Valor temporal: ${resolved.testValue}`);
  console.log(`Valor para restaurar: ${resolved.restoreValue}\n`);

  const owner = candidate.ownerPerson;
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

    const ownerChanged = ownerItem && normalizeQty(ownerItem.quantity) === testNorm;
    const prodChanged = prodItem && normalizeQty(prodItem.quantity) === testNorm;

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
  const pass = Boolean(
    metrics.ownerViewAt && metrics.produccionAt && total !== null && total <= GATE_MAX_MS
  );

  console.log("\n## Métricas Flujo A\n");
  console.log(`| Etapa | ms |`);
  console.log(`|-------|-----|`);
  console.log(`| Detección | ${metrics.editDetectedAt ?? "—"} |`);
  console.log(`| Snapshot revision | ${metrics.statusRevisionAt ?? "—"} |`);
  console.log(`| SSE Elaboración | ${metrics.sseElaboracionAt ?? "—"} |`);
  console.log(`| SSE Producción | ${metrics.sseProduccionAt ?? "—"} |`);
  console.log(`| ${owner} | ${metrics.ownerViewAt ?? "—"} |`);
  console.log(`| Producción | ${metrics.produccionAt ?? "—"} |`);
  console.log(`| **Total** | **${total ?? "TIMEOUT"}** |`);
  console.log(`\nResultado: ${pass ? "PASS" : "FAIL"}`);
  console.log(`\nRestaurar ${resolved.quantityA1} → ${resolved.restoreValue}`);

  process.exit(pass ? 0 : 1);
}

async function main() {
  if (!DISCOVER && !RUN) {
    console.log("Usar --discover o --run");
    process.exit(1);
  }

  if (RUN) {
    await runTest();
    return;
  }

  await discover();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
