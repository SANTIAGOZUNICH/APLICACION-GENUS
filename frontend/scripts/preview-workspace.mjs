import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.PREVIEW_BASE ?? "http://127.0.0.1:3001";
const OUT = process.env.PREVIEW_OUT ?? "/opt/cursor/artifacts/screenshots";

const SESSIONS = [
  {
    slug: "produccion",
    marker: "8 órdenes",
    session: {
      status: "preview",
      mode: "preview",
      user: {
        email: "produccion@laboratoriogenus.com.ar",
        displayName: "María Producción",
        jobTitle: "Supervisora de Planta",
        company: "Laboratorio Genus",
      },
      sector: { id: "PRODUCCION", label: "Producción" },
      role: { id: "ROL-SU", label: "Supervisor" },
      rememberMe: false,
      redirectTo: "/mi-trabajo",
      createdAt: "2026-07-03T12:00:00.000Z",
    },
  },
  {
    slug: "calidad",
    marker: "5 lotes",
    session: {
      status: "preview",
      mode: "preview",
      user: {
        email: "calidad@laboratoriogenus.com.ar",
        displayName: "Lucía Calidad",
        jobTitle: "Analista de Calidad",
        company: "Laboratorio Genus",
      },
      sector: { id: "CALIDAD", label: "Calidad" },
      role: { id: "ROL-CA", label: "Calidad" },
      rememberMe: false,
      redirectTo: "/mi-trabajo",
      createdAt: "2026-07-03T12:00:00.000Z",
    },
  },
  {
    slug: "deposito",
    marker: "14 movimientos",
    session: {
      status: "preview",
      mode: "preview",
      user: {
        email: "deposito@laboratoriogenus.com.ar",
        displayName: "Belén Depósito",
        jobTitle: "Operaria de Depósito",
        company: "Laboratorio Genus",
      },
      sector: { id: "DEPOSITO", label: "Depósito" },
      role: { id: "ROL-OP", label: "Operario" },
      rememberMe: false,
      redirectTo: "/mi-trabajo",
      createdAt: "2026-07-03T12:00:00.000Z",
    },
  },
  {
    slug: "direccion",
    marker: "funcionando normalmente",
    session: {
      status: "preview",
      mode: "preview",
      user: {
        email: "direccion@laboratoriogenus.com.ar",
        displayName: "Santiago Dirección",
        jobTitle: "Director General",
        company: "Laboratorio Genus",
      },
      sector: { id: "DIRECCION", label: "Dirección" },
      role: { id: "ROL-DI", label: "Dirección" },
      rememberMe: false,
      redirectTo: "/mi-trabajo",
      createdAt: "2026-07-03T12:00:00.000Z",
    },
  },
];

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
await page.screenshot({ path: join(OUT, "01-login.png") });

for (const { slug, marker, session } of SESSIONS) {
  await page.context().clearCookies();
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    sessionStorage.clear();
    localStorage.clear();
  });
  await page.evaluate((payload) => {
    sessionStorage.setItem("genus_os_auth_session", JSON.stringify(payload));
  }, session);

  await page.goto(`${BASE}/mi-trabajo`, { waitUntil: "networkidle" });
  await page.waitForFunction(
    (expected) => document.body.innerText.includes(expected),
    marker,
    { timeout: 15000 }
  );
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(OUT, `02-workspace-${slug}.png`), fullPage: true });
}

await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
await page.fill("#os-sign-in-email", "produccion@laboratoriogenus.com.ar");
await page.fill("#os-sign-in-password", "produccion123");
await page.click('button[type="submit"]');
await page.waitForURL("**/mi-trabajo**", { timeout: 25000 });
await page.waitForTimeout(800);
await page.screenshot({ path: join(OUT, "03-login-flow-produccion.png"), fullPage: true });

await browser.close();
console.log(`Screenshots saved to ${OUT}`);
