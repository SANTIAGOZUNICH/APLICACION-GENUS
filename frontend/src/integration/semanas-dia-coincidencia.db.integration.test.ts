/**
 * «Semanas» = «Día a día» en Envasado Masivo y Premium contra un Postgres de PRUEBA real (mismo SQL que Neon): para cada
 * semana y sector, los IDs que la vista semanal pone en cada día son EXACTAMENTE los que la vista Día muestra ese día.
 * Cubre reprogramación a otra semana (drag de Producción), rangos que cruzan el fin de semana, cambio de mes y de año,
 * cambios de estado, semana vacía y muchos trabajos en un día. Se SALTA sin base local marcada.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { assertMarkedDatabase, e2eEnvironmentProblem } from "../../scripts/e2e/e2e-safety.mjs";
import type { WorkItem } from "@/types/operational/work-item";

const PROBLEM = e2eEnvironmentProblem() ?? (process.env.GENUS_E2E_DATABASE_URL ? null : "falta GENUS_E2E_DATABASE_URL");
const prod = { email: "it-sem-prod@laboratoriogenus.com.ar", sector: "PRODUCCION", displayName: "IT Producción" };
const RUN = randomUUID().slice(0, 6).toUpperCase();
type Sector = "ENVASADO_MASIVO" | "ENVASADO_PREMIUM";

describe.skipIf(Boolean(PROBLEM))(`Semanas = Día a día (Envasado) en Postgres real${PROBLEM ? ` — saltado: ${PROBLEM}` : ""}`, () => {
  let pool: import("@neondatabase/serverless").Pool;
  const q = async (text: string, params: unknown[] = []) => (await pool.query(text, params)).rows as Record<string, unknown>[];
  const ids: Record<string, string> = {};
  const W: Record<"mes" | "siguiente" | "anio" | "vacia", string> = { mes: "", siguiente: "", anio: "", vacia: "" };
  let mods: {
    repo: import("@/lib/planning/drizzle-repository").DrizzlePlanningRepository;
    project: typeof import("@/lib/planning/native-projector").projectNativeWorkItems;
    f: typeof import("@/lib/operational/work-item-filters");
    addDays: typeof import("@/lib/operational/operational-calendar").addDaysIso;
  };

  /** Mismo camino que GET /api/v1/work-items (listNativeWorkItems): SQL + proyección + filtros residuales. */
  async function serverList(sector: Sector, query: { date?: string; weekStart?: string }): Promise<WorkItem[]> {
    const rows = await mods.repo.listPublishedItems({ sector, date: query.date ?? null, weekStart: query.weekStart ?? null });
    let items = mods.f.filterWorkItemsForSectorAndPerson(mods.project(rows), sector, null);
    if (query.date) items = mods.f.filterWorkItemsByDate(items, query.date);
    else if (query.weekStart) items = mods.f.filterWorkItemsByWeekStart(items, query.weekStart);
    return items;
  }
  const days = (weekStart: string) => [0, 1, 2, 3, 4].map((n) => mods.addDays(weekStart, n));
  const idSet = (items: WorkItem[]) => [...new Set(items.map((i) => i.id))].sort();
  async function compareWeek(sector: Sector, weekStart: string) {
    const byDay = mods.f.groupWorkItemsByDay(await serverList(sector, { weekStart }), days(weekStart));
    const out: Record<string, { semanas: string[]; dia: string[] }> = {};
    for (const d of days(weekStart)) out[d] = { semanas: idSet(byDay.get(d) ?? []), dia: idSet(await serverList(sector, { date: d })) };
    return out;
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.GENUS_E2E_DATABASE_URL!;
    const { Pool, neonConfig } = await import("@neondatabase/serverless");
    neonConfig.webSocketConstructor = (await import("ws")).default as never;
    pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
    await assertMarkedDatabase(q);
    vi.resetModules();
    const { PlanningService } = await import("@/lib/planning/planning-service");
    const { DrizzlePlanningRepository } = await import("@/lib/planning/drizzle-repository");
    const { rescheduleWorkItemDurable } = await import("@/lib/planning/work-item-progress-repository");
    const repo = new DrizzlePlanningRepository();
    mods = {
      repo,
      project: (await import("@/lib/planning/native-projector")).projectNativeWorkItems,
      f: await import("@/lib/operational/work-item-filters"),
      addDays: (await import("@/lib/operational/operational-calendar")).addDaysIso,
    };
    const planning = new PlanningService(repo);
    const addDays = mods.addDays;

    // Semanas libres (lunes) en el futuro lejano: una que cruza de mes, la siguiente, una que cruza de año y una vacía.
    const free = async (pred: (monday: string) => boolean, from: string) => {
      for (let m = from; m < "2099-01-01"; m = addDays(m, 7)) {
        if (!pred(m)) continue;
        if ((await planning.listWeeks(m)).length) continue;
        if ((await planning.listWeeks(addDays(m, 7))).length) continue;
        return m;
      }
      throw new Error("sin semanas libres");
    };
    const start = addDays("2040-01-02", 7 * (parseInt(RUN, 16) % 400)); // lunes
    W.mes = await free((m) => m.slice(5, 7) !== addDays(m, 4).slice(5, 7), start);
    W.siguiente = addDays(W.mes, 7);
    W.anio = await free((m) => m.slice(0, 4) !== addDays(m, 4).slice(0, 4), addDays(W.siguiente, 7));
    W.vacia = await free(() => true, addDays(W.anio, 14));

    const mk = async (weekStart: string, items: Array<{ key: string; sector: Sector; day: number; line?: string }>) => {
      const week = await planning.createWeek({ weekStart, label: `IT semanas ${RUN}` }, prod as never);
      for (const it of items) {
        const created = await planning.createItem(
          week.id,
          { plannedDate: addDays(weekStart, it.day), client: `IT SEM ${RUN}`, product: `${it.key} ${RUN}`, plannedQuantity: "100", sector: it.sector, line: it.line ?? "Línea 1" },
          prod as never
        );
        ids[it.key] = created.id;
      }
      await planning.publishWeek(week.id, prod as never);
    };
    await mk(W.mes, [
      { key: "MASIVO-L1", sector: "ENVASADO_MASIVO", day: 2 },
      { key: "MASIVO-L2", sector: "ENVASADO_MASIVO", day: 2, line: "Línea 2" },
      { key: "PREMIUM", sector: "ENVASADO_PREMIUM", day: 3 },
      { key: "REPROGRAMADO", sector: "ENVASADO_MASIVO", day: 1 },
      { key: "RANGO", sector: "ENVASADO_PREMIUM", day: 4 },
      { key: "ESTADO", sector: "ENVASADO_MASIVO", day: 3 },
    ]);
    await mk(W.anio, [
      { key: "ANIO-FIN", sector: "ENVASADO_MASIVO", day: 0 },
      { key: "ANIO-INI", sector: "ENVASADO_PREMIUM", day: 4 },
      ...Array.from({ length: 25 }, (_, n) => ({ key: `MUCHOS-${n}`, sector: "ENVASADO_MASIVO" as const, day: 2 })),
    ]);
    // Producción arrastra un trabajo a la semana siguiente (misma función que el drag & drop de Semanas).
    await rescheduleWorkItemDurable(ids["REPROGRAMADO"]!, { plannedDate: addDays(W.siguiente, 1), updatedBy: "IT", updatedBySector: "PRODUCCION" });
    // Rango viernes → lunes siguiente.
    await q("update work_items set planned_date_to = $2 where id = $1", [ids["RANGO"], addDays(W.siguiente, 0)]);
    // Cambio de estado.
    await q("update work_items set operational_status = 'en_curso' where id = $1", [ids["ESTADO"]]);
  });

  afterAll(async () => {
    await pool?.end();
  });

  const native = (key: string) => `native:${ids[key]}`;

  it("para cada sector y semana, los IDs de cada día coinciden exactamente", async () => {
    for (const sector of ["ENVASADO_MASIVO", "ENVASADO_PREMIUM"] as const) {
      for (const w of [W.mes, W.siguiente, W.anio, W.vacia]) {
        const res = await compareWeek(sector, w);
        for (const [day, { semanas, dia }] of Object.entries(res)) expect(semanas, `${sector} ${day}`).toEqual(dia);
      }
    }
  });

  it("reprogramado a la semana siguiente: aparece en la semana nueva y no en la de origen", async () => {
    const nueva = await compareWeek("ENVASADO_MASIVO", W.siguiente);
    expect(nueva[mods.addDays(W.siguiente, 1)]!.semanas).toContain(native("REPROGRAMADO"));
    const origen = await compareWeek("ENVASADO_MASIVO", W.mes);
    expect(Object.values(origen).flatMap((d) => d.semanas)).not.toContain(native("REPROGRAMADO"));
  });

  it("rango viernes → lunes: el mismo trabajo en ambos días (sin copias en la base)", async () => {
    expect((await compareWeek("ENVASADO_PREMIUM", W.mes))[mods.addDays(W.mes, 4)]!.semanas).toContain(native("RANGO"));
    expect((await compareWeek("ENVASADO_PREMIUM", W.siguiente))[W.siguiente]!.semanas).toContain(native("RANGO"));
    const [{ n }] = (await q("select count(*)::int n from work_items where product = $1", [`RANGO ${RUN}`])) as Array<{ n: number }>;
    expect(n).toBe(1);
  });

  it("Masivo y Premium separados; cambio de estado no lo saca de su día", async () => {
    const m = await compareWeek("ENVASADO_MASIVO", W.mes);
    expect(m[mods.addDays(W.mes, 2)]!.semanas).toEqual(expect.arrayContaining([native("MASIVO-L1"), native("MASIVO-L2")]));
    expect(m[mods.addDays(W.mes, 3)]!.semanas).toContain(native("ESTADO"));
    expect(m[mods.addDays(W.mes, 3)]!.semanas).not.toContain(native("PREMIUM"));
    const p = await compareWeek("ENVASADO_PREMIUM", W.mes);
    expect(p[mods.addDays(W.mes, 3)]!.semanas).toContain(native("PREMIUM"));
  });

  it("cruce de año y muchos trabajos en un día: todos presentes; semana vacía sin trabajos", async () => {
    const m = await compareWeek("ENVASADO_MASIVO", W.anio);
    expect(m[mods.addDays(W.anio, 2)]!.semanas.filter((id) => id.startsWith("native:"))).toHaveLength(25);
    expect(m[W.anio]!.semanas).toContain(native("ANIO-FIN"));
    expect((await compareWeek("ENVASADO_PREMIUM", W.anio))[mods.addDays(W.anio, 4)]!.semanas).toContain(native("ANIO-INI"));
    for (const d of Object.values(await compareWeek("ENVASADO_MASIVO", W.vacia))) expect(d).toEqual({ semanas: [], dia: [] });
  });
});
