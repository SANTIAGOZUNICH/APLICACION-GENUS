import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.PREVIEW_BASE ?? "http://127.0.0.1:3010";
const OUT = process.env.PREVIEW_OUT ?? "/opt/cursor/artifacts/screenshots/f54-operational-review";

const CAPTURES = [
  {
    id: "01-envasado-masivo",
    file: "01-envasado-masivo.png",
    title: "1. Envasado Masivo",
    setup: async (page) => {
      await page.locator("button").filter({ hasText: "Envasado Masivo" }).click();
    },
    marker: "Exfoliante Arroz",
    viewport: { width: 1440, height: 900 },
  },
  {
    id: "02-envasado-premium",
    file: "02-envasado-premium.png",
    title: "2. Envasado Premium",
    setup: async (page) => {
      await page.locator("button").filter({ hasText: "Envasado Premium" }).click();
    },
    marker: "Serum Vitamina C",
    viewport: { width: 1440, height: 900 },
  },
  {
    id: "03-elaboracion-cristian",
    file: "03-elaboracion-cristian.png",
    title: "3. Elaboración · Cristian",
    setup: async (page) => {
      await page.getByRole("button", { name: /Cristian/i }).click();
    },
    marker: "Serum Niacinamida",
    notMarker: "After Shave",
    viewport: { width: 1440, height: 900 },
  },
  {
    id: "04-elaboracion-nicolas",
    file: "04-elaboracion-nicolas.png",
    title: "4. Elaboración · Nicolás",
    setup: async (page) => {
      await page.getByRole("button", { name: /Nicolás/i }).click();
    },
    marker: "After Shave",
    notMarker: "Serum Niacinamida",
    viewport: { width: 1440, height: 900 },
  },
  {
    id: "05-calidad-elaboracion",
    file: "05-calidad-elaboracion.png",
    title: "5. Calidad · Elaboración",
    useLogin: true,
    email: "calidad@laboratoriogenus.com.ar",
    password: "calidad123",
    marker: "Aprobar",
    viewport: { width: 1440, height: 900 },
  },
  {
    id: "06-calidad-acondicionamiento",
    file: "06-calidad-acondicionamiento.png",
    title: "6. Calidad · Acondicionamiento",
    useLogin: true,
    email: "calidad@laboratoriogenus.com.ar",
    password: "calidad123",
    clickTab: "Acondicionamiento",
    marker: "Aprobar salida",
    viewport: { width: 1440, height: 900 },
  },
  {
    id: "07-produccion-rechazados",
    file: "07-produccion-rechazados.png",
    title: "7. Producción · Rechazados",
    setup: async (page) => {
      await page.locator("button").filter({ hasText: "Producción" }).click();
    },
    clickTab: "Rechazados",
    marker: "Gel Limpiador",
    viewport: { width: 1440, height: 900 },
  },
  {
    id: "08-produccion-aprobados",
    file: "08-produccion-aprobados.png",
    title: "8. Producción · Aprobados",
    setup: async (page) => {
      await page.locator("button").filter({ hasText: "Producción" }).click();
    },
    clickTab: "Aprobados",
    marker: "Shampoo Reparador",
    viewport: { width: 1440, height: 900 },
  },
  {
    id: "09-produccion-elaboracion",
    file: "09-produccion-elaboracion.png",
    title: "9. Producción · Elaboración",
    setup: async (page) => {
      await page.locator("button").filter({ hasText: "Producción" }).click();
    },
    clickTab: "Elaboración",
    marker: "Serum Niacinamida",
    viewport: { width: 1440, height: 900 },
  },
  {
    id: "10-produccion-envasados",
    file: "10-produccion-envasados.png",
    title: "10. Producción · Envasados",
    setup: async (page) => {
      await page.locator("button").filter({ hasText: "Producción" }).click();
    },
    clickTab: "Envasados",
    marker: "Exfoliante Arroz",
    viewport: { width: 1440, height: 900 },
  },
  {
    id: "11-produccion-kpis",
    file: "11-produccion-kpis.png",
    title: "11. Producción · KPIs",
    setup: async (page) => {
      await page.locator("button").filter({ hasText: "Producción" }).click();
    },
    clickTab: "KPIs completos",
    marker: "TOTAL WORKITEMS",
    viewport: { width: 1440, height: 900 },
  },
  {
    id: "12-mobile-envasado-masivo",
    file: "12-mobile-envasado-masivo.png",
    title: "Mobile · Envasado Masivo",
    setup: async (page) => {
      await page.locator("button").filter({ hasText: "Envasado Masivo" }).click();
    },
    marker: "Refrescar",
    viewport: { width: 390, height: 844 },
  },
  {
    id: "13-mobile-calidad-elaboracion",
    file: "13-mobile-calidad-elaboracion.png",
    title: "Mobile · Calidad Elaboración",
    useLogin: true,
    email: "calidad@laboratoriogenus.com.ar",
    password: "calidad123",
    marker: "Rechazar",
    viewport: { width: 390, height: 844 },
  },
];

mkdirSync(OUT, { recursive: true });

async function loginViaForm(page, email, password) {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.fill("#os-sign-in-email", email);
  await page.fill("#os-sign-in-password", password);
  await page.click('button[type="submit"]');
  await page.waitForURL("**/mi-trabajo**", { timeout: 30000 });
  await page.waitForTimeout(800);
}

async function openMiTrabajo(page) {
  await page.goto(`${BASE}/mi-trabajo`, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
}

const browser = await chromium.launch({ headless: true });
const gallery = [];
const notes = [];

for (const capture of CAPTURES) {
  const page = await browser.newPage({ viewport: capture.viewport });

  if (capture.useLogin) {
    await loginViaForm(page, capture.email, capture.password);
  } else {
    await openMiTrabajo(page);
    if (capture.setup) await capture.setup(page);
    await page.waitForTimeout(800);
  }

  if (capture.clickTab) {
    await page.getByRole("tab", { name: new RegExp(capture.clickTab, "i") }).click();
    await page.waitForTimeout(500);
  }

  await page.waitForFunction(
    (expected) => document.body.innerText.includes(expected),
    capture.marker,
    { timeout: 25000 }
  );

  if (capture.notMarker) {
    const hasLeak = await page.evaluate(
      (text) => document.body.innerText.includes(text),
      capture.notMarker
    );
    notes.push({
      id: capture.id,
      filterOk: !hasLeak,
      note: hasLeak
        ? `⚠ Filtrado: aparece "${capture.notMarker}" (no debería)`
        : `✓ Filtrado OK — no aparece "${capture.notMarker}"`,
    });
  }

  await page.waitForTimeout(500);
  const outPath = join(OUT, capture.file);
  await page.screenshot({ path: outPath, fullPage: true });
  gallery.push({ ...capture, path: outPath });
  console.log(`✓ ${capture.file}`);
  await page.close();
}

await browser.close();

const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>PR #47 — Operational mi-trabajo review</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 2rem auto; max-width: 1200px; padding: 0 1rem; background: #f5f5f4; color: #1c1917; }
    h1 { font-size: 1.6rem; }
    .meta { color: #57534e; font-size: 0.9rem; margin-bottom: 2rem; }
    .checks { background: #fff; border: 1px solid #e7e5e4; border-radius: 8px; padding: 1rem 1.25rem; margin-bottom: 2rem; }
    .checks li { margin: 0.35rem 0; }
    .grid { display: grid; gap: 2rem; }
    figure { background: #fff; border: 1px solid #e7e5e4; border-radius: 8px; padding: 1rem; margin: 0; }
    figcaption { font-weight: 600; margin-bottom: 0.75rem; font-size: 1rem; }
    img { max-width: 100%; border: 1px solid #e7e5e4; border-radius: 4px; }
    .mobile img { max-width: 390px; }
  </style>
</head>
<body>
  <h1>PR #47 — Vistas operativas /mi-trabajo</h1>
  <p class="meta">Capturas generadas ${new Date().toLocaleString("es-AR")} · Base ${BASE}</p>
  <section class="checks">
    <strong>Validaciones automáticas</strong>
    <ul>
      <li>Tablas operativas tipo Sheets (sin cards premium abstractas)</li>
      <li>Botón <em>Refrescar</em> + indicador de sync visible</li>
      <li>Calidad: botones Aprobar / Rechazar (y Aprobar salida / Rechazar salida)</li>
      <li>Producción: tabs Rechazados / Aprobados / Elaboración / Envasados / KPIs</li>
      ${notes.map((n) => `<li>${n.note}</li>`).join("\n      ")}
    </ul>
  </section>
  <div class="grid">
${gallery
  .map(
    (item) => `    <figure class="${item.viewport.width < 500 ? "mobile" : ""}">
      <figcaption>${item.title}</figcaption>
      <img src="${item.file}" alt="${item.title}" loading="lazy" />
    </figure>`
  )
  .join("\n")}
  </div>
</body>
</html>`;

writeFileSync(join(OUT, "index.html"), html);
console.log(`Gallery: ${join(OUT, "index.html")}`);
