/**
 * Playwright smoke: no horizontal scroll on key Genus OS routes.
 *
 * Requires PREVIEW_BASE_URL (e.g. https://your-preview.vercel.app).
 * Skips gracefully when unset.
 *
 * Checks: document.documentElement.scrollWidth <= document.documentElement.clientWidth
 *
 * Routes:
 *   /login — always (no auth)
 *   Authenticated routes require GENUS_SMOKE_EMAIL + GENUS_SMOKE_SECTOR env vars;
 *   when absent, only /login is checked and a skip note is printed.
 */
import { chromium } from "playwright";

const BASE = process.env.PREVIEW_BASE_URL?.trim();

const AUTH_ROUTES = [
  { path: "/", label: "home" },
  { path: "/?view=remitos", label: "remitos" },
  { path: "/?view=metricas", label: "metricas" },
  { path: "/?view=ver_materia_prima", label: "materia-prima" },
];

async function assertNoHScroll(page, label) {
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    path: location.pathname + location.search,
  }));

  const ok = metrics.scrollWidth <= metrics.clientWidth;
  const detail = `${label} ${metrics.path} scroll=${metrics.scrollWidth} client=${metrics.clientWidth}`;
  if (ok) {
    console.log("PASS", detail);
  } else {
    console.error("FAIL", detail);
  }
  return ok;
}

async function main() {
  if (!BASE) {
    console.log("SKIP: PREVIEW_BASE_URL not set — no horizontal-scroll browser check run.");
    console.log("Set PREVIEW_BASE_URL to a deployed preview to enable this script.");
    process.exit(0);
  }

  const email = process.env.GENUS_SMOKE_EMAIL?.trim();
  const sector = process.env.GENUS_SMOKE_SECTOR?.trim();

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();

  const results = [];

  try {
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 120_000 });
    results.push(await assertNoHScroll(page, "login"));

    if (email && sector) {
      await page.evaluate(
        ({ email: e, sector: s }) => {
          sessionStorage.setItem("genus_os_preview_email", e);
          sessionStorage.setItem("genus_os_preview_sector", s);
        },
        { email, sector }
      );

      for (const route of AUTH_ROUTES) {
        await page.goto(`${BASE}${route.path}`, {
          waitUntil: "networkidle",
          timeout: 120_000,
        });
        await page.waitForTimeout(500);
        results.push(await assertNoHScroll(page, route.label));
      }
    } else {
      console.log(
        "SKIP: authenticated routes — set GENUS_SMOKE_EMAIL + GENUS_SMOKE_SECTOR to check in-app views."
      );
    }
  } finally {
    await browser.close();
  }

  const failed = results.filter((r) => !r).length;
  if (failed > 0) {
    console.error(`\n${failed} route(s) had horizontal overflow.`);
    process.exit(1);
  }

  console.log("\nAll checked routes fit viewport width.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
