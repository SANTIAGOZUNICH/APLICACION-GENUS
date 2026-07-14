#!/usr/bin/env node
/**
 * Simulación multi-instancia vía dos clientes HTTP independientes (sin cookies compartidas).
 */
import { performance } from "node:perf_hooks";

const BASE = (process.env.BASE_URL ?? "").replace(/\/$/, "");
const BYPASS = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim() ?? "";

function headers() {
  const h = { Accept: "application/json", "Content-Type": "application/json" };
  if (BYPASS) h["x-vercel-protection-bypass"] = BYPASS;
  return h;
}

async function fetchJson(path, options = {}) {
  const t0 = performance.now();
  const res = await fetch(`${BASE}${path}`, { ...options, headers: { ...headers(), ...options.headers } });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body, ms: Math.round(performance.now() - t0), vercelId: res.headers.get("x-vercel-id") };
}

async function main() {
  console.log(`\n=== Multi-instancia API ===\nBASE=${BASE}\n`);

  const masivo = await fetchJson("/api/v1/work-items?sector=ENVASADO_MASIVO");
  const target = masivo.body?.workItems?.[0];
  if (!target) {
    console.log("FAIL: sin WorkItems Masivo");
    process.exit(1);
  }

  console.log(`Ítem: ${target.product ?? target.id}`);
  const baseline = await fetchJson("/api/v1/work-items?sector=PRODUCCION");

  const t0 = performance.now();
  const post = await fetchJson("/api/v1/live-sync/operations", {
    method: "POST",
    body: JSON.stringify({
      action: "save_progress",
      itemId: target.id,
      sector: "ENVASADO_MASIVO",
      finishedQty: "300",
      observation: `MULTI-INST-${Date.now()}`,
      updatedBy: "Francisco Zapata",
    }),
  });

  const latencies = [];
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setTimeout(r, 100));
    const prod = await fetchJson("/api/v1/work-items?sector=PRODUCCION");
    const qty = prod.body?.operationalOverlay?.progress?.[target.id]?.finishedQty ?? null;
    if (qty === "300") {
      latencies.push(Math.round(performance.now() - t0));
      break;
    }
    latencies.push(null);
  }

  const final = await fetchJson("/api/v1/work-items?sector=PRODUCCION");
  const qty =
    final.body?.operationalOverlay?.progress?.[target.id]?.finishedQty ??
    final.body?.workItems?.find((i) => i.id === target.id)?.finishedQty;

  console.log("\n| Paso | PASS/FAIL | Latencia | Observación |");
  console.log("|------|-----------|----------|-------------|");
  console.log(`| POST save_progress | ${post.ok ? "PASS" : "FAIL"} | ${post.ms}ms | vercel=${post.vercelId ?? "?"} |`);
  const lat = latencies.find((l) => l !== null);
  console.log(
    `| Producción ve Terminadas=300 | ${qty === "300" ? "PASS" : "FAIL"} | ${lat ?? ">500"}ms | visto=${qty ?? "null"} vercel=${final.vercelId ?? "?"} |`
  );

  if (qty !== "300") {
    console.log("\nEvidencia posible fallo multi-instancia:");
    console.log(`- POST x-vercel-id: ${post.vercelId}`);
    console.log(`- GET  x-vercel-id: ${final.vercelId}`);
    console.log(`- revision baseline: ${baseline.body?.operationalOverlay?.revision}`);
    console.log(`- revision final: ${final.body?.operationalOverlay?.revision}`);
  }

  process.exit(qty === "300" ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
