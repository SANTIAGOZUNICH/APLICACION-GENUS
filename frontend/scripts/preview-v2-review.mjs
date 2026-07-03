import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.PREVIEW_BASE ?? "http://127.0.0.1:3003";
const OUT = process.env.PREVIEW_OUT ?? "/opt/cursor/artifacts/screenshots/f53-v2-review";

const CAPTURES = [
  {
    file: "01-produccion-desktop.png",
    slug: "produccion",
    marker: "OE-0142",
    viewport: { width: 1440, height: 900 },
    fullPage: true,
  },
  {
    file: "02-calidad-desktop.png",
    slug: "calidad",
    marker: "Lote E26014",
    viewport: { width: 1440, height: 900 },
    fullPage: true,
  },
  {
    file: "03-direccion-desktop.png",
    slug: "direccion",
    marker: "No hay excepciones activas hoy",
    viewport: { width: 1440, height: 900 },
    fullPage: true,
  },
  {
    file: "04-produccion-mobile.png",
    slug: "produccion",
    marker: "OE-0142",
    viewport: { width: 390, height: 844 },
    fullPage: true,
  },
];

const SESSIONS = {
  produccion: {
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
    createdAt: "2026-07-03T13:00:00.000Z",
  },
  calidad: {
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
    createdAt: "2026-07-03T13:00:00.000Z",
  },
  direccion: {
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
    createdAt: "2026-07-03T13:00:00.000Z",
  },
};

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });

for (const capture of CAPTURES) {
  const page = await browser.newPage({ viewport: capture.viewport });
  const session = SESSIONS[capture.slug];

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
    capture.marker,
    { timeout: 20000 }
  );
  await page.waitForTimeout(700);
  await page.screenshot({ path: join(OUT, capture.file), fullPage: capture.fullPage });
  await page.close();
}

await browser.close();
console.log(`V2 review screenshots saved to ${OUT}`);
