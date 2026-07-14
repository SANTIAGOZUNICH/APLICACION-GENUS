#!/usr/bin/env node
/**
 * Gate de detección via /api/v1/live-sync/check (cliente-poll).
 *
 * Uso:
 *   node frontend/scripts/live-sync-check-gate.mjs --baseline
 *   # editar B536 160→161
 *   node frontend/scripts/live-sync-check-gate.mjs --watch --from=<version>
 */

import { performance } from "node:perf_hooks";

const BASE = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const BYPASS = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim() ?? "";
const BASELINE = process.argv.includes("--baseline");
const WATCH = process.argv.includes("--watch");
const FROM =
  process.argv.find((a) => a.startsWith("--from="))?.split("=")[1] ?? null;
const GATE_MAX_MS = Number(process.env.GATE_MAX_MS ?? "6000");
const POLL_MS = 500;

function headers() {
  const h = { Accept: "application/json" };
  if (BYPASS) h["x-vercel-protection-bypass"] = BYPASS;
  return h;
}

async function check(knownVersion) {
  const params = new URLSearchParams({ sector: "ELABORACION" });
  if (knownVersion) params.set("knownVersion", knownVersion);
  const t0 = performance.now();
  const res = await fetch(`${BASE}/api/v1/live-sync/check?${params}`, {
    headers: headers(),
    cache: "no-store",
  });
  const ms = Math.round(performance.now() - t0);
  const body = await res.json();
  return { ok: res.ok, status: res.status, ms, body };
}

async function workItems() {
  const params = new URLSearchParams({
    sector: "ELABORACION",
    ownerPerson: "Nicolás",
  });
  const res = await fetch(`${BASE}/api/v1/work-items?${params}`, {
    headers: headers(),
    cache: "no-store",
  });
  return res.json();
}

function findProbiotic(payload) {
  const items = payload?.workItems ?? [];
  return items.find((i) =>
    String(i.product ?? "")
      .toUpperCase()
      .includes("PROBIOTONIC")
  );
}

if (BASELINE) {
  const a = await check(null);
  console.log(JSON.stringify({ step: "baseline", ...a }, null, 2));
  const b = await check(a.body?.version);
  console.log(
    JSON.stringify(
      {
        step: "unchanged",
        changed: b.body?.changed,
        ms: b.ms,
        version: b.body?.version,
        metrics: b.body?.metrics,
        okUnchanged: b.body?.changed === false && b.ms < 500,
      },
      null,
      2
    )
  );
  process.exit(b.body?.changed === false ? 0 : 1);
}

if (WATCH) {
  if (!FROM) {
    console.error("Usá --from=<knownVersion>");
    process.exit(2);
  }
  const started = performance.now();
  let last = null;
  while (performance.now() - started < GATE_MAX_MS + 5_000) {
    last = await check(FROM);
    const elapsed = Math.round(performance.now() - started);
    console.log(
      JSON.stringify({
        elapsed,
        checkMs: last.ms,
        changed: last.body?.changed,
        version: last.body?.version,
        revision: last.body?.revision,
        metrics: last.body?.metrics,
      })
    );
    if (last.body?.changed) {
      const items = await workItems();
      const item = findProbiotic(items);
      const total = Math.round(performance.now() - started);
      const pass = total <= GATE_MAX_MS && /161/.test(String(item?.quantity ?? ""));
      console.log(
        JSON.stringify(
          {
            gate: pass ? "PASS" : "FAIL",
            totalMs: total,
            gateMaxMs: GATE_MAX_MS,
            quantity: item?.quantity ?? null,
            product: item?.product ?? null,
          },
          null,
          2
        )
      );
      process.exit(pass ? 0 : 1);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  console.log(JSON.stringify({ gate: "FAIL", reason: "timeout", last }, null, 2));
  process.exit(1);
}

console.log("Usá --baseline o --watch --from=<version>");
process.exit(2);
