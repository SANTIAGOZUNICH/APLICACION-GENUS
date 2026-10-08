import { beforeEach, describe, expect, it } from "vitest";
import type { CalendarCell, CalendarWeek } from "./calendar-model";
import { buildWeekModel } from "./calendar-tasks";
import { matchPriorities } from "./priorities";
import { getSemanasPriorityEventsMemory, loadPriorities, reconcilePriorities, resetSemanasPrioritiesMemoryForTests, setTaskPriority } from "./semanas-priorities-service";

const COLS = "BDFHJ";
const cell = (a1: string, value = "", extra: Partial<CalendarCell> = {}): CalendarCell => ({ a1, value, covered: false, span: 1, rowSpan: 1, protection: null, date: null, ...extra });
const cov = (a1: string): CalendarCell => cell(a1, "", { covered: true, protection: "Celda combinada" });
function weekOf(spec: Array<{ title: string; days: string[][] }>, startRow = 4): CalendarWeek {
  const rows: CalendarWeek["rows"] = [];
  let r = startRow;
  for (const sec of spec) {
    rows.push({ rowNumber: r, role: "planning", cells: [cell(`B${r}`, sec.title, { span: 5 }), ...[1, 2, 3, 4].map((d) => cov(`${COLS[d]}${r}`))] });
    r += 1;
    const h = Math.max(...sec.days.map((l) => l.length));
    for (let i = 0; i < h; i += 1) {
      rows.push({ rowNumber: r, role: "planning", cells: sec.days.map((lines, d) => cell(`${COLS[d]}${r}`, lines[i] ?? "")) });
      r += 1;
    }
  }
  return { id: "1", headerRow: startRow - 3, lastRow: r, dates: ["2026-05-04", "2026-05-05", "2026-05-06", "2026-05-07", "2026-05-08"], label: "x", rows };
}
const SPEC = [
  { title: "CRISTIAN", days: [["THELMA", "ALC EN GEL 300KG", "", "UNICA", "CREMA", "160KG"], ["TYL", "CREMA 95kg", "ENTREGA 7/5"], [], [], []] },
  { title: "NICOLAS", days: [["BL COSMETICS", "ALISADO", "1100KG"], [], [], [], []] },
];
const SID = "preview-xlsx-semanas-2026";
const TAB = "ELABORACION";
const prod = { email: "produccion@laboratoriogenus.com.ar", sector: "PRODUCCION" as const, displayName: "Producción" };
const tasksOf = (w: CalendarWeek) => buildWeekModel(w, TAB).sections.flatMap((s) => s.tasks);
const set = (w: CalendarWeek, idx: number, priority: "URGENTE" | "IMPORTANTE" | "NORMAL", expectedVersion = 0) =>
  setTaskPriority(prod, { spreadsheetId: SID, tab: TAB, taskKey: tasksOf(w)[idx]!.key, priority, expectedVersion }, [w]);

describe("prioridades de Semanas (persistencia en memoria = misma lógica que la tabla 0041)", () => {
  beforeEach(() => resetSemanasPrioritiesMemoryForTests());

  it("inicial NORMAL; se cambia, queda guardada con quién y cuándo, y se audita", async () => {
    const w = weekOf(SPEC);
    expect((await loadPriorities(SID, TAB, [w])).byTask).toEqual({});
    const saved = await set(w, 1, "URGENTE");
    expect(saved).toMatchObject({ priority: "URGENTE", version: 1, updatedBy: prod.email, updatedByName: "Producción" });
    expect(new Date(saved.updatedAt).getTime()).toBeLessThanOrEqual(Date.now());
    const loaded = await loadPriorities(SID, TAB, [w]);
    expect(loaded.available).toBe(true);
    expect(loaded.byTask[tasksOf(w)[1]!.key]!.priority).toBe("URGENTE");
    expect(loaded.byTask[tasksOf(w)[0]!.key]).toBeUndefined(); // el resto sigue NORMAL
    const ev = getSemanasPriorityEventsMemory();
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ from: "NORMAL", to: "URGENTE", actorEmail: prod.email, actorSector: "PRODUCCION" });
  });

  it("permisos: solo Producción escribe; prioridad inválida y tarea inexistente se rechazan", async () => {
    const w = weekOf(SPEC);
    const key = tasksOf(w)[0]!.key;
    await expect(setTaskPriority({ ...prod, sector: "CALIDAD" }, { spreadsheetId: SID, tab: TAB, taskKey: key, priority: "URGENTE", expectedVersion: 0 }, [w])).rejects.toThrow(/Solo Producción/);
    await expect(setTaskPriority(prod, { spreadsheetId: SID, tab: TAB, taskKey: key, priority: "CRITICA" as never, expectedVersion: 0 }, [w])).rejects.toThrow(/inválida/);
    await expect(setTaskPriority(prod, { spreadsheetId: SID, tab: TAB, taskKey: "no-existe", priority: "URGENTE", expectedVersion: 0 }, [w])).rejects.toMatchObject({ status: 409 });
  });

  it("concurrencia: dos usuarios con la misma versión → el segundo recibe conflicto y nada se pisa", async () => {
    const w = weekOf(SPEC);
    await set(w, 0, "IMPORTANTE", 0);
    await expect(set(w, 0, "URGENTE", 0)).rejects.toMatchObject({ status: 409 });
    expect((await loadPriorities(SID, TAB, [w])).byTask[tasksOf(w)[0]!.key]!.priority).toBe("IMPORTANTE");
    const ok = await set(w, 0, "URGENTE", 1);
    expect(ok.version).toBe(2);
  });

  it("SINCRONIZACIÓN: insertar filas, reordenar tareas y renombrar al responsable NO pierden prioridades", async () => {
    const w = weekOf(SPEC);
    await set(w, 1, "URGENTE");
    await set(w, 3, "IMPORTANTE");
    const urgentKey = tasksOf(w)[1]!.key;
    // la planilla "se resincroniza": 36 filas nuevas arriba, responsable renombrado y tareas reordenadas
    const shifted = weekOf([{ title: "CRISTIAN G.", days: [["UNICA", "CREMA", "160KG", "", "THELMA", "ALC EN GEL 300KG"], SPEC[0]!.days[1]!, [], [], []] }, SPEC[1]!], 40);
    const p = (await loadPriorities(SID, TAB, [shifted])).byTask;
    expect(Object.values(p).map((x) => x.priority).sort()).toEqual(["IMPORTANTE", "URGENTE"]);
    expect(p[urgentKey]!.priority).toBe("URGENTE");
    expect(p[urgentKey]!.relinked).toBeUndefined();
  });

  it("corregir el texto de una tarea conserva su prioridad (relink por posición) y reconcile re-asocia la clave", async () => {
    const w = weekOf(SPEC);
    await set(w, 0, "URGENTE");
    const edited = weekOf([{ ...SPEC[0]!, days: [["THELMA Y LOUISE", "ALC EN GEL 300KG", "", ...SPEC[0]!.days[0]!.slice(3)], SPEC[0]!.days[1]!, [], [], []] }, SPEC[1]!]);
    const t0 = tasksOf(edited)[0]!;
    const shown = (await loadPriorities(SID, TAB, [edited])).byTask[t0.key];
    expect(shown).toMatchObject({ priority: "URGENTE", relinked: true });
    expect(await reconcilePriorities(SID, TAB, [edited])).toBe(1);
    const after = (await loadPriorities(SID, TAB, [edited])).byTask[t0.key];
    expect(after!.priority).toBe("URGENTE");
    expect(after!.relinked).toBeUndefined();
    // y se puede seguir cambiando con la versión que ve el cliente
    expect((await set(edited, 0, "NORMAL", after!.version)).priority).toBe("NORMAL");
  });

  it("una fila huérfana nunca se asigna a dos tareas ni a una tarea que ya tiene la suya", () => {
    const tasks = [{ key: "a", posKey: "p0" }, { key: "b", posKey: "p1" }];
    const rows = [
      { taskKey: "a", posKey: "p0", priority: "URGENTE" as const, version: 1, updatedBy: "u", updatedByName: "U", updatedAt: "t" },
      { taskKey: "viejo", posKey: "p1", priority: "IMPORTANTE" as const, version: 1, updatedBy: "u", updatedByName: "U", updatedAt: "t" },
      { taskKey: "viejo2", posKey: "p0", priority: "NORMAL" as const, version: 1, updatedBy: "u", updatedByName: "U", updatedAt: "t" },
    ];
    const m = matchPriorities(tasks, rows);
    expect(m.a!.priority).toBe("URGENTE");
    expect(m.a!.relinked).toBeUndefined();
    expect(m.b).toMatchObject({ priority: "IMPORTANTE", relinked: true });
  });

  it("la prioridad es independiente del spreadsheet (copia de Preview ≠ original) y de la pestaña", async () => {
    const w = weekOf(SPEC);
    await set(w, 0, "URGENTE");
    expect((await loadPriorities("otro-spreadsheet", TAB, [w])).byTask).toEqual({});
    expect((await loadPriorities(SID, "ACONDICIONAMIENTO", [w])).byTask).toEqual({});
  });
});
