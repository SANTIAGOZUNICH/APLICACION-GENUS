/**
 * Control de Material de Envase (ME) por Depósito contra Postgres de PRUEBA real (migración 0083): estado inicial «Sin info», ✅ / ❌ con
 * observación, historial (quién, cuándo, estado anterior), permisos en el servidor, persistencia al reprogramar, mismo estado en todas las
 * proyecciones y NINGÚN movimiento de stock. Se corre con
 * `GENUS_E2E_VITEST_FILES=src/integration/me-control.db.integration.test.ts npm run test:e2e:semanas-priorities-db`.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { assertMarkedDatabase, e2eEnvironmentProblem } from "../../scripts/e2e/e2e-safety.mjs";

const PROBLEM = e2eEnvironmentProblem() ?? (process.env.GENUS_E2E_DATABASE_URL ? null : "falta GENUS_E2E_DATABASE_URL");
const RUN = Date.now().toString().slice(-6);
const CLIENT = `IT ME CLIENTE ${RUN}`;
const actor = (sector: string, n: string) => ({ email: `it-me-${n}@laboratoriogenus.com.ar`, sector, displayName: `IT ME ${n}` });
const prod = actor("PRODUCCION", "prod");
const dep = actor("DEPOSITO", "dep");

describe.skipIf(Boolean(PROBLEM))(`Control de ME en Postgres real${PROBLEM ? ` — saltado: ${PROBLEM}` : ""}`, () => {
  let pool: import("@neondatabase/serverless").Pool;
  const q = async (text: string, params: unknown[] = []) => (await pool.query(text, params)).rows as Record<string, unknown>[];

  beforeAll(async () => {
    process.env.VITEST = "false";
    (process.env as Record<string, string | undefined>).NODE_ENV = "development";
    delete process.env.GENUS_FEATURE_MEMORY;
    process.env.DATABASE_URL = process.env.GENUS_E2E_DATABASE_URL!;
    const { Pool, neonConfig } = await import("@neondatabase/serverless");
    neonConfig.webSocketConstructor = (await import("ws")).default as never;
    pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
    await assertMarkedDatabase(q);
    vi.resetModules();
  }, 60_000);
  afterAll(async () => {
    await pool?.end();
  });

  const newWork = async (sector: string, date = "2031-06-10") => {
    const { assignWorkItemDurable } = await import("@/lib/planning/work-assignment-service");
    const r = await assignWorkItemDurable(
      { sector, client: CLIENT, product: `Crema ME ${RUN}-${Math.random().toString(36).slice(2, 6)}`, plannedQuantity: sector === "ELABORACION" ? "60" : "1000", unit: sector === "ELABORACION" ? "kg" : "un.", plannedDate: date, ...(sector === "ELABORACION" ? { branchOwner: "Cristian" } : { line: "Línea 1" }), orderNumber: `${sector === "ELABORACION" ? "OE" : "OA"}-2026-${String(200000 + Math.floor(Math.random() * 99999)).padStart(6, "0")}`, idempotencyKey: randomUUID() } as never,
      prod,
      randomUUID()
    );
    return r.item.id as string;
  };
  const setMe = async (a: { email: string; sector: string; displayName: string }, id: string, status: "SIN_INFO" | "OK" | "NO_OK", observation?: string | null) => {
    const { setWorkItemMeStatus } = await import("@/lib/planning/me-control-service");
    return setWorkItemMeStatus(a as never, id, { status, observation });
  };
  const stockCount = async () => Number((await q("select (select count(*) from mp_stock_movements) + (select count(*) from inv_me_ingresos) + (select count(*) from inv_me_salidas) n"))[0]!.n);
  const planRow = async (id: string) => {
    const { getPlanningService } = await import("@/lib/planning/get-planning-service");
    const rows = await getPlanningService().listPublishedItems({ sector: "ENVASADO_MASIVO", from: "2031-01-01", to: "2031-12-31", limit: 500 } as never);
    return rows.find((r) => r.id === id) ?? null;
  };

  it("estado inicial «Sin info»; Depósito marca ✅, ❌ con observación y vuelve a Sin info; historial con quién, cuándo y estado anterior", { timeout: 60_000 }, async () => {
    const id = await newWork("ENVASADO_MASIVO");
    const { buildMeInfo } = await import("@/lib/me-status/me-status");
    expect(buildMeInfo((await planRow(id))!).status).toBe("SIN_INFO");
    const stock0 = await stockCount();
    const version0 = (await q("select version from work_items where id = $1", [id]))[0]!.version;
    expect((await setMe(dep, id, "OK")).me).toMatchObject({ status: "OK", observation: null, updatedBy: dep.displayName });
    const r2 = await setMe(dep, id, "NO_OK", "Faltan 300 pomos de 200 ml");
    expect(r2.me).toMatchObject({ status: "NO_OK", observation: "Faltan 300 pomos de 200 ml" });
    expect(r2.changed).toBe(true);
    expect((await setMe(dep, id, "NO_OK", "Faltan 300 pomos de 200 ml")).changed).toBe(false); // sin cambios: no se agrega historial
    await setMe(dep, id, "SIN_INFO", null); // retira la confirmación
    const { listMeHistory } = await import("@/lib/planning/me-control-service");
    const h = await listMeHistory(id);
    expect(h.map((x) => [x.from, x.to])).toEqual([["SIN_INFO", "OK"], ["OK", "NO_OK"], ["NO_OK", "SIN_INFO"]]);
    expect(h[1]).toMatchObject({ observation: "Faltan 300 pomos de 200 ml", actorName: dep.displayName, actorSector: "DEPOSITO" });
    expect(h.every((x) => Date.parse(x.at) > 0)).toBe(true);
    expect(await stockCount()).toBe(stock0); // informativo: sin movimientos de stock
    expect((await q("select version from work_items where id = $1", [id]))[0]!.version).toBe(version0); // no choca con ediciones de planificación
    expect((await planRow(id))!.meStatus ?? null).toBeNull();
  });

  it("solo Depósito (y Dirección) modifica: Producción, MP, Envasado, Elaboración, Codificado y Calidad reciben «prohibido» y no cambia nada", { timeout: 60_000 }, async () => {
    const id = await newWork("ENVASADO_PREMIUM");
    for (const s of ["PRODUCCION", "MATERIA_PRIMA", "ENVASADO_MASIVO", "ENVASADO_PREMIUM", "ELABORACION", "CODIFICADO", "CALIDAD", "ADMINISTRACION"]) {
      await expect(setMe(actor(s, s.toLowerCase()), id, "OK")).rejects.toThrow(/Solo Depósito/);
    }
    expect((await q("select me_status from work_items where id = $1", [id]))[0]!.me_status).toBeNull();
    expect((await setMe(actor("DIRECCION", "dir"), id, "OK")).me.status).toBe("OK");
    expect(Number((await q("select count(*)::int n from work_item_me_history where work_item_id = $1", [id]))[0]!.n)).toBe(1);
  });

  it("solo aplica a Envasado: un trabajo de Elaboración se rechaza", { timeout: 60_000 }, async () => {
    const id = await newWork("ELABORACION");
    await expect(setMe(dep, id, "OK")).rejects.toThrow(/Envasado/);
    expect((await q("select me_status from work_items where id = $1", [id]))[0]!.me_status).toBeNull();
  });

  it("se conserva al reprogramar (id estable) y es el mismo estado en la planificación compartida y en el trabajo proyectado", { timeout: 60_000 }, async () => {
    const id = await newWork("ENVASADO_MASIVO", "2031-06-10");
    await setMe(dep, id, "NO_OK", "Falta tapa");
    const { rescheduleWorkItemDurable } = await import("@/lib/planning/work-item-progress-repository");
    await rescheduleWorkItemDurable(id, { plannedDate: "2031-06-13", updatedBy: "Producción", updatedBySector: "PRODUCCION" } as never);
    const rec = (await planRow(id))!;
    expect(rec.plannedDate).toBe("2031-06-13");
    const { toWeeklyPlanItemDto } = await import("@/lib/planning/weekly-plan-dto");
    const { projectNativeWorkItems } = await import("@/lib/planning/native-projector");
    const dto = toWeeklyPlanItemDto(rec);
    const wi = projectNativeWorkItems([rec])[0]!;
    expect(dto.me).toMatchObject({ status: "NO_OK", observation: "Falta tapa" });
    expect(wi.me).toMatchObject({ status: "NO_OK", observation: "Falta tapa" });
    expect(dto.me).toEqual(wi.me); // exactamente el mismo estado en todas las pantallas
    // Un trabajo de Elaboración no lleva ME
    const e = await newWork("ELABORACION", "2031-06-13");
    const { getPlanningService } = await import("@/lib/planning/get-planning-service");
    const erec = (await getPlanningService().listPublishedItems({ sector: "ELABORACION", from: "2031-01-01", to: "2031-12-31", limit: 500 } as never)).find((r) => r.id === e)!;
    expect(toWeeklyPlanItemDto(erec).me).toBeNull();
  });
});
