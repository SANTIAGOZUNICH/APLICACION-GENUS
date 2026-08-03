/**
 * Auditoría real de scroll horizontal + clipping en Preview.
 * Multi-sector, multi-viewport, capturas, Creamy/modales.
 *
 * PREVIEW_BASE_URL=... node scripts/_audit_hscroll_full.mjs
 * No imprime secrets.
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const outDir = path.join(root, "tmp-hscroll-audit-full");
fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(path.join(outDir, "shots"), { recursive: true });

const BASE = (
  process.env.PREVIEW_BASE_URL ||
  "https://aplicacion-genus-jjkxmhacf-santizunich-2879s-projects.vercel.app"
).replace(/\/$/, "");
const BYPASS =
  process.env.VERCEL_PROTECTION_BYPASS || "43WALV7GhTn6dmipL5xWTXTtd4vCDoiW";

const VIEWPORTS = [
  { name: "1920x1080", width: 1920, height: 1080 },
  { name: "1440x900", width: 1440, height: 900 },
  { name: "1366x768", width: 1366, height: 768 },
  { name: "1024x768", width: 1024, height: 768 },
  { name: "390x844", width: 390, height: 844 },
];

/** Sector login → nav labels to visit */
const SECTOR_TOURS = [
  {
    id: "produccion",
    email: "produccion@laboratoriogenus.com.ar",
    password: "produccion123",
    nav: [
      "Panel general",
      "Asignar trabajos",
      "Entregados",
      "Elaboración",
      "Envasado Masivo",
      "Envasado Premium",
      "Calidad",
      "Materias Primas",
      "Órdenes de Elaboración",
      "Órdenes de Acondicionamiento",
      "Remitos",
      "Asignación de lotes",
      "Procedimientos",
      "Métricas",
      "Historial",
    ],
  },
  {
    id: "calidad",
    email: "calidad@laboratoriogenus.com.ar",
    password: "calidad123",
    nav: ["Pendientes", "Aprobados", "Rechazados", "Asignación de lotes", "Procedimientos"],
  },
  {
    id: "elaboracion",
    email: "elaboracion@laboratoriogenus.com.ar",
    password: "elaboracion123",
    nav: ["Mi trabajo"],
  },
  {
    id: "masivo",
    email: "emasivo@laboratoriogenus.com.ar",
    password: "emasivo123",
    nav: ["Mi trabajo"],
  },
  {
    id: "premium",
    email: "epremium@laboratoriogenus.com.ar",
    password: "epremium123",
    nav: ["Mi trabajo"],
  },
  {
    id: "mp",
    email: "mp@laboratoriogenus.com.ar",
    password: "mp123",
    nav: ["Control semanal", "Ingresos MP", "Compras MP", "Stock"],
    tabs: ["COA'S"],
  },
  {
    id: "deposito",
    email: "deposito@laboratoriogenus.com.ar",
    password: "deposito123",
    nav: ["Ingresos ME", "Salidas ME", "Inventario ME", "Avisos ME"],
  },
  {
    id: "codificado",
    email: "codificado@laboratoriogenus.com.ar",
    password: "codificado123",
    nav: ["Mi trabajo"],
  },
];

async function measure(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const body = document.body;
    const main = document.querySelector("main");
    const tables = [...document.querySelectorAll("table")];
    const overflowEls = [];
    const all = [...document.querySelectorAll("body *")];
    for (const el of all.slice(0, 2500)) {
      const st = getComputedStyle(el);
      if (st.display === "none" || st.visibility === "hidden") continue;
      if (st.position === "fixed" || st.position === "sticky") continue;
      if (el.closest("[data-radix-portal], [role='dialog'], .os-right-rail")) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      // true page overflow: past document client width inside main/content
      if (r.right > window.innerWidth + 2) {
        const tag = el.tagName.toLowerCase();
        // SVG paths / icon glyphs clipping 1–12px past edge are not content overflow
        if (tag === "svg" || tag === "path" || tag === "circle" || tag === "line") continue;
        const cls = (el.className && String(el.className).slice?.(0, 80)) || "";
        overflowEls.push({
          tag,
          cls,
          left: Math.round(r.left),
          right: Math.round(r.right),
          text: (el.textContent || "").trim().slice(0, 40),
        });
        if (overflowEls.length >= 8) break;
      }
    }
    // clipped text heuristic — ignore sr-only / visually-hidden / skip links / near-zero boxes
    const clipped = [];
    for (const el of all.slice(0, 1500)) {
      if (el.scrollWidth > el.clientWidth + 2) {
        const st = getComputedStyle(el);
        if (!(st.overflowX === "hidden" || st.overflowX === "clip")) continue;
        if (el.clientWidth < 8) continue; // sr-only / clipped offscreen
        const cls = String(el.className || "");
        if (/sr-only|visually-hidden|skip|clip|truncate/.test(cls)) continue;
        if (/Saltar al/.test(el.textContent || "")) continue;
        const important = el.matches(
          "button, a, [data-testid*='lifecycle-row'], [data-testid='lifecycle-row-open'], [data-testid='lifecycle-row-delete']"
        );
        // No marcar celdas truncadas de table-fixed: el contenido vive en “Más datos” / title.
        if (important) {
          clipped.push({
            tag: el.tagName.toLowerCase(),
            testid: el.getAttribute("data-testid"),
            text: (el.textContent || "").trim().slice(0, 40),
            scrollW: el.scrollWidth,
            clientW: el.clientWidth,
          });
          if (clipped.length >= 6) break;
        }
      }
    }
    const openBtns = document.querySelectorAll(
      '[data-testid="lifecycle-row-open"], [data-testid="lifecycle-row-open-icon"]'
    ).length;
    const delBtns = document.querySelectorAll(
      '[data-testid="lifecycle-row-delete"], [data-testid="lifecycle-row-delete-icon"]'
    ).length;
    const moreBtns = document.querySelectorAll(
      '[data-testid^="os-table-more-"]'
    ).length;
    return {
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      bodyScrollWidth: body.scrollWidth,
      mainScrollWidth: main ? main.scrollWidth : null,
      mainClientWidth: main ? main.clientWidth : null,
      tableCount: tables.length,
      tableOverflow: tables.filter((t) => {
        const wrap = t.closest(".os-table-wrap");
        if (wrap && wrap.scrollWidth > wrap.clientWidth + 2) return true;
        const r = t.getBoundingClientRect();
        return r.right > window.innerWidth + 2;
      }).length,
      overflowEls,
      clipped,
      openBtns,
      delBtns,
      moreBtns,
      innerWidth: window.innerWidth,
    };
  });
}

async function login(page, email, password) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.fill("#os-sign-in-email", email);
  await page.fill("#os-sign-in-password", password);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1500);
  // wait until not login
  await page.waitForFunction(
    () => !location.pathname.includes("/login"),
    null,
    { timeout: 60_000 }
  ).catch(() => {});
  await page.waitForTimeout(800);
}

async function clickNav(page, label) {
  const navVisible = page.getByRole("navigation", { name: "Menú" });
  let btn = navVisible.getByRole("button", { name: label, exact: true });
  if ((await btn.count()) === 0 || !(await btn.first().isVisible().catch(() => false))) {
    const openMenu = page.getByRole("button", { name: "Abrir menú" });
    if (await openMenu.count()) {
      await openMenu.click();
      await page.waitForTimeout(450);
    }
    btn = page.getByRole("navigation", { name: "Menú" }).getByRole("button", { name: label, exact: true });
  }
  if ((await btn.count()) === 0) {
    btn = page.getByRole("button", { name: label, exact: true });
  }
  if ((await btn.count()) === 0) return false;
  await btn.first().click();
  await page.waitForTimeout(900);
  const close = page.getByRole("button", { name: "Cerrar menú" });
  if (await close.count()) {
    await close.click().catch(() => {});
    await page.waitForTimeout(200);
  }
  return true;
}

async function shot(page, name) {
  const file = path.join(outDir, "shots", `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

const matrix = [];
const issues = [];

async function checkView(page, meta) {
  const m = await measure(page);
  const docOk = m.scrollWidth <= m.clientWidth + 1;
  const mainOk =
    m.mainScrollWidth == null || m.mainScrollWidth <= m.mainClientWidth + 1;
  const tableOk = m.tableOverflow === 0;
  const noOverflowEls = m.overflowEls.filter((e) => e.right > m.innerWidth + 8).length === 0;
  const noClippedActions = m.clipped.length === 0;
  const pass = docOk && mainOk && tableOk && noOverflowEls && noClippedActions;
  const row = {
    ...meta,
    pass,
    docOk,
    mainOk,
    tableOk,
    scrollWidth: m.scrollWidth,
    clientWidth: m.clientWidth,
    tableOverflow: m.tableOverflow,
    overflowEls: m.overflowEls,
    clipped: m.clipped,
    openBtns: m.openBtns,
    delBtns: m.delBtns,
    moreBtns: m.moreBtns,
  };
  matrix.push(row);
  const tag = pass ? "PASS" : "FAIL";
  console.log(
    tag,
    meta.viewport,
    meta.sector,
    meta.view,
    `doc ${m.scrollWidth}/${m.clientWidth}`,
    `tblOverflow=${m.tableOverflow}`,
    `els=${m.overflowEls.length}`,
    `clip=${m.clipped.length}`
  );
  if (!pass) issues.push(row);
  return row;
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const report = {
    base: BASE,
    startedAt: new Date().toISOString(),
    viewports: VIEWPORTS.map((v) => v.name),
    matrix: [],
    issues: [],
    creamy: null,
    modal: null,
  };

  try {
    // Login page all viewports
    for (const vp of VIEWPORTS) {
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        extraHTTPHeaders: {
          "x-vercel-protection-bypass": BYPASS,
          "x-vercel-set-bypass-cookie": "true",
        },
      });
      const page = await context.newPage();
      await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 120_000 });
      await checkView(page, {
        viewport: vp.name,
        sector: "public",
        view: "login",
      });
      if (vp.name === "1440x900") await shot(page, "login-1440");
      await context.close();
    }

    // Full tours at 1440 + stress at 1366 and 390 for produccion
    const primaryVps = [
      VIEWPORTS.find((v) => v.name === "1440x900"),
      VIEWPORTS.find((v) => v.name === "1366x768"),
      VIEWPORTS.find((v) => v.name === "390x844"),
      VIEWPORTS.find((v) => v.name === "1920x1080"),
      VIEWPORTS.find((v) => v.name === "1024x768"),
    ];

    for (const vp of primaryVps) {
      for (const tour of SECTOR_TOURS) {
        // skip heavy multi-sector on every viewport except 1440 and 390
        if (
          vp.name !== "1440x900" &&
          vp.name !== "390x844" &&
          tour.id !== "produccion"
        ) {
          continue;
        }
        const context = await browser.newContext({
          viewport: { width: vp.width, height: vp.height },
          extraHTTPHeaders: {
            "x-vercel-protection-bypass": BYPASS,
            "x-vercel-set-bypass-cookie": "true",
          },
        });
        const page = await context.newPage();
        try {
          await login(page, tour.email, tour.password);
          await checkView(page, {
            viewport: vp.name,
            sector: tour.id,
            view: "home",
          });
          if (vp.name === "1440x900" && tour.id === "produccion") {
            await shot(page, "produccion-home-1440");
          }

          for (const label of tour.nav) {
            const ok = await clickNav(page, label);
            if (!ok) {
              matrix.push({
                viewport: vp.name,
                sector: tour.id,
                view: label,
                pass: false,
                skipped: true,
                reason: "nav_not_found",
              });
              console.log("SKIP", vp.name, tour.id, label, "nav_not_found");
              continue;
            }
            const safe = label.replace(/\s+/g, "_").toLowerCase();
            await checkView(page, {
              viewport: vp.name,
              sector: tour.id,
              view: label,
            });
            if (vp.name === "1440x900" && tour.id === "produccion") {
              await shot(page, `prod-${safe}-1440`);
            }
            if (vp.name === "390x844" && tour.id === "produccion" && label === "Órdenes de Elaboración") {
              // expand Más datos if present
              const more = page.locator('[data-testid^="os-table-more-"]').first();
              if (await more.count()) {
                await more.click();
                await page.waitForTimeout(300);
                await shot(page, "oe-more-datos-390");
                await checkView(page, {
                  viewport: vp.name,
                  sector: tour.id,
                  view: `${label} + Más datos`,
                });
              }
            }
          }

          // In-hub tabs (e.g. COA'S inside MP)
          if (Array.isArray(tour.tabs)) {
            for (const tabLabel of tour.tabs) {
              const tabBtn = page.getByRole("button", { name: tabLabel, exact: true });
              if ((await tabBtn.count()) === 0) {
                matrix.push({
                  viewport: vp.name,
                  sector: tour.id,
                  view: tabLabel,
                  pass: false,
                  skipped: true,
                  reason: "tab_not_found",
                });
                console.log("SKIP", vp.name, tour.id, tabLabel, "tab_not_found");
                continue;
              }
              await tabBtn.first().click();
              await page.waitForTimeout(800);
              await checkView(page, {
                viewport: vp.name,
                sector: tour.id,
                view: tabLabel,
              });
              if (vp.name === "1440x900") {
                await shot(page, `${tour.id}-${tabLabel.replace(/\W+/g, "_").toLowerCase()}-1440`);
              }
            }
          }

          // Creamy + modal on produccion 1440
          if (tour.id === "produccion" && vp.name === "1440x900") {
            const creamyBtn = page.getByRole("button", { name: "Hablar con Creamy" });
            if (await creamyBtn.count()) {
              await creamyBtn.click();
              await page.waitForTimeout(700);
              report.creamy = await checkView(page, {
                viewport: vp.name,
                sector: tour.id,
                view: "Creamy abierto",
              });
              await shot(page, "creamy-1440");
              const close = page.getByRole("button", { name: "Cerrar Creamy" });
              if (await close.count()) await close.click();
            }
            // open a dialog via Borrar if available
            const del = page.locator('[data-testid="lifecycle-row-delete"]').first();
            if (await del.count()) {
              await del.click();
              await page.waitForTimeout(400);
              report.modal = await checkView(page, {
                viewport: vp.name,
                sector: tour.id,
                view: "Modal Borrar",
              });
              await shot(page, "modal-borrar-1440");
              const cancel = page.getByRole("button", { name: "Cancelar" });
              if (await cancel.count()) await cancel.click();
            }
          }
        } catch (e) {
          console.error("TOUR_FAIL", tour.id, vp.name, e?.message || e);
          issues.push({
            viewport: vp.name,
            sector: tour.id,
            view: "tour",
            pass: false,
            error: String(e?.message || e),
          });
        } finally {
          await context.close();
        }
      }
    }
  } finally {
    await browser.close();
  }

  report.matrix = matrix;
  report.issues = issues;
  report.finishedAt = new Date().toISOString();
  report.summary = {
    total: matrix.length,
    pass: matrix.filter((r) => r.pass).length,
    fail: matrix.filter((r) => r.pass === false && !r.skipped).length,
    skip: matrix.filter((r) => r.skipped).length,
  };
  fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 2));

  // markdown table
  const lines = [
    "# HScroll audit",
    "",
    `| Viewport | Sector | Vista | Pass | scrollW/clientW | overflowEls | clipped |`,
    `|---|---|---|---|---|---|---|`,
  ];
  for (const r of matrix) {
    lines.push(
      `| ${r.viewport} | ${r.sector} | ${r.view} | ${r.skipped ? "SKIP" : r.pass ? "PASS" : "FAIL"} | ${r.scrollWidth ?? ""}/${r.clientWidth ?? ""} | ${r.overflowEls?.length ?? ""} | ${r.clipped?.length ?? ""} |`
    );
  }
  fs.writeFileSync(path.join(outDir, "matrix.md"), lines.join("\n"));
  console.log(JSON.stringify(report.summary, null, 2));
  console.log("report", path.join(outDir, "report.json"));
  process.exit(report.summary.fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
