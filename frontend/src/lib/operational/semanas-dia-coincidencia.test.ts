import { beforeAll, describe, expect, it } from "vitest";
import { MemoryPlanningRepository } from "@/lib/planning/memory-repository";
import { PlanningService } from "@/lib/planning/planning-service";
import { projectNativeWorkItems } from "@/lib/planning/native-projector";
import {
  filterWorkItemsByDate,
  filterWorkItemsByWeekStart,
  filterWorkItemsForSectorAndPerson,
  groupWorkItemsByDay,
} from "@/lib/operational/work-item-filters";
import { addDaysIso } from "@/lib/operational/operational-calendar";
import type { WorkItem } from "@/types/operational/work-item";

/**
 * Regresión: «Semanas» de Envasado (Masivo y Premium) debe mostrar, día por día, EXACTAMENTE los mismos trabajos que
 * «Día a día» — que es la referencia. Reproduce el camino del servidor (GET /api/v1/work-items con `date` o con
 * `weekStart`) y el reparto por día del tablero semanal.
 */
const actor = { email: "produccion@laboratoriogenus.com.ar", sector: "PRODUCCION", displayName: "Producción" };
type Sector = "ENVASADO_MASIVO" | "ENVASADO_PREMIUM";

let repo: MemoryPlanningRepository;
const ids: Record<string, string> = {};

/** Igual que listNativeWorkItems (route.ts): consulta + proyección + filtros residuales. */
async function serverList(sector: Sector, q: { date?: string; weekStart?: string }): Promise<WorkItem[]> {
  const rows = await repo.listPublishedItems({ sector, date: q.date ?? null, weekStart: q.weekStart ?? null });
  let items = filterWorkItemsForSectorAndPerson(projectNativeWorkItems(rows), sector, null);
  if (q.date) items = filterWorkItemsByDate(items, q.date);
  else if (q.weekStart) items = filterWorkItemsByWeekStart(items, q.weekStart);
  return items;
}
const weekDays = (weekStart: string) => [0, 1, 2, 3, 4].map((n) => addDaysIso(weekStart, n));
/** La vista identifica los trabajos nativos como `native:<uuid>`. */
const raw = (id: string) => id.replace(/^native:/, "");
const idSet = (items: WorkItem[]) => [...new Set(items.map((i) => i.id))].sort();

async function compareWeek(sector: Sector, weekStart: string) {
  const week = await serverList(sector, { weekStart });
  const byDay = groupWorkItemsByDay(week, weekDays(weekStart));
  const result: Record<string, { semanas: string[]; dia: string[] }> = {};
  for (const day of weekDays(weekStart)) {
    result[day] = { semanas: idSet(byDay.get(day) ?? []), dia: idSet(await serverList(sector, { date: day })) };
  }
  return result;
}

beforeAll(async () => {
  repo = new MemoryPlanningRepository();
  const service = new PlanningService(repo);
  const mk = async (weekStart: string, items: Array<{ key: string; sector: Sector; date: string; product: string; line?: string }>) => {
    const week = await service.createWeek({ weekStart }, actor);
    for (const it of items) {
      const created = await service.createItem(
        week.id,
        { plannedDate: it.date, client: "CLIENTE E2E", product: it.product, plannedQuantity: "100", sector: it.sector, line: it.line ?? "Línea 1" },
        actor
      );
      ids[it.key] = `native:${created.id}`;
    }
    await service.publishWeek(week.id, actor);
  };
  // Semana que cruza de mes (lun 28/09 – vie 02/10/2026).
  await mk("2026-09-28", [
    { key: "masivoA", sector: "ENVASADO_MASIVO", date: "2026-09-30", product: "SHAMPOO 1L" },
    { key: "masivoL2", sector: "ENVASADO_MASIVO", date: "2026-09-30", product: "ACONDICIONADOR 1L", line: "Línea 2" },
    { key: "premiumB", sector: "ENVASADO_PREMIUM", date: "2026-10-01", product: "SERUM 30ML" },
    { key: "reprogramado", sector: "ENVASADO_MASIVO", date: "2026-09-29", product: "GEL 500ML" },
    { key: "rango", sector: "ENVASADO_PREMIUM", date: "2026-10-02", product: "CREMA 50G" },
    { key: "parcial", sector: "ENVASADO_MASIVO", date: "2026-10-01", product: "JABÓN 250ML" },
  ]);
  // Semana que cruza de año (lun 28/12/2026 – vie 01/01/2027) + muchos trabajos el mismo día.
  await mk("2026-12-28", [
    { key: "fin2026", sector: "ENVASADO_MASIVO", date: "2026-12-31", product: "SHAMPOO FIN DE AÑO" },
    { key: "ini2027", sector: "ENVASADO_PREMIUM", date: "2027-01-01", product: "SERUM AÑO NUEVO" },
    ...Array.from({ length: 30 }, (_, n) => ({ key: `muchos${n}`, sector: "ENVASADO_MASIVO" as const, date: "2026-12-29", product: `PRODUCTO ${n}` })),
  ]);

  // Reprogramado por Producción a la semana siguiente (mar 06/10): conserva su semana de planificación de origen.
  const r = (await repo.getItem(raw(ids.reprogramado!)))!;
  await repo.updateItemOptimistic(r.id, r.version, { plannedDate: "2026-10-06", plannedDateTo: null });
  // Rango que cruza el fin de semana: vie 02/10 → lun 05/10.
  const g = (await repo.getItem(raw(ids.rango!)))!;
  await repo.updateItemOptimistic(g.id, g.version, { plannedDateTo: "2026-10-05" });
  // Entrega parcial / cambio de estado: no cambia en qué día se ve.
  const p = (await repo.getItem(raw(ids.parcial!)))!;
  await repo.updateItemOptimistic(p.id, p.version, { operationalStatus: "en_proceso", deliveredQuantity: "40" } as never);
});

describe("Semanas = Día a día (Envasado), día por día", () => {
  for (const sector of ["ENVASADO_MASIVO", "ENVASADO_PREMIUM"] as const) {
    for (const weekStart of ["2026-09-28", "2026-10-05", "2026-12-28", "2026-10-19"]) {
      it(`${sector} · semana ${weekStart}: mismos IDs cada día`, async () => {
        const res = await compareWeek(sector, weekStart);
        for (const [day, { semanas, dia }] of Object.entries(res)) expect(semanas, `${sector} ${day}`).toEqual(dia);
      });
    }
  }

  it("trabajo reprogramado a otra semana: aparece en la semana NUEVA (antes desaparecía de Semanas)", async () => {
    const res = await compareWeek("ENVASADO_MASIVO", "2026-10-05");
    expect(res["2026-10-06"]!.semanas).toContain(ids.reprogramado);
    expect(res["2026-10-06"]!.dia).toContain(ids.reprogramado);
    const before = await compareWeek("ENVASADO_MASIVO", "2026-09-28");
    expect(Object.values(before).flatMap((d) => d.semanas)).not.toContain(ids.reprogramado);
  });

  it("rango que cruza el fin de semana: viernes y lunes siguiente, sin copias del trabajo", async () => {
    const a = await compareWeek("ENVASADO_PREMIUM", "2026-09-28");
    const b = await compareWeek("ENVASADO_PREMIUM", "2026-10-05");
    expect(a["2026-10-02"]!.semanas).toContain(ids.rango);
    expect(b["2026-10-05"]!.semanas).toContain(ids.rango);
    expect(b["2026-10-06"]!.semanas).not.toContain(ids.rango);
  });

  it("cada sector ve solo lo suyo (Masivo no ve Premium ni al revés)", async () => {
    const m = await compareWeek("ENVASADO_MASIVO", "2026-09-28");
    const p = await compareWeek("ENVASADO_PREMIUM", "2026-09-28");
    expect(m["2026-10-01"]!.semanas).not.toContain(ids.premiumB);
    expect(p["2026-10-01"]!.semanas).toEqual([ids.premiumB]);
    expect(m["2026-09-30"]!.semanas).toEqual([ids.masivoA, ids.masivoL2].sort());
  });

  it("entrega parcial / cambio de estado: sigue en su día en ambas vistas", async () => {
    const m = await compareWeek("ENVASADO_MASIVO", "2026-09-28");
    expect(m["2026-10-01"]!.semanas).toContain(ids.parcial);
  });

  it("semana que cruza de año y día con muchos trabajos: todos contados, ninguno oculto", async () => {
    const m = await compareWeek("ENVASADO_MASIVO", "2026-12-28");
    expect(m["2026-12-29"]!.semanas).toHaveLength(30);
    expect(m["2026-12-31"]!.semanas).toEqual([ids.fin2026]);
    const p = await compareWeek("ENVASADO_PREMIUM", "2026-12-28");
    expect(p["2027-01-01"]!.semanas).toEqual([ids.ini2027]);
  });

  it("semana sin trabajos: vacía en ambas vistas", async () => {
    const m = await compareWeek("ENVASADO_MASIVO", "2026-10-19");
    for (const d of Object.values(m)) expect(d).toEqual({ semanas: [], dia: [] });
  });
});
