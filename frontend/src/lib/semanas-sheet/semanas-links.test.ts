import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CalendarCell, CalendarWeek } from "./calendar-model";
import { projectPlanTasks, type PlanTask } from "./plan-tasks";
import { loadPriorities, resetSemanasPrioritiesMemoryForTests, setTaskPriority } from "./semanas-priorities-service";
import {
  linkTask,
  listLinkEvents,
  loadTaskLinks,
  loadWorkItemPriorities,
  reconcileLinks,
  resetSemanasLinksMemoryForTests,
  setWorkItemDirectoryForTests,
  suggestLinkCandidates,
  unlinkTask,
  type WorkItemDirectory,
} from "./semanas-links-service";
import { matchLinksToTasks, rankCandidates, type WorkItemBrief } from "./task-links";

const COLS = "BDFHJ";
const cell = (a1: string, value = "", extra: Partial<CalendarCell> = {}): CalendarCell => ({ a1, value, covered: false, span: 1, rowSpan: 1, protection: null, date: null, ...extra });
const cov = (a1: string): CalendarCell => cell(a1, "", { covered: true, protection: "Celda combinada" });
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
  return { id: "1", headerRow: 1, lastRow: r, dates: ["2026-05-04", "2026-05-05", "2026-05-06", "2026-05-07", "2026-05-08"], label: "04/05 – 08/05/2026", rows };
}
const SPEC = [
  { title: "CRISTIAN", days: [["THELMA Y LOUISE", "CREMA FACIAL 30KG"], ["TYL", "SANITIZANTE UVA 40LT"], [], [], []] },
  { title: "NICOLAS", days: [["UNICA", "CREMA DE ORDEÑE", "160KG"], [], [], [], []] },
];
const SID = "fixture-semanas-2026";
const TAB = "ELABORACION";
const prod = { email: "produccion@laboratoriogenus.com.ar", sector: "PRODUCCION" as const, displayName: "Producción" };

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const wi = (n: number, extra: Partial<WorkItemBrief> = {}): WorkItemBrief => ({
  id: uuid(n), sector: "ELABORACION", client: "THELMA Y LOUISE", product: "CREMA FACIAL", quantity: "30", unit: "KG",
  plannedDate: "2026-05-04", plannedDateTo: null, orderNumber: `OE-2026-${n}`, line: null, branchOwner: "CRISTIAN", codificadoOriginSector: null, deleted: false, ...extra,
});
const ITEMS: WorkItemBrief[] = [
  wi(1),
  wi(2, { client: "TYL", product: "SANITIZANTE UVA", quantity: "40", unit: "LT", plannedDate: "2026-05-05" }),
  wi(3, { client: "UNICA", product: "CREMA DE ORDEÑE", quantity: "160", plannedDate: "2026-05-04", branchOwner: "NICOLAS" }),
  wi(4, { sector: "ENVASADO_MASIVO", client: "THELMA Y LOUISE", product: "CREMA FACIAL" }),
  wi(5, { plannedDate: "2026-05-12" }), // otra semana
  wi(6, { deleted: true }),
];
const directory: WorkItemDirectory = {
  async get(ids) {
    return new Map(ITEMS.filter((i) => ids.includes(i.id)).map((i) => [i.id, i] as const));
  },
  async list({ sectors, from, to }) {
    return ITEMS.filter((i) => sectors.includes(i.sector) && !i.deleted && i.plannedDate <= to && (i.plannedDateTo ?? i.plannedDate) >= from);
  },
};

async function tasksOf(w: CalendarWeek): Promise<PlanTask[]> {
  return projectPlanTasks("ELABORACION", [w], TAB, await loadPriorities(SID, TAB, [w]));
}
const byProduct = (tasks: PlanTask[], p: string) => tasks.find((t) => t.products.some((x) => x.includes(p)))!;
const link = (tasks: PlanTask[], product: string, n: number, extra: { replace?: { linkId: string; expectedVersion: number }; reason?: string } = {}) =>
  linkTask(prod, { spreadsheetId: SID, tab: TAB, taskKey: byProduct(tasks, product).key, workItemId: `native:${uuid(n)}`, ...extra }, tasks);

describe("vínculo explícito tarea de Semanas ↔ trabajo operativo", () => {
  beforeEach(() => {
    resetSemanasLinksMemoryForTests();
    resetSemanasPrioritiesMemoryForTests();
    setWorkItemDirectoryForTests(directory);
  });
  afterEach(() => setWorkItemDirectoryForTests(null));

  it("sugerencias: solo misma semana, mismo sector, no borrados ni ya vinculados; ordenadas por parecido (no se vincula nada solo)", async () => {
    const tasks = await tasksOf(weekOf(SPEC));
    const t = byProduct(tasks, "CREMA FACIAL");
    const c = (await suggestLinkCandidates(t, SID)).candidates;
    expect(c.map((x) => x.workItem.id)).toEqual([uuid(1), uuid(3), uuid(2)]);
    expect(c[0]!.hints).toEqual(["MISMO_DIA", "CLIENTE", "PRODUCTO"]);
    expect(Object.keys((await loadTaskLinks(SID, TAB, tasks)).byTask)).toHaveLength(0); // sugerir no vincula
    await link(tasks, "CREMA FACIAL", 1);
    expect((await suggestLinkCandidates(t, SID)).candidates.map((x) => x.workItem.id)).not.toContain(uuid(1));
    // desde OTRA tarea, el trabajo ya vinculado aparece aparte (para corregir), nunca como libre
    const other = await suggestLinkCandidates(byProduct(tasks, "SANITIZANTE"), SID);
    expect(other.candidates.map((x) => x.workItem.id)).not.toContain(uuid(1));
    expect(other.linkedElsewhere.map((x) => [x.workItem.id, x.link.taskKey])).toEqual([[uuid(1), t.key]]);
    // Envasado: también ofrece trabajos que pasaron a Codificado desde ese sector
    const env = { ...t, sector: "ENVASADO_MASIVO" as const };
    const items = [wi(7, { sector: "CODIFICADO", codificadoOriginSector: "ENVASADO_MASIVO" }), wi(8, { sector: "CODIFICADO", codificadoOriginSector: "ENVASADO_PREMIUM" })];
    expect(rankCandidates(env, items, new Set()).map((x) => x.workItem.id)).toEqual([uuid(7)]);
  });

  it("solo Producción vincula y desvincula (sectores y Dirección → 403)", async () => {
    const tasks = await tasksOf(weekOf(SPEC));
    for (const sector of ["ELABORACION", "ENVASADO_MASIVO", "CODIFICADO", "DIRECCION"] as const) {
      await expect(linkTask({ ...prod, sector }, { spreadsheetId: SID, tab: TAB, taskKey: tasks[0]!.key, workItemId: uuid(1) }, tasks)).rejects.toMatchObject({ status: 403 });
    }
    const l = await link(tasks, "CREMA FACIAL", 1);
    await expect(unlinkTask({ ...prod, sector: "ELABORACION" }, { linkId: l.linkId, expectedVersion: 1, reason: "no corresponde" })).rejects.toMatchObject({ status: 403 });
  });

  it("validaciones del servidor: tarea inexistente, trabajo borrado, de otro sector, de otra semana, id no nativo", async () => {
    const tasks = await tasksOf(weekOf(SPEC));
    await expect(linkTask(prod, { spreadsheetId: SID, tab: TAB, taskKey: "no-existe", workItemId: uuid(1) }, tasks)).rejects.toMatchObject({ status: 409 });
    await expect(link(tasks, "CREMA FACIAL", 6)).rejects.toThrow(/eliminado/);
    await expect(link(tasks, "CREMA FACIAL", 4)).rejects.toThrow(/otro sector/);
    await expect(link(tasks, "CREMA FACIAL", 5)).rejects.toThrow(/otra semana/);
    await expect(linkTask(prod, { spreadsheetId: SID, tab: TAB, taskKey: tasks[0]!.key, workItemId: "wi-demo-1" }, tasks)).rejects.toThrow(/nativa/);
  });

  it("un trabajo tiene UN vínculo activo; corregirlo exige versión y motivo, y queda auditado", async () => {
    const tasks = await tasksOf(weekOf(SPEC));
    const l1 = await link(tasks, "CREMA FACIAL", 1);
    await expect(link(tasks, "CREMA FACIAL", 1)).rejects.toMatchObject({ status: 409 });
    await expect(link(tasks, "SANITIZANTE", 1)).rejects.toThrow(/otra tarea/);
    await expect(link(tasks, "SANITIZANTE", 1, { replace: { linkId: l1.linkId, expectedVersion: 1 }, reason: "corto" })).rejects.toThrow(/motivo/);
    await expect(link(tasks, "SANITIZANTE", 1, { replace: { linkId: l1.linkId, expectedVersion: 7 }, reason: "Estaba en la tarea equivocada" })).rejects.toMatchObject({ status: 409 });
    await link(tasks, "SANITIZANTE", 1, { replace: { linkId: l1.linkId, expectedVersion: 1 }, reason: "Estaba en la tarea equivocada" });
    const links = await loadTaskLinks(SID, TAB, tasks);
    expect(links.byTask[byProduct(tasks, "CREMA FACIAL").key]).toBeUndefined();
    expect(links.byTask[byProduct(tasks, "SANITIZANTE").key]!.map((l) => l.workItemId)).toEqual([uuid(1)]);
    const ev = await listLinkEvents(SID, TAB, byProduct(tasks, "CREMA FACIAL").key);
    expect(ev.map((e) => e.action)).toEqual(["UNLINK", "LINK"]);
    expect(ev[0]).toMatchObject({ reason: "Estaba en la tarea equivocada", actorEmail: prod.email });
    expect(ev[1]!.workItemSummary).toMatch(/CREMA FACIAL · THELMA Y LOUISE · 30 KG · 2026-05-04 · OE-2026-1/);
  });

  it("una tarea puede tener varios trabajos (p. ej. dos productos de la misma elaboración)", async () => {
    const tasks = await tasksOf(weekOf(SPEC));
    await link(tasks, "CREMA FACIAL", 1);
    await link(tasks, "CREMA FACIAL", 3);
    expect((await loadTaskLinks(SID, TAB, tasks)).byTask[byProduct(tasks, "CREMA FACIAL").key]).toHaveLength(2);
  });

  it("«Mi trabajo»: el sector ve la MISMA prioridad que fijó Producción, solo en sus trabajos vinculados", async () => {
    const w = weekOf(SPEC);
    let tasks = await tasksOf(w);
    await link(tasks, "CREMA FACIAL", 1);
    const t = byProduct(tasks, "CREMA FACIAL");
    const s = await setTaskPriority(prod, { spreadsheetId: SID, tab: TAB, taskKey: t.key, priority: "URGENTE", expectedVersion: 0 }, [w]);
    tasks = await tasksOf(w);
    const load = (viewer: Parameters<typeof loadWorkItemPriorities>[0]) => loadWorkItemPriorities(viewer, SID, async () => tasks);
    expect((await load("ELABORACION")).byWorkItem).toEqual({ [`native:${uuid(1)}`]: expect.objectContaining({ priority: "URGENTE", taskKey: t.key, taskProducts: ["CREMA FACIAL 30KG"] }) });
    expect((await load("ENVASADO_MASIVO")).byWorkItem).toEqual({}); // otro sector: nada
    expect(Object.keys((await load("PRODUCCION")).byWorkItem)).toEqual([`native:${uuid(1)}`]);
    // los trabajos SIN vínculo no reciben ninguna prioridad (no se inventa NORMAL)
    expect((await load("ELABORACION")).byWorkItem[`native:${uuid(2)}`]).toBeUndefined();
    // Producción la baja a NORMAL → «Mi trabajo» la ve NORMAL
    await setTaskPriority(prod, { spreadsheetId: SID, tab: TAB, taskKey: t.key, priority: "NORMAL", expectedVersion: s.version }, [w]);
    tasks = await tasksOf(w);
    expect((await load("ELABORACION")).byWorkItem[`native:${uuid(1)}`]!.priority).toBe("NORMAL");
  });

  it("si la tarea se ELIMINA de la planilla, el trabajo deja de mostrar prioridad y Producción ve el vínculo «sin tarea»", async () => {
    const w = weekOf(SPEC);
    const tasks = await tasksOf(w);
    await link(tasks, "CREMA FACIAL", 1);
    const after = await tasksOf(weekOf([{ ...SPEC[0]!, days: [[], SPEC[0]!.days[1]!, [], [], []] }, SPEC[1]!]));
    expect((await loadWorkItemPriorities("ELABORACION", SID, async () => after)).byWorkItem).toEqual({});
    const links = await loadTaskLinks(SID, TAB, after);
    expect(links.orphans).toHaveLength(1);
    expect(links.orphans[0]!.warnings.join(" ")).toMatch(/ya no está en la planilla/);
    // y nunca se pasa a la tarea que ocupó su lugar
    expect(Object.keys(links.byTask)).toHaveLength(0);
  });

  it("corregir el texto de la tarea o moverla de día (inequívoco) conserva el vínculo; reconcile actualiza la clave", async () => {
    const tasks = await tasksOf(weekOf(SPEC));
    await link(tasks, "SANITIZANTE", 2);
    const moved = await tasksOf(weekOf([{ ...SPEC[0]!, days: [SPEC[0]!.days[0]!, [], SPEC[0]!.days[1]!, [], []] }, SPEC[1]!]));
    const t = byProduct(moved, "SANITIZANTE");
    expect((await loadTaskLinks(SID, TAB, moved)).byTask[t.key]![0]!.relinked).toBe(true);
    expect(await reconcileLinks(SID, TAB, moved)).toBe(1);
    expect((await loadTaskLinks(SID, TAB, moved)).byTask[t.key]![0]!.relinked).toBeUndefined();
  });

  it("desvincular exige motivo y versión; después el trabajo ya no muestra prioridad", async () => {
    const tasks = await tasksOf(weekOf(SPEC));
    const l = await link(tasks, "CREMA FACIAL", 1);
    await expect(unlinkTask(prod, { linkId: l.linkId, expectedVersion: 1, reason: "x" })).rejects.toThrow(/motivo/);
    await expect(unlinkTask(prod, { linkId: l.linkId, expectedVersion: 3, reason: "Vinculado por error" })).rejects.toMatchObject({ status: 409 });
    await unlinkTask(prod, { linkId: l.linkId, expectedVersion: 1, reason: "Vinculado por error" });
    expect((await loadWorkItemPriorities("ELABORACION", SID, async () => tasks)).byWorkItem).toEqual({});
    await expect(unlinkTask(prod, { linkId: l.linkId, expectedVersion: 2, reason: "Vinculado por error" })).rejects.toMatchObject({ status: 409 });
  });

  it("sin base / sin planificación nativa: la vinculación no está disponible (y no rompe la vista)", async () => {
    setWorkItemDirectoryForTests(null);
    const tasks = await tasksOf(weekOf(SPEC));
    expect(await loadTaskLinks(SID, TAB, tasks)).toEqual({ available: false, byTask: {}, orphans: [] });
    expect(await loadWorkItemPriorities("ELABORACION", SID, async () => tasks)).toEqual({ available: false, byWorkItem: {} });
    await expect(link(tasks, "CREMA FACIAL", 1)).rejects.toMatchObject({ status: 503 });
  });

  it("matchLinksToTasks agrupa por tarea y deja huérfanos los de tareas inexistentes", () => {
    const tasks = [{ key: "ELABORACION|2026-05-04|a|b|1", posKey: "ELABORACION|2026-05-04|0|s0|0" }];
    const l = (taskKey: string, id: string) => ({ taskKey, posKey: "ELABORACION|2026-05-04|0|s0|9", id });
    const r = matchLinksToTasks(tasks, [l(tasks[0]!.key, "x"), l(tasks[0]!.key, "y"), l("ELABORACION|2026-05-04|z|1", "z")]);
    expect(r.byTask.get(tasks[0]!.key)!.links.map((x) => x.id)).toEqual(["x", "y"]);
    expect(r.orphans.map((x) => x.id)).toEqual(["z"]);
  });
});
