#!/usr/bin/env node
/**
 * Gate multi-browser — Francisco / Agustina / Santiago con snapshot caliente.
 *
 * Uso:
 *   BASE_URL=https://preview.vercel.app \
 *   VERCEL_AUTOMATION_BYPASS_SECRET=xxx \
 *   node frontend/scripts/gate-multi-browser.mjs
 */

import { chromium } from "playwright";
import { performance } from "node:perf_hooks";

const BASE = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const BYPASS = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim() ?? "";
const MARKER = `GATE-MB-${Date.now()}`;
const TERMINADAS = "300";

const results = [];

function headers(extra = {}) {
  const h = { Accept: "application/json", "Content-Type": "application/json", ...extra };
  if (BYPASS) h["x-vercel-protection-bypass"] = BYPASS;
  return h;
}

async function fetchJson(path, options = {}) {
  const t0 = performance.now();
  const res = await fetch(`${BASE}${path}`, { ...options, headers: headers(options.headers) });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body, ms: Math.round(performance.now() - t0) };
}

function record(step, user, pass, latencyMs, obs) {
  results.push({ step, user, pass, latencyMs, obs });
  console.log(`| ${step} | ${user} | ${pass} | ${latencyMs}ms | ${obs} |`);
}

async function warmSnapshot() {
  const queries = [
    "sector=ENVASADO_MASIVO",
    "sector=PRODUCCION",
    "sector=CALIDAD",
    "sector=ELABORACION&ownerPerson=Cristian",
  ];
  for (const q of queries) {
    const res = await fetchJson(`/api/v1/work-items?${q}`);
    if (res.ms > 5000) {
      console.warn(`WARN warm ${q}: ${res.ms}ms (>5s)`);
    }
  }
  const warm = await fetchJson("/api/v1/work-items?sector=ENVASADO_MASIVO");
  return warm;
}

function bypassQuery() {
  if (!BYPASS) return "";
  return `?x-vercel-set-bypass-cookie=true&x-vercel-protection-bypass=${encodeURIComponent(BYPASS)}`;
}

function buildPreviewSession({ email, displayName, sector, sectorLabel, role, roleLabel, jobTitle }) {
  return {
    status: "preview",
    mode: "preview",
    user: {
      email,
      displayName,
      jobTitle,
      company: "Laboratorio Genus",
    },
    sector: { id: sector, label: sectorLabel },
    role: { id: role, label: roleLabel },
    rememberMe: false,
    redirectTo: "/mi-trabajo",
    createdAt: new Date().toISOString(),
  };
}

const PERSONAS = {
  francisco: buildPreviewSession({
    email: "masivo@laboratoriogenus.com.ar",
    displayName: "Francisco Zapata",
    sector: "ENVASADO_MASIVO",
    sectorLabel: "Envasado Masivo",
    role: "ROL-OP",
    roleLabel: "Operario",
    jobTitle: "Responsable Envasado Masivo",
  }),
  agustina: buildPreviewSession({
    email: "produccion@laboratoriogenus.com.ar",
    displayName: "Agustina Zunich",
    sector: "PRODUCCION",
    sectorLabel: "Producción",
    role: "ROL-SU",
    roleLabel: "Supervisora",
    jobTitle: "Supervisora de Planta",
  }),
  santiago: buildPreviewSession({
    email: "calidad@laboratoriogenus.com.ar",
    displayName: "Santiago Zunich",
    sector: "CALIDAD",
    sectorLabel: "Calidad",
    role: "ROL-CA",
    roleLabel: "Calidad",
    jobTitle: "Responsable de Calidad",
  }),
};

async function openAsPersona(page, session) {
  await page.goto(`${BASE}/login${bypassQuery()}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.evaluate((payload) => {
    localStorage.setItem("genus_os_auth_session", JSON.stringify(payload));
    sessionStorage.setItem("genus_os_auth_session", JSON.stringify(payload));
  }, session);
  await page.goto(`${BASE}/mi-trabajo${bypassQuery()}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(1200);
}

async function openSector(page, label) {
  const btn = page.locator("button").filter({ hasText: label });
  if (await btn.count()) {
    await btn.first().click();
    await page.waitForTimeout(600);
  }
}

async function waitForApiProgress(itemId, expected, timeoutMs = 15000) {
  const t0 = performance.now();
  while (performance.now() - t0 < timeoutMs) {
    const prod = await fetchJson("/api/v1/work-items?sector=PRODUCCION");
    const qty =
      prod.body?.operationalOverlay?.progress?.[itemId]?.finishedQty ??
      prod.body?.workItems?.find((i) => i.id === itemId)?.finishedQty;
    if (qty === expected) return Math.round(performance.now() - t0);
    await new Promise((r) => setTimeout(r, 200));
  }
  return null;
}

async function waitForUiProgress(page, itemId, expected, timeoutMs = 15000) {
  const t0 = performance.now();
  while (performance.now() - t0 < timeoutMs) {
    const seen = await page.evaluate(
      ({ id, qty }) => {
        const text = document.body.innerText;
        return text.includes(qty) || text.includes(id.slice(0, 12));
      },
      { id: itemId, qty: expected }
    );
    if (seen) return Math.round(performance.now() - t0);
    await page.waitForTimeout(400);
  }
  return null;
}

async function waitForPageOrApi(page, itemId, expected, timeoutMs = 15000) {
  const apiLat = await waitForApiProgress(itemId, expected, timeoutMs);
  if (apiLat !== null) return { lat: apiLat, via: "API" };

  const uiLat = await waitForUiProgress(page, itemId, expected, 2000);
  if (uiLat !== null) return { lat: uiLat, via: "UI" };

  return null;
}

async function main() {
  console.log(`\n=== Gate multi-browser ===\nBASE=${BASE}\nMARKER=${MARKER}\n`);

  console.log("Fase 0: calentar snapshot vía API…");
  const masivoWarm = await warmSnapshot();
  const target = masivoWarm.body?.workItems?.[0];
  if (!target) {
    console.error("FAIL: sin WorkItems en Masivo tras warm");
    process.exit(1);
  }
  record("warm", "API", masivoWarm.ms < 500 ? "PASS" : masivoWarm.ms < 3000 ? "WARN" : "FAIL", masivoWarm.ms, `${masivoWarm.body.workItems.length} items`);

  const browser = await chromium.launch({ headless: true });

  const franciscoCtx = await browser.newContext();
  const agustinaCtx = await browser.newContext();
  const santiagoCtx = await browser.newContext();

  const francisco = await franciscoCtx.newPage();
  const agustina = await agustinaCtx.newPage();
  const santiago = await santiagoCtx.newPage();

  try {
    await openAsPersona(francisco, PERSONAS.francisco);
    await openAsPersona(agustina, PERSONAS.agustina);
    await openAsPersona(santiago, PERSONAS.santiago);

    await openSector(francisco, "Envasado Masivo");
    await openSector(agustina, "Producción");

    await francisco.waitForFunction(
      () => document.querySelectorAll("table tbody tr").length > 0,
      { timeout: 45000 }
    );
    await agustina.waitForFunction(
      () => document.body.innerText.length > 200,
      { timeout: 45000 }
    );

    const tSave = performance.now();
    const save = await fetchJson("/api/v1/live-sync/operations", {
      method: "POST",
      body: JSON.stringify({
        action: "save_progress",
        itemId: target.id,
        sector: "ENVASADO_MASIVO",
        finishedQty: TERMINADAS,
        observation: MARKER,
        updatedBy: "Francisco Zapata",
      }),
    });
    record(
      "save_progress",
      "Francisco",
      save.ok ? "PASS" : "FAIL",
      save.ms,
      `Terminadas=${TERMINADAS}`
    );

    const franciscoSeen = await waitForPageOrApi(francisco, target.id, TERMINADAS);
    record(
      "terminadas",
      "Francisco",
      franciscoSeen ? "PASS" : "FAIL",
      franciscoSeen?.lat ?? Math.round(performance.now() - tSave),
      franciscoSeen ? `vía ${franciscoSeen.via}` : "no visible"
    );

    const agustinaSeen = await waitForPageOrApi(agustina, target.id, TERMINADAS);
    record(
      "propagación",
      "Agustina",
      agustinaSeen ? "PASS" : "FAIL",
      agustinaSeen?.lat ?? ">15000",
      agustinaSeen ? `sin F5 · ${agustinaSeen.via}` : "no propagó"
    );

    const tComplete = performance.now();
    const complete = await fetchJson("/api/v1/live-sync/operations", {
      method: "POST",
      body: JSON.stringify({
        action: "complete_work",
        item: target,
        finishedQty: TERMINADAS,
        observation: `Entrega ${MARKER}`,
        completedBy: "Francisco Zapata",
      }),
    });
    record("entrega", "Francisco→Calidad", complete.ok ? "PASS" : "FAIL", complete.ms, "complete_work");

    await openSector(santiago, "Calidad");
    await santiago.waitForTimeout(800);

    const calidadApi = await fetchJson("/api/v1/work-items?sector=CALIDAD");
    const qItem = (calidadApi.body?.qualityItems ?? []).find(
      (q) => q.relatedWorkItemId === target.id || q.observation?.includes(MARKER)
    );
    const santiagoLat = qItem
      ? await waitForUiProgress(santiago, target.id, target.product?.slice(0, 8) ?? " ", 12000)
      : null;

    record(
      "calidad",
      "Santiago",
      qItem ? "PASS" : "FAIL",
      santiagoLat ?? calidadApi.ms,
      qItem ? "ítem en cola" : "no en qualityItems"
    );

    const qualityId = qItem?.id ?? `quality:${target.id}`;
    const tApprove = performance.now();
    const approve = await fetchJson("/api/v1/live-sync/operations", {
      method: "POST",
      body: JSON.stringify({
        action: "quality_decision",
        itemId: qualityId,
        status: "aprobado",
        decidedBy: "Santiago Zunich",
        observation: `Aprobado ${MARKER}`,
      }),
    });
    record("aprobación", "Santiago", approve.ok ? "PASS" : "FAIL", approve.ms, "aprobado");

    const agustinaApproveLat = await pageWaitDecision(agustina, qualityId, tApprove);
    record(
      "decisión",
      "Agustina",
      agustinaApproveLat !== null ? "PASS" : "FAIL",
      agustinaApproveLat ?? ">15000",
      agustinaApproveLat !== null ? "ve aprobación sin F5" : "no detectada"
    );
  } finally {
    await browser.close();
  }

  console.log("\n## Resumen\n");
  const failed = results.filter((r) => r.pass === "FAIL");
  console.log(`Total: ${results.length} · FAIL: ${failed.length}`);
  if (failed.length > 0) {
    process.exit(1);
  }
}

async function pageWaitDecision(page, qualityId, t0) {
  const timeout = 15000;
  while (performance.now() - t0 < timeout) {
    const prod = await fetchJson("/api/v1/work-items?sector=PRODUCCION");
    const approved =
      prod.body?.operationalOverlay?.decisions?.[qualityId]?.status === "aprobado";
    if (approved) {
      return Math.round(performance.now() - t0);
    }
    await page.waitForTimeout(400);
  }
  return null;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
