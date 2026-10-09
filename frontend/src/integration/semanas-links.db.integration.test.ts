/**
 * Vínculo tarea de Semanas ↔ work item (0042) contra un Postgres de PRUEBA real (mismo SQL que Neon):
 * persistencia, unicidad/concurrencia, productos repetidos y tareas idénticas, permisos, y que avances y finalizaciones
 * (las MISMAS funciones durables que usa /api/v1/live-sync/operations) sigan funcionando sobre trabajos vinculados.
 * Se SALTA sin base local marcada. Se corre con `npm run test:e2e:semanas-priorities-db`.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { assertMarkedDatabase, e2eEnvironmentProblem } from "../../scripts/e2e/e2e-safety.mjs";
import type { CalendarCell, CalendarWeek } from "@/lib/semanas-sheet/calendar-model";

const PROBLEM = e2eEnvironmentProblem() ?? (process.env.GENUS_E2E_DATABASE_URL ? null : "falta GENUS_E2E_DATABASE_URL");
const COLS = "BDFHJ";
const cell = (a1: string, value = "", extra: Partial<CalendarCell> = {}): CalendarCell => ({ a1, value, covered: false, span: 1, rowSpan: 1, protection: null, date: null, ...extra });
const cov = (a1: string): CalendarCell => cell(a1, "", { covered: true });
function weekOf(spec: Array<{ title: string; days: string[][] }>): CalendarWeek {
  const rows: CalendarWeek["rows"] = [];
  let r = 4;
  for (const sec of spec) {
    rows.push({ rowNumber: r, role: "planning", cells: [cell(`B${r}`, sec.title, { span: 5 }), ...[1, 2, 3, 4].map((d) => cov(`${COLS[d]}${r}`))] });
    r += 1;
    const h = Math.max(...sec.days.map((l) => l.length));
    for (let i = 0; i < h; i += 1) {
      rows.push({ rowNumber: r, role: "planning", cells: sec.days.map((lines, d) => cell(`${COLS[d]}${r}`, lines[i] ?? "")) });
      r += 1;
    }
  }
  return { id: "1", headerRow: 1, lastRow: r, dates: ["2026-05-04", "2026-05-05", "2026-05-06", "2026-05-07", "2026-05-08"], label: "x", rows };
}
// Dos tareas IDÉNTICAS (lunes y miércoles) + una muy parecida de otro cliente: el caso que un vínculo por parecido confundiría.
const SAN = ["TYL", "SANITIZANTE UVA 40LT"];
const SPEC = [{ title: "CRISTIAN", days: [SAN, [], [...SAN, "", "OTRO CLIENTE", "SANITIZANTE UVA 40LT"], [], []] }];
const SID = "it-copia-semanas-links";
const TAB = "ELABORACION";
const prod = { email: "it-prod@laboratoriogenus.com.ar", sector: "PRODUCCION" as const, displayName: "IT Producción" };

describe.skipIf(Boolean(PROBLEM))(`Vínculos tarea ↔ trabajo en Postgres real${PROBLEM ? ` — saltado: ${PROBLEM}` : ""}`, () => {
  let pool: import("@neondatabase/serverless").Pool;
  const q = async (text: string, params: unknown[] = []) => (await pool.query(text, params)).rows as Record<string, unknown>[];
  const ids: Record<string, string> = {};

  async function mods() {
    const links = await import("@/lib/semanas-sheet/semanas-links-service");
    const prio = await import("@/lib/semanas-sheet/semanas-priorities-service");
    const { projectPlanTasks } = await import("@/lib/semanas-sheet/plan-tasks");
    const tasksOf = async (w: CalendarWeek) => projectPlanTasks("ELABORACION", [w], TAB, await prio.loadPriorities(SID, TAB, [w]));
    return { links, prio, tasksOf };
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.GENUS_E2E_DATABASE_URL!;
    const { Pool, neonConfig } = await import("@neondatabase/serverless");
    neonConfig.webSocketConstructor = (await import("ws")).default as never;
    pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
    await assertMarkedDatabase(q);
    vi.resetModules();
    // Trabajos nativos reales (por el servicio de planificación, como Producción).
    const { PlanningService } = await import("@/lib/planning/planning-service");
    const { DrizzlePlanningRepository } = await import("@/lib/planning/drizzle-repository");
    const svc = new PlanningService(new DrizzlePlanningRepository());
    await q("update planning_weeks set status = 'DRAFT', published_at = null where week_start = '2026-05-04'");
    const existing = await svc.listWeeks("2026-05-04");
    const week = existing[0] ?? (await svc.createWeek({ weekStart: "2026-05-04", label: "IT" }, prod));
    const mk = async (key: string, plannedDate: string, client: string, product: string) => {
      const it = await svc.createItem(week.id, { plannedDate, client, product, plannedQuantity: "40", unit: "lt", sector: "ELABORACION", branchOwner: "Cristian", notes: "IT-LINKS" }, prod);
      ids[key] = `native:${it.id}`;
    };
    await mk("lunes", "2026-05-04", "TYL", "SANITIZANTE UVA");
    await mk("miercoles", "2026-05-06", "TYL", "SANITIZANTE UVA");
    await mk("parecido", "2026-05-06", "OTRO CLIENTE", "SANITIZANTE UVA");
  }, 60_000);

  afterAll(async () => {
    await q("delete from semanas_task_links where spreadsheet_id = $1", [SID]).catch(() => undefined);
    await q("delete from semanas_task_link_events where spreadsheet_id = $1", [SID]).catch(() => undefined);
    await q("delete from semanas_task_priorities where spreadsheet_id = $1", [SID]).catch(() => undefined);
    await q("delete from semanas_task_priority_events where spreadsheet_id = $1", [SID]).catch(() => undefined);
    await q("update work_items set deleted_at = now() where notes = 'IT-LINKS'").catch(() => undefined);
    await pool?.end();
  });

  it("productos repetidos y tareas idénticas: solo el trabajo vinculado recibe la prioridad; nada se asocia por parecido", async () => {
    const { links, prio, tasksOf } = await mods();
    const w = weekOf(SPEC);
    let tasks = await tasksOf(w);
    const lunes = tasks.find((t) => t.date === "2026-05-04")!;
    const miercoles = tasks.find((t) => t.date === "2026-05-06" && t.client === "TYL")!;
    expect(lunes.key).not.toBe(miercoles.key);
    // las sugerencias ofrecen los TRES (son parecidos) pero no vinculan ninguno
    const sug = await links.suggestLinkCandidates(lunes, SID);
    expect(sug.candidates.map((c) => c.workItem.id).sort()).toEqual([ids.lunes, ids.miercoles, ids.parecido].map((i) => i.slice(7)).sort());
    expect((await links.loadTaskLinks(SID, TAB, tasks)).byTask).toEqual({});

    await links.linkTask(prod, { spreadsheetId: SID, tab: TAB, taskKey: lunes.key, workItemId: ids.lunes }, tasks);
    await prio.setTaskPriority(prod, { spreadsheetId: SID, tab: TAB, taskKey: lunes.key, priority: "URGENTE", expectedVersion: 0 }, [w]);
    await prio.setTaskPriority(prod, { spreadsheetId: SID, tab: TAB, taskKey: miercoles.key, priority: "IMPORTANTE", expectedVersion: 0 }, [w]);
    tasks = await tasksOf(w);
    const shown = (await links.loadWorkItemPriorities("ELABORACION", SID, async () => tasks)).byWorkItem;
    expect(shown[ids.lunes]!.priority).toBe("URGENTE");
    expect(shown[ids.miercoles]).toBeUndefined(); // idéntico, con tarea IMPORTANTE, pero SIN vínculo → neutral
    expect(shown[ids.parecido]).toBeUndefined();

    await links.linkTask(prod, { spreadsheetId: SID, tab: TAB, taskKey: miercoles.key, workItemId: ids.miercoles }, tasks);
    const after = (await links.loadWorkItemPriorities("ELABORACION", SID, async () => tasks)).byWorkItem;
    expect([after[ids.lunes]!.priority, after[ids.miercoles]!.priority, after[ids.parecido]]).toEqual(["URGENTE", "IMPORTANTE", undefined]);
  });

  it("si se BORRA una de dos tareas idénticas, su trabajo NO hereda la prioridad de la otra (ambiguo → neutral)", async () => {
    const { links, tasksOf } = await mods();
    const sinLunes = weekOf([{ title: "CRISTIAN", days: [[], [], SPEC[0]!.days[2]!, [], []] }]);
    const tasks = await tasksOf(sinLunes);
    const shown = (await links.loadWorkItemPriorities("ELABORACION", SID, async () => tasks)).byWorkItem;
    expect(shown[ids.lunes]).toBeUndefined();
    expect(shown[ids.miercoles]!.priority).toBe("IMPORTANTE");
    expect((await links.loadTaskLinks(SID, TAB, tasks)).orphans.map((o) => `native:${o.workItemId}`)).toEqual([ids.lunes]);
  });

  it("persiste en la base: otra instancia del módulo lee los mismos vínculos y prioridades", async () => {
    vi.resetModules();
    const { links, tasksOf } = await mods();
    const tasks = await tasksOf(weekOf(SPEC));
    const shown = (await links.loadWorkItemPriorities("PRODUCCION", SID, async () => tasks)).byWorkItem;
    expect(Object.keys(shown).sort()).toEqual([ids.lunes, ids.miercoles].sort());
    const rows = await q("select count(*)::int as n from semanas_task_links where spreadsheet_id = $1 and unlinked_at is null", [SID]);
    expect(rows[0]!.n).toBe(2);
  });

  it("concurrencia: dos vínculos simultáneos del mismo trabajo → uno gana, el otro 409 (índice único parcial)", async () => {
    const { links, tasksOf } = await mods();
    const tasks = await tasksOf(weekOf(SPEC));
    const lunes = tasks.find((t) => t.date === "2026-05-04")!;
    const otro = tasks.find((t) => t.client === "OTRO CLIENTE")!;
    const r = await Promise.allSettled([
      links.linkTask(prod, { spreadsheetId: SID, tab: TAB, taskKey: lunes.key, workItemId: ids.parecido }, tasks),
      links.linkTask(prod, { spreadsheetId: SID, tab: TAB, taskKey: otro.key, workItemId: ids.parecido }, tasks),
    ]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect((r.find((x) => x.status === "rejected") as PromiseRejectedResult).reason).toMatchObject({ status: 409 });
    const n = await q("select count(*)::int as n from semanas_task_links where work_item_id = $1 and unlinked_at is null", [ids.parecido.slice(7)]);
    expect(n[0]!.n).toBe(1);
  });

  it("los sectores no pueden vincular ni desvincular (aunque escriban directo al servicio)", async () => {
    const { links, tasksOf } = await mods();
    const tasks = await tasksOf(weekOf(SPEC));
    const [l] = await q("select id, version from semanas_task_links where work_item_id = $1 and unlinked_at is null", [ids.lunes.slice(7)]);
    for (const sector of ["ELABORACION", "ENVASADO_MASIVO", "DIRECCION"] as const) {
      await expect(links.linkTask({ ...prod, sector }, { spreadsheetId: SID, tab: TAB, taskKey: tasks[0]!.key, workItemId: ids.parecido }, tasks)).rejects.toMatchObject({ status: 403 });
      await expect(links.unlinkTask({ ...prod, sector }, { linkId: String(l!.id), expectedVersion: Number(l!.version), reason: "intento de sector" })).rejects.toMatchObject({ status: 403 });
    }
  });

  it("avances y finalizaciones siguen funcionando sobre un trabajo vinculado (y no tocan vínculo ni prioridad)", async () => {
    const { links, tasksOf } = await mods();
    const { saveWorkProgressDurable, completeWorkDurable } = await import("@/lib/planning/work-item-progress-repository");
    const id = ids.lunes.slice(7);
    const saved = await saveWorkProgressDurable(id, { finishedQty: "25", observation: "Avance IT", updatedBy: "IT Elaboración", sector: "ELABORACION" }, "ELABORACION");
    expect(saved).toBeTruthy();
    // el RBAC operativo existente sigue igual: otro sector no puede registrar avance en un trabajo de Elaboración
    await expect(saveWorkProgressDurable(id, { finishedQty: "30", observation: "x", updatedBy: "IT Envasado", sector: "ENVASADO_MASIVO" }, "ENVASADO_MASIVO")).rejects.toThrow();
    await completeWorkDurable(id, { finishedQty: "40", observation: "Terminado IT", completedBy: "IT Elaboración" }, "ELABORACION");
    const [row] = await q("select finished_qty, operational_observation, operational_status, priority from work_items where id = $1", [id]);
    expect(row).toMatchObject({ finished_qty: "40", priority: "NORMAL" });
    expect(String(row!.operational_status)).not.toBe("pendiente");
    const tasks = await tasksOf(weekOf(SPEC));
    // reaparece la tarea del lunes (planilla completa): el trabajo terminado conserva su vínculo y su prioridad
    expect((await links.loadWorkItemPriorities("ELABORACION", SID, async () => tasks)).byWorkItem[ids.lunes]!.priority).toBe("URGENTE");
  });
});
