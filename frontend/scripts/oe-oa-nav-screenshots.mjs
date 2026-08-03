import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = process.env.SHOT_DIR ?? "/opt/cursor/artifacts/oe-oa-nav-screenshots";

const USERS = {
  produccion: {
    email: "produccion@laboratoriogenus.com.ar",
    sector: "PRODUCCION",
    displayName: "Producción",
    role: "ROL-SU",
    roleLabel: "Supervisora",
    sectorLabel: "Producción",
    jobTitle: "Supervisora de Producción",
  },
  calidad: {
    email: "calidad@laboratoriogenus.com.ar",
    sector: "CALIDAD",
    displayName: "Calidad",
    role: "ROL-CA",
    roleLabel: "Calidad",
    sectorLabel: "Calidad",
    jobTitle: "Responsable de Calidad",
  },
  elaboracion: {
    email: "elaboracion@laboratoriogenus.com.ar",
    sector: "ELABORACION",
    displayName: "Elaboración",
    role: "ROL-EL",
    roleLabel: "Sector",
    sectorLabel: "Elaboración",
    jobTitle: "Encargado Elaboración",
  },
  emasivo: {
    email: "emasivo@laboratoriogenus.com.ar",
    sector: "ENVASADO_MASIVO",
    displayName: "Envasado Masivo",
    role: "ROL-OP",
    roleLabel: "Operario",
    sectorLabel: "Envasado Masivo",
    jobTitle: "Responsable Envasado Masivo",
  },
  epremium: {
    email: "epremium@laboratoriogenus.com.ar",
    sector: "ENVASADO_PREMIUM",
    displayName: "Envasado Premium",
    role: "ROL-OP",
    roleLabel: "Operario",
    sectorLabel: "Envasado Premium",
    jobTitle: "Responsable Envasado Premium",
  },
};

function sessionFor(user) {
  return {
    status: "preview",
    mode: "preview",
    user: {
      email: user.email,
      displayName: user.displayName,
      jobTitle: user.jobTitle,
      company: "Laboratorio Genus",
    },
    sector: { id: user.sector, label: user.sectorLabel },
    role: { id: user.role, label: user.roleLabel },
    rememberMe: true,
    redirectTo: "/mi-trabajo",
    createdAt: new Date().toISOString(),
  };
}

async function enterAs(page, userKey) {
  const user = USERS[userKey];
  const session = sessionFor(user);
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.evaluate((s) => {
    localStorage.setItem("genus_os_auth_session", JSON.stringify(s));
    sessionStorage.setItem("genus_os_auth_session", JSON.stringify(s));
  }, session);
  await page.goto(`${BASE}/mi-trabajo`, { waitUntil: "networkidle" });
  await page.waitForSelector("nav[aria-label='Menú']", { timeout: 30000 });
  // Confirm sector label visible
  await page.getByText(user.sectorLabel, { exact: false }).first().waitFor({ timeout: 10000 });
  await page.waitForTimeout(500);
  console.log("entered", userKey, page.url());
}

async function openSidebarItem(page, label) {
  const btn = page.locator("nav[aria-label='Menú'] button", { hasText: label });
  console.log("clicking sidebar", label, "count=", await btn.count());
  await btn.first().click({ timeout: 10000 });
  await page.waitForTimeout(1500);
}

async function shot(page, name) {
  const path = join(OUT, `${name}.png`);
  await page.screenshot({ path, fullPage: false });
  console.log("wrote", path);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  await enterAs(page, "produccion");
  const menuItems = await page.locator("nav[aria-label='Menú'] button").allTextContents();
  console.log("PRODUCCION menu:", menuItems);
  if (!menuItems.some((t) => t.includes("Órdenes de Elaboración"))) {
    throw new Error("PRODUCCION missing OE in menu");
  }
  if (!menuItems.some((t) => t.includes("Órdenes de Acondicionamiento"))) {
    throw new Error("PRODUCCION missing OA in menu");
  }
  await shot(page, "01-produccion-menu-oe-oa");
  await openSidebarItem(page, "Órdenes de Elaboración");
  if ((await page.getByText("Crear Orden de Elaboración").count()) < 1) {
    throw new Error("PRODUCCION missing Crear OE");
  }
  await shot(page, "02-produccion-crear-oe");
  await openSidebarItem(page, "Órdenes de Acondicionamiento");
  if ((await page.getByText("Crear Orden de Acondicionamiento").count()) < 1) {
    throw new Error("PRODUCCION missing Crear OA");
  }
  await shot(page, "03-produccion-crear-oa");

  await enterAs(page, "calidad");
  const calidadMenu = await page.locator("nav[aria-label='Menú'] button").allTextContents();
  console.log("CALIDAD menu:", calidadMenu);
  if (!calidadMenu.some((t) => t.includes("Órdenes de Elaboración"))) {
    throw new Error("CALIDAD missing OE in menu");
  }
  if (!calidadMenu.some((t) => t.includes("Órdenes de Acondicionamiento"))) {
    throw new Error("CALIDAD missing OA in menu");
  }
  await shot(page, "04-calidad-menu-oe-oa");
  await openSidebarItem(page, "Órdenes de Elaboración");
  if ((await page.getByText("Crear Orden de Elaboración").count()) < 1) {
    throw new Error("CALIDAD missing Crear OE");
  }
  await shot(page, "05-calidad-crear-oe");
  await openSidebarItem(page, "Órdenes de Acondicionamiento");
  if ((await page.getByText("Crear Orden de Acondicionamiento").count()) < 1) {
    throw new Error("CALIDAD missing Crear OA");
  }
  await shot(page, "06-calidad-crear-oa");

  await enterAs(page, "elaboracion");
  await openSidebarItem(page, "Órdenes de Elaboración");
  if ((await page.getByText("Crear Orden de Elaboración").count()) !== 0) {
    throw new Error("ELABORACION should not see Crear OE");
  }
  await shot(page, "07-elaboracion-oe-sin-crear");

  await enterAs(page, "emasivo");
  await openSidebarItem(page, "Órdenes de Acondicionamiento");
  if ((await page.getByText("Crear Orden de Acondicionamiento").count()) !== 0) {
    throw new Error("EMASIVO should not see Crear OA");
  }
  await shot(page, "08-emasivo-oa-sin-crear");

  await enterAs(page, "epremium");
  await openSidebarItem(page, "Órdenes de Acondicionamiento");
  if ((await page.getByText("Crear Orden de Acondicionamiento").count()) !== 0) {
    throw new Error("EPREMIUM should not see Crear OA");
  }
  await shot(page, "09-epremium-oa-sin-crear");

  await browser.close();
  console.log("ALL MANUAL CHECKS PASSED");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
