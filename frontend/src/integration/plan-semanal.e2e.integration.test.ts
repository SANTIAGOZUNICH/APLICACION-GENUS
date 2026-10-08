/**
 * E2E REAL de Producción → Plan semanal (detalle del día como planilla editable por celda).
 *
 * Navegador real (Playwright/Chromium) contra la app levantada con `next start` y una base Postgres de PRUEBA
 * con las migraciones reales. Se SALTA solo si el entorno no es apto (ver scripts/e2e/e2e-safety.mjs):
 * nunca corre en Vercel/producción, exige base local marcada y app local.
 *
 * Forma recomendada de correrlo (levanta todo y limpia al final): `npm run test:e2e:plan-semanal`.
 * Detalle y variables: scripts/e2e/README.md.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser, BrowserContext, Locator, Page } from "playwright";
import { assertMarkedDatabase, e2eEnvironmentProblem } from "../../scripts/e2e/e2e-safety.mjs";
import { E2E_PASSWORD, E2E_USERS } from "../../scripts/e2e/e2e-fixtures.mjs";

const PROBLEM = e2eEnvironmentProblem() ?? (process.env.GENUS_E2E_BASE_URL ? null : "falta GENUS_E2E_BASE_URL");
const BASE_URL = process.env.GENUS_E2E_BASE_URL ?? "http://localhost:3100";
const GRID = "plan-semanal-detalle-grid";
// Columnas de la planilla de Plan semanal (índice 0 = numeración de fila).
const COL = { linea: 1, fecha: 2, entrega: 3, cliente: 4, producto: 5, cantidad: 6, unidad: 7, estado: 8, obs: 9 } as const;
const CLIENT = { editable: "E2E-NIZA", protegido: "E2E-BLOQUEADO", pasado: "E2E-PASADO" } as const;
const STEP_TIMEOUT = 60_000;

// ── Fechas: siempre lun–vie, válidas cualquier día que se corra ──
const pad = (n: number) => String(n).padStart(2, "0");
const isoLocal = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, 10, 0, 0);
const mondayOf = (d: Date) => addDays(d, -((d.getDay() + 6) % 7));
const now = new Date();
/** Día bajo prueba: hoy si es hábil, si no el lunes siguiente (nunca en el pasado → no exige motivo). */
const DAY = now.getDay() === 0 ? addDays(now, 1) : now.getDay() === 6 ? addDays(now, 2) : addDays(now, 0);
/** Trabajo histórico: mismo día de la semana anterior (siempre pasado y hábil → exige motivo). */
const PAST = addDays(DAY, -7);
const RUN_ID = `${Date.now().toString(36)}`;
const REASON = `Ajuste E2E ${RUN_ID} de observación histórica`;

describe.skipIf(Boolean(PROBLEM))(`E2E Plan semanal (planilla editable)${PROBLEM ? ` — saltado: ${PROBLEM}` : ""}`, () => {
  let pool: import("@neondatabase/serverless").Pool;
  let browser: Browser;
  let ctx: BrowserContext;
  let page: Page;
  const q = async (text: string, params: unknown[] = []) => (await pool.query(text, params)).rows as Record<string, unknown>[];
  const item = async (client: string) =>
    (await q("select id, planned_quantity, unit, notes, client, version from work_items where client = $1 and deleted_at is null", [client]))[0]!;

  // ── Helpers de la planilla ──
  const grid = () => page.locator(`[data-testid="${GRID}"]`);
  const notice = async () => (await page.locator(`[data-testid="${GRID}-notice"]`).allInnerTexts()).join(" ");
  const cellText = async (cell: Locator) => {
    const input = cell.locator("input");
    return (await input.count()) ? (await input.first().inputValue()).trim() : (await cell.innerText()).trim();
  };
  async function rowOf(client: string): Promise<Locator> {
    const rows = grid().locator(".dsg-row:not(.dsg-row-header)");
    const n = await rows.count();
    for (let i = 0; i < n; i += 1) {
      if ((await cellText(rows.nth(i).locator(".dsg-cell").nth(COL.cliente))) === client) return rows.nth(i);
    }
    throw new Error(`fila ${client} no encontrada en la planilla`);
  }
  const cell = async (client: string, col: keyof typeof COL) => (await rowOf(client)).locator(".dsg-cell").nth(COL[col]);
  async function saveState() {
    await page
      .waitForFunction(
        (id) => ["saved", "error"].includes(document.querySelector(`[data-testid="${id}-status"]`)?.getAttribute("data-state") ?? ""),
        `${GRID}`,
        { timeout: 15_000 }
      )
      .catch(() => undefined);
    return page.locator(`[data-testid="${GRID}-status"]`).getAttribute("data-state");
  }

  async function openPlanSemanal(email: string): Promise<{ ctx: BrowserContext; page: Page }> {
    // Viewport ancho: la grilla virtualiza columnas y así todas quedan renderizadas.
    const c = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 2200, height: 1100 } });
    await c.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE_URL });
    const p = await c.newPage();
    await p.clock.setFixedTime(DAY);
    await p.goto("/login");
    await p.locator('input[type="email"]').fill(email);
    await p.locator('input[type="password"]').fill(E2E_PASSWORD);
    await p.locator('button[type="submit"]').click();
    await p.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 });
    await p.goto("/plan-semanal");
    await p.locator(`[data-testid="${GRID}"] .dsg-row`).nth(1).waitFor({ timeout: 30_000 });
    return { ctx: c, page: p };
  }

  /** Datos de prueba frescos: los de corridas anteriores se dan de baja (soft delete) y se crean nuevos por la API. */
  async function seedFixtures() {
    await q("update work_items set deleted_at = now() where client like 'E2E-%' and deleted_at is null");
    // Una semana publicada no acepta trabajos nuevos: en esta base DE PRUEBA (marca verificada) se reabren las dos
    // semanas que usa el test para poder re-ejecutarlo cualquier cantidad de veces.
    await q("update planning_weeks set status = 'DRAFT', published_at = null, version = version + 1 where week_start = any($1::date[])", [
      [isoLocal(mondayOf(DAY)), isoLocal(mondayOf(PAST))],
    ]);
    const { request } = await import("playwright");
    const api = await request.newContext({ baseURL: BASE_URL });
    const login = await api.post("/api/v1/auth/login", { data: { email: E2E_USERS.produccion.email, password: E2E_PASSWORD } });
    expect(login.status(), await login.text()).toBe(200);
    const weekIds = new Map<string, string>();
    async function weekFor(day: Date) {
      const weekStart = isoLocal(mondayOf(day));
      if (weekIds.has(weekStart)) return weekIds.get(weekStart)!;
      const list = (await (await api.get(`/api/v1/planning/weeks?weekStart=${weekStart}`)).json()) as { weeks?: { id: string }[] };
      let id = list.weeks?.[0]?.id;
      if (!id) {
        const res = await api.post("/api/v1/planning/weeks", { data: { weekStart, label: "E2E" } });
        expect(res.status(), await res.text()).toBe(201);
        id = ((await res.json()) as { week: { id: string } }).week.id;
      }
      weekIds.set(weekStart, id);
      return id;
    }
    const create = async (day: Date, client: string, product: string, qty: string, line: string) => {
      const res = await api.post(`/api/v1/planning/weeks/${await weekFor(day)}/items`, {
        data: { plannedDate: isoLocal(day), client, product, plannedQuantity: qty, unit: "u", sector: "ENVASADO_MASIVO", line },
      });
      expect(res.status(), await res.text()).toBe(201);
    };
    await create(DAY, CLIENT.editable, "SERUM E2E", "100", "Línea 1");
    await create(DAY, CLIENT.protegido, "PROTEGIDO E2E", "10", "Línea 2");
    await create(PAST, CLIENT.pasado, "HISTORICO E2E", "20", "Línea 1");
    for (const id of weekIds.values()) {
      const res = await api.post(`/api/v1/planning/weeks/${id}/publish`, { data: {} });
      expect([200, 201, 409], await res.text()).toContain(res.status());
    }
    // Estado operativo real que debe proteger el trabajo: decisión de Calidad registrada.
    await q(
      "update work_items set quality_status = 'aprobado', quality_decided_at = now(), quality_decided_by = 'e2e-calidad@genus.test', quality_decided_by_sector = 'CALIDAD' where client = $1 and deleted_at is null",
      [CLIENT.protegido]
    );
    await api.dispose();
  }

  beforeAll(async () => {
    const { Pool, neonConfig } = await import("@neondatabase/serverless");
    neonConfig.webSocketConstructor = (await import("ws")).default;
    pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
    await assertMarkedDatabase(q);
    await seedFixtures();
    const { chromium } = await import("playwright");
    browser = await chromium.launch({ executablePath: process.env.GENUS_E2E_CHROMIUM_PATH || undefined });
    ({ ctx, page } = await openPlanSemanal(E2E_USERS.produccion.email));
  }, 180_000);

  afterAll(async () => {
    await ctx?.close();
    await browser?.close();
    await pool?.end();
  });

  it("1. la planilla se muestra en el detalle del día", async () => {
    expect(await grid().count()).toBe(1);
  });

  it("2. edición por celda: Cantidad 100 → 250 se guarda y sube la versión", async () => {
    const before = await item(CLIENT.editable);
    await (await cell(CLIENT.editable, "cantidad")).click();
    await page.keyboard.type("250");
    await page.keyboard.press("Enter");
    expect(await saveState()).toBe("saved");
    const after = await item(CLIENT.editable);
    expect(after.planned_quantity).toBe("250");
    expect(Number(after.version)).toBe(Number(before.version) + 1);
  }, STEP_TIMEOUT);

  it("3. persistencia: tras recargar la página la celda muestra 250", async () => {
    await page.reload();
    await grid().locator(".dsg-row").nth(1).waitFor();
    expect(await cellText(await cell(CLIENT.editable, "cantidad"))).toBe("250");
  }, STEP_TIMEOUT);

  it("4. copiar: el rango Cliente..Cantidad llega al portapapeles como TSV", async () => {
    await page.evaluate(() => navigator.clipboard.writeText(""));
    const row = await rowOf(CLIENT.editable);
    await row.locator(".dsg-cell").nth(COL.cliente).click();
    await row.locator(".dsg-cell").nth(COL.cantidad).click({ modifiers: ["Shift"] });
    await page.keyboard.press("Control+c");
    await page.waitForTimeout(300);
    expect((await page.evaluate(() => navigator.clipboard.readText())).trim()).toBe(`${CLIENT.editable}\tSERUM E2E\t250`);
    await page.keyboard.press("Escape");
  }, STEP_TIMEOUT);

  it("5. pegar 2 celdas (Cantidad=300, Unidad=kg) guarda ambas", async () => {
    await page.evaluate(() => navigator.clipboard.writeText("300\tkg"));
    await (await cell(CLIENT.editable, "cantidad")).click();
    await page.keyboard.press("Control+v");
    expect(await saveState()).toBe("saved");
    const d = await item(CLIENT.editable);
    expect([d.planned_quantity, d.unit]).toEqual(["300", "kg"]);
  }, STEP_TIMEOUT);

  it("6. pegar en Observación guarda el texto", async () => {
    await page.evaluate(() => navigator.clipboard.writeText("Obs pegada E2E"));
    await (await cell(CLIENT.editable, "obs")).click();
    await page.keyboard.press("Control+v");
    expect(await saveState()).toBe("saved");
    expect((await item(CLIENT.editable)).notes).toBe("Obs pegada E2E");
  }, STEP_TIMEOUT);

  it("7. protegida: el trabajo con decisión de Calidad muestra candados en todas sus celdas", async () => {
    expect(await (await rowOf(CLIENT.protegido)).locator(".genus-cell-lock").count()).toBeGreaterThanOrEqual(9);
  }, STEP_TIMEOUT);

  it("8. protegida: escribir sobre la celda no modifica la base y avisa el motivo", async () => {
    const before = await item(CLIENT.protegido);
    await (await cell(CLIENT.protegido, "cantidad")).click();
    await page.keyboard.type("999");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(800);
    expect(await item(CLIENT.protegido)).toEqual(before);
    expect(await notice()).toMatch(/Decisión de Calidad registrada/);
  }, STEP_TIMEOUT);

  it("9. protegida: pegar muestra el diálogo «Celdas protegidas — NO se modifican»", async () => {
    await page.evaluate(() => navigator.clipboard.writeText("HACKEADO"));
    await (await cell(CLIENT.protegido, "cliente")).click();
    await page.keyboard.press("Control+v");
    const dialog = page.locator(`[data-testid="${GRID}-preview"]`);
    await dialog.waitFor({ timeout: 5_000 });
    expect(await dialog.innerText()).toMatch(/NO se modifican/);
    await dialog.getByRole("button", { name: "Entendido" }).click();
  }, STEP_TIMEOUT);

  it("10. protegida: después de pegar la base sigue intacta", async () => {
    const d = await item(CLIENT.protegido);
    expect([d.client, d.planned_quantity]).toEqual([CLIENT.protegido, "10"]);
  }, STEP_TIMEOUT);

  it("11. la columna Línea es de solo lectura", async () => {
    expect(await (await cell(CLIENT.editable, "linea")).locator(".genus-cell-lock").count()).toBe(1);
  }, STEP_TIMEOUT);

  it("12. servidor: PATCH directo a una celda protegida → 403 PROTECTED", async () => {
    const before = await item(CLIENT.protegido);
    const res = await page.request.patch("/api/v1/work-items/cells", {
      data: { changes: [{ id: `native:${before.id}`, field: "client", value: "X", expectedVersion: Number(before.version) }] },
    });
    expect(res.status()).toBe(403);
    expect(await res.text()).toMatch(/PROTECTED/);
    expect(await item(CLIENT.protegido)).toEqual(before);
  }, STEP_TIMEOUT);

  it("13. servidor: versión vieja → CONFLICT y no escribe", async () => {
    const before = await item(CLIENT.editable);
    const res = await page.request.patch("/api/v1/work-items/cells", {
      data: { changes: [{ id: `native:${before.id}`, field: "notes", value: "viejo", expectedVersion: Number(before.version) - 1 }] },
    });
    expect(await res.text()).toMatch(/CONFLICT/);
    expect((await item(CLIENT.editable)).notes).toBe("Obs pegada E2E");
  }, STEP_TIMEOUT);

  it("14. fecha pasada: pide motivo y no deja aplicar sin él", async () => {
    for (let i = 0; i < 7; i += 1) await page.locator("button", { hasText: "Ayer" }).click();
    await (await cell(CLIENT.pasado, "obs")).click();
    await page.keyboard.type("corrección histórica");
    await page.keyboard.press("Enter");
    await page.locator(`[data-testid="${GRID}-preview"]`).waitFor({ timeout: 5_000 });
    expect(await page.locator(`[data-testid="${GRID}-reason"]`).count()).toBe(1);
    expect(await page.locator(`[data-testid="${GRID}-preview-apply"]`).isDisabled()).toBe(true);
  }, STEP_TIMEOUT);

  it("15. fecha pasada: con motivo se guarda y el motivo queda auditado", async () => {
    await page.locator(`[data-testid="${GRID}-reason"]`).fill(REASON);
    await page.locator(`[data-testid="${GRID}-preview-apply"]`).click();
    expect(await saveState()).toBe("saved");
    expect((await item(CLIENT.pasado)).notes).toBe("corrección histórica");
    const audit = await q("select count(*)::int as n from operational_events where note like $1", [`%${REASON}%`]);
    expect(Number(audit[0]!.n)).toBeGreaterThanOrEqual(1);
  }, STEP_TIMEOUT);

  it("16. otro sector (Envasado): todo bloqueado y sin escritura", async () => {
    const env = await openPlanSemanal(E2E_USERS.envasado.email);
    const previous = page;
    page = env.page;
    try {
      const before = await item(CLIENT.editable);
      const row = await rowOf(CLIENT.editable);
      expect(await row.locator(".genus-cell-lock").count()).toBeGreaterThanOrEqual(9);
      await row.locator(".dsg-cell").nth(COL.obs).click();
      await page.keyboard.type("no permitido");
      await page.keyboard.press("Enter");
      await page.waitForTimeout(800);
      expect(await item(CLIENT.editable)).toEqual(before);
    } finally {
      page = previous;
      await env.ctx.close();
    }
  }, STEP_TIMEOUT);
});
