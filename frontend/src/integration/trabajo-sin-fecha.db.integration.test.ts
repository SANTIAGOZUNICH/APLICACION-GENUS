/**
 * Fecha OPCIONAL al asignar trabajos (Producción) contra un Postgres de PRUEBA real (migración 0072 aplicada).
 *  - se asigna sin fecha en Elaboración / Envasado Masivo / Premium: queda con planned_date y planning_week_id NULL
 *  - no se inventa fecha, no aparece en ningún día ni semana, pero sí en el listado general (Pendientes)
 *  - conserva sector, responsable/línea, cliente, producto y cantidad; se puede cargar la fecha después
 *  - los trabajos con fecha existentes no cambian
 * Se corre con `GENUS_E2E_VITEST_FILES=src/integration/trabajo-sin-fecha.db.integration.test.ts npm run test:e2e:semanas-priorities-db`.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { assertMarkedDatabase, e2eEnvironmentProblem } from "../../scripts/e2e/e2e-safety.mjs";

const PROBLEM = e2eEnvironmentProblem() ?? (process.env.GENUS_E2E_DATABASE_URL ? null : "falta GENUS_E2E_DATABASE_URL");
const prod = { email: "it-sinfecha@laboratoriogenus.com.ar", sector: "PRODUCCION" as const, displayName: "IT Sin fecha" };
const NOTE = "IT-SIN-FECHA";
const RUN = Math.random().toString(36).slice(2, 7);

describe.skipIf(Boolean(PROBLEM))(`Trabajos sin fecha en Postgres real${PROBLEM ? ` — saltado: ${PROBLEM}` : ""}`, () => {
  let pool: import("@neondatabase/serverless").Pool;
  const q = async (text: string, params: unknown[] = []) => (await pool.query(text, params)).rows as Record<string, unknown>[];
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.GENUS_E2E_DATABASE_URL!;
    const { Pool, neonConfig } = await import("@neondatabase/serverless");
    neonConfig.webSocketConstructor = (await import("ws")).default as never;
    pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
    await assertMarkedDatabase(q);
    vi.resetModules();
  }, 60_000);

  afterAll(async () => {
    await q("update work_items set deleted_at = now() where notes = $1", [NOTE]).catch(() => undefined);
    await pool?.end();
  });

  const assign = async (extra: Record<string, unknown>) => {
    const { assignWorkItemDurable } = await import("@/lib/planning/work-assignment-service");
    return assignWorkItemDurable(
      { client: `IT CLIENTE ${RUN}`, plannedQuantity: "100", notes: NOTE, idempotencyKey: randomUUID(), ...extra } as never,
      prod,
      randomUUID()
    );
  };
  const row = async (key: string) => (await q("select to_char(planned_date, 'YYYY-MM-DD') as planned_date, to_char(planned_date_to, 'YYYY-MM-DD') as planned_date_to, planning_week_id, sector, branch_owner, line, client, product, planned_quantity, status from work_items where id = $1", [ids[key]]))[0]!;

  it("Elaboración, Envasado Masivo y Premium se asignan SIN fecha: queda NULL (sin fecha de hoy ni semana) y conserva sector, responsable y cantidad", async () => {
    const e = await assign({ sector: "ELABORACION", product: `Crema E ${RUN}`, plannedQuantity: "250", unit: "kg", branchOwner: "Cristian" });
    const m = await assign({ sector: "ENVASADO_MASIVO", product: `Crema M ${RUN}`, unit: "u", line: "Línea 1" });
    const p = await assign({ sector: "ENVASADO_PREMIUM", product: `Crema P ${RUN}`, unit: "u", line: "Línea 2" });
    ids.e = e.item.id as string;
    ids.m = m.item.id as string;
    ids.p = p.item.id as string;
    for (const k of ["e", "m", "p"]) {
      const r = await row(k);
      expect(r.planned_date).toBeNull();
      expect(r.planned_date_to).toBeNull();
      expect(r.planning_week_id).toBeNull();
      expect(r.status).toBe("PUBLICADO");
    }
    expect(await row("e")).toMatchObject({ sector: "ELABORACION", branch_owner: "Cristian", planned_quantity: "250" });
    expect(await row("m")).toMatchObject({ sector: "ENVASADO_MASIVO", line: "Línea 1", planned_quantity: "100" });
    expect(await row("p")).toMatchObject({ sector: "ENVASADO_PREMIUM", line: "Línea 2" });
    expect(e.item.plannedDate).toBeNull();
  });

  it("un trabajo con fecha asignado antes no cambia, y el sin fecha NO aparece en un día ni en una semana pero SÍ en el listado general", async () => {
    const dated = await assign({ sector: "ENVASADO_MASIVO", product: `Crema D ${RUN}`, unit: "u", line: "Línea 3", plannedDate: "2026-12-02" });
    ids.d = dated.item.id as string;
    const before = await row("d");
    expect(String(before.planned_date).slice(0, 10)).toBe("2026-12-02");
    expect(before.planning_week_id).not.toBeNull();

    const { DrizzlePlanningRepository } = await import("@/lib/planning/drizzle-repository");
    const repo = new DrizzlePlanningRepository();
    const all = await repo.listPublishedItems({ sectors: ["ENVASADO_MASIVO", "ENVASADO_PREMIUM", "ELABORACION"], limit: 500 });
    for (const k of ["e", "m", "p", "d"]) expect(all.some((i) => i.id === ids[k])).toBe(true);
    const day = await repo.listPublishedItems({ sectors: ["ENVASADO_MASIVO", "ENVASADO_PREMIUM", "ELABORACION"], date: "2026-12-02", limit: 500 });
    expect(day.some((i) => i.id === ids.d)).toBe(true);
    for (const k of ["e", "m", "p"]) expect(day.some((i) => i.id === ids[k])).toBe(false);
    const week = await repo.listPublishedItems({ sectors: ["ENVASADO_MASIVO", "ENVASADO_PREMIUM", "ELABORACION"], weekStart: "2026-11-30", limit: 500 });
    expect(week.some((i) => i.id === ids.d)).toBe(true);
    for (const k of ["e", "m", "p"]) expect(week.some((i) => i.id === ids[k])).toBe(false);
    const free = all.find((i) => i.id === ids.m)!;
    expect(free.plannedDate).toBeNull();
    const { projectNativeWorkItem } = await import("@/lib/planning/native-projector");
    const wi = projectNativeWorkItem(free);
    expect(wi.plannedDate).toBeNull();
    expect(wi.weekStart).toBeNull();
    expect(wi.weekLabel).toBe("Sin fecha asignada");
  });

  it("después se le agrega la fecha: aparece ese día; el resto de los datos no se pierde", async () => {
    const { updateWorkItemPlanningDurable } = await import("@/lib/planning/work-item-progress-repository");
    const prev = await row("e");
    await updateWorkItemPlanningDurable(ids.e!, { plannedDate: "2026-12-03", updatedBy: prod.email, updatedBySector: "PRODUCCION" });
    const r = await row("e");
    expect(String(r.planned_date).slice(0, 10)).toBe("2026-12-03");
    expect(r).toMatchObject({ sector: prev.sector, branch_owner: prev.branch_owner, client: prev.client, product: prev.product, planned_quantity: prev.planned_quantity });
    const { DrizzlePlanningRepository } = await import("@/lib/planning/drizzle-repository");
    const day = await new DrizzlePlanningRepository().listPublishedItems({ sectors: ["ELABORACION"], date: "2026-12-03", limit: 500 });
    expect(day.some((i) => i.id === ids.e)).toBe(true);
    // los otros sin fecha siguen igual
    expect((await row("m")).planned_date).toBeNull();
  });

  it("fecha de entrega OPCIONAL e independiente de la de planificación: se puede asignar con fecha y sin entrega, y viceversa", async () => {
    const a = await assign({ sector: "ENVASADO_MASIVO", product: `Entrega A ${RUN}`, unit: "u", line: "Línea 1", plannedDate: "2026-12-10" });
    const b = await assign({ sector: "ENVASADO_MASIVO", product: `Entrega B ${RUN}`, unit: "u", line: "Línea 1", deliveryDate: "2026-12-20" });
    const rows = await q("select id, to_char(planned_date,'YYYY-MM-DD') pd, to_char(delivery_date,'YYYY-MM-DD') dd from work_items where id = any($1)", [[a.item.id, b.item.id]]);
    const ra = rows.find((r) => r.id === a.item.id)!;
    const rb = rows.find((r) => r.id === b.item.id)!;
    expect([ra.pd, ra.dd]).toEqual(["2026-12-10", null]);
    expect([rb.pd, rb.dd]).toEqual([null, "2026-12-20"]);
  });

  it("vista MENSUAL: el rango del mes trae los MISMOS trabajos del sector (con fecha), sin los sin fecha ni los de otros meses; reprogramar desde ahí sincroniza", async () => {
    const { DrizzlePlanningRepository } = await import("@/lib/planning/drizzle-repository");
    const { monthGridRange } = await import("@/lib/operational/month-grid");
    const repo = new DrizzlePlanningRepository();
    const nov = await assign({ sector: "ELABORACION", product: `Mes NOV ${RUN}`, plannedQuantity: "10", unit: "kg", branchOwner: "Cristian", plannedDate: "2027-05-12" });
    const jun = await assign({ sector: "ELABORACION", product: `Mes JUN ${RUN}`, plannedQuantity: "10", unit: "kg", branchOwner: "Cristian", plannedDate: "2027-06-20" });
    const sinFecha = await assign({ sector: "ELABORACION", product: `Mes SIN ${RUN}`, plannedQuantity: "10", unit: "kg", branchOwner: "Cristian" });
    const otro = await assign({ sector: "ENVASADO_PREMIUM", product: `Mes OTRO SECTOR ${RUN}`, unit: "u", line: "Línea 2", plannedDate: "2027-05-13" });
    const range = monthGridRange("2027-05-01");
    const may = await repo.listPublishedItems({ sectors: ["ELABORACION"], from: range.from, to: range.to, limit: 500 });
    const ids = may.map((i) => i.id);
    expect(ids).toContain(nov.item.id);
    expect(ids).not.toContain(jun.item.id);
    expect(ids).not.toContain(sinFecha.item.id);
    expect(ids).not.toContain(otro.item.id); // solo trabajos de su sector
    // Mismos trabajos que ve la Semanal (misma fila, mismo id): la semana del 12/05 incluye el mismo registro.
    const week = await repo.listPublishedItems({ sectors: ["ELABORACION"], weekStart: "2027-05-10", limit: 500 });
    expect(week.find((i) => i.id === nov.item.id)).toMatchObject({ id: nov.item.id, product: `Mes NOV ${RUN}` });
    // Reprogramar desde la Mensual (mismo servicio que la Semanal) → se refleja en ambas.
    const { rescheduleWorkItemDurable } = await import("@/lib/planning/work-item-progress-repository");
    await rescheduleWorkItemDurable(nov.item.id as string, { plannedDate: "2027-05-26", updatedBy: prod.email, updatedBySector: "PRODUCCION" } as never);
    const weekOld = await repo.listPublishedItems({ sectors: ["ELABORACION"], weekStart: "2027-05-10", limit: 500 });
    const weekNew = await repo.listPublishedItems({ sectors: ["ELABORACION"], weekStart: "2027-05-24", limit: 500 });
    expect(weekOld.some((i) => i.id === nov.item.id)).toBe(false);
    expect(weekNew.some((i) => i.id === nov.item.id)).toBe(true);
    // Programar un «Sin fecha» desde la Mensual: pasa a verse en el mes y en la semana, sin duplicarse.
    await rescheduleWorkItemDurable(sinFecha.item.id as string, { plannedDate: "2027-05-18", updatedBy: prod.email, updatedBySector: "PRODUCCION" } as never);
    const may2 = await repo.listPublishedItems({ sectors: ["ELABORACION"], from: range.from, to: range.to, limit: 500 });
    expect(may2.filter((i) => i.id === sinFecha.item.id)).toHaveLength(1);
    const week2 = await repo.listPublishedItems({ sectors: ["ELABORACION"], weekStart: "2027-05-17", limit: 500 });
    expect(week2.some((i) => i.id === sinFecha.item.id)).toBe(true);
  });
});
