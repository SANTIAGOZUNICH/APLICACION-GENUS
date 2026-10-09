import { beforeEach, describe, expect, it } from "vitest";
import type { CalendarCell, CalendarWeek } from "./calendar-model";
import { buildWeekModel } from "./calendar-tasks";
import { matchPriorities } from "./priorities";
import { getSemanasPriorityEventsMemory, listPriorityEvents, loadPriorities, reconcilePriorities, resetSemanasPrioritiesMemoryForTests, setTaskPriority } from "./semanas-priorities-service";

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
    const T = "ELABORACION|2026-05-04";
    const tasks = [{ key: `${T}|thelma|alc|1`, posKey: "ELABORACION|2026-05-04|0|s0|0" }, { key: `${T}|unica|crema y louise|1`, posKey: "ELABORACION|2026-05-04|0|s0|1" }];
    const row = (taskKey: string, posKey: string, priority: "URGENTE" | "IMPORTANTE" | "NORMAL") => ({ taskKey, posKey, priority, version: 1, updatedBy: "u", updatedByName: "U", updatedAt: "t" });
    const rows = [
      row(tasks[0]!.key, "ELABORACION|2026-05-04|0|s0|0", "URGENTE"),
      row(`${T}|unica|crema|1`, "ELABORACION|2026-05-04|0|s0|1", "IMPORTANTE"), // texto corregido en la misma posición
      row(`${T}|thelma|alc viejo|1`, "ELABORACION|2026-05-04|0|s0|0", "NORMAL"), // misma posición que una tarea que ya tiene la suya
    ];
    const m = matchPriorities(tasks, rows);
    expect(m[tasks[0]!.key]!.priority).toBe("URGENTE");
    expect(m[tasks[0]!.key]!.relinked).toBeUndefined();
    expect(m[tasks[1]!.key]).toMatchObject({ priority: "IMPORTANTE", relinked: true });
  });

  it("ELIMINAR una tarea no transfiere su prioridad a la que ocupa su lugar", async () => {
    const w = weekOf(SPEC);
    await set(w, 0, "URGENTE"); // THELMA / ALC EN GEL
    const deleted = weekOf([{ ...SPEC[0]!, days: [["UNICA", "CREMA", "160KG"], SPEC[0]!.days[1]!, [], [], []] }, SPEC[1]!]);
    const p = (await loadPriorities(SID, TAB, [deleted])).byTask;
    expect(Object.keys(p)).toHaveLength(0); // UNICA sigue NORMAL aunque ahora esté en la posición 0
    expect(await reconcilePriorities(SID, TAB, [deleted])).toBe(0);
  });

  it("REEMPLAZAR por completo el texto de una tarea no conserva la prioridad (no es inequívoco)", async () => {
    const w = weekOf(SPEC);
    await set(w, 0, "URGENTE");
    const replaced = weekOf([{ ...SPEC[0]!, days: [["OTRO CLIENTE", "OTRO PRODUCTO", "", ...SPEC[0]!.days[0]!.slice(3)], SPEC[0]!.days[1]!, [], [], []] }, SPEC[1]!]);
    expect(Object.keys((await loadPriorities(SID, TAB, [replaced])).byTask)).toHaveLength(0);
  });

  it("MOVER una tarea de día (misma semana, contenido único) conserva su prioridad; se re-asocia y se puede seguir editando", async () => {
    const w = weekOf(SPEC);
    await set(w, 2, "URGENTE"); // TYL / CREMA 95kg / ENTREGA (martes)
    const moved = weekOf([{ ...SPEC[0]!, days: [SPEC[0]!.days[0]!, [], [], SPEC[0]!.days[1]!, []] }, SPEC[1]!]); // ahora el jueves
    const t = tasksOf(moved).find((x) => x.date === "2026-05-07")!;
    const p = (await loadPriorities(SID, TAB, [moved])).byTask;
    expect(p[t.key]).toMatchObject({ priority: "URGENTE", relinked: true, moved: true });
    expect(Object.keys(p)).toHaveLength(1);
    expect(await reconcilePriorities(SID, TAB, [moved])).toBe(1);
    const after = (await loadPriorities(SID, TAB, [moved])).byTask[t.key]!;
    expect(after.moved).toBeUndefined();
    // la historia (auditoría) sigue a la tarea
    expect(await listPriorityEvents(SID, TAB, t.key)).toEqual([expect.objectContaining({ from: "NORMAL", to: "URGENTE", actorEmail: prod.email })]);
    expect((await setTaskPriority(prod, { spreadsheetId: SID, tab: TAB, taskKey: t.key, priority: "NORMAL", expectedVersion: after.version }, [moved])).version).toBe(2);
  });

  it("MOVER es ambiguo si al guardar había otra tarea idéntica en la semana: no se transfiere", async () => {
    const dup = [{ title: "CRISTIAN", days: [["TYL", "SANITIZANTE"], [], ["TYL", "SANITIZANTE"], [], []] }];
    const w = weekOf(dup);
    await set(w, 0, "URGENTE"); // el del lunes
    // se borra el del lunes: el del miércoles ya existía y NO debe heredar URGENTE
    const after = weekOf([{ title: "CRISTIAN", days: [[], [], ["TYL", "SANITIZANTE"], [], []] }]);
    expect(Object.keys((await loadPriorities(SID, TAB, [after])).byTask)).toHaveLength(0);
  });

  it("MOVER a otra semana no arrastra la prioridad (otra semana = otra planificación)", async () => {
    const w = weekOf(SPEC);
    await set(w, 2, "URGENTE");
    const next = { ...weekOf([{ ...SPEC[0]!, days: [SPEC[0]!.days[0]!, [], [], [], []] }, SPEC[1]!]) };
    const other = { ...weekOf([{ title: "CRISTIAN", days: [[], SPEC[0]!.days[1]!, [], [], []] }]), id: "2", dates: ["2026-05-11", "2026-05-12", "2026-05-13", "2026-05-14", "2026-05-15"] };
    expect(Object.keys((await loadPriorities(SID, TAB, [next, other])).byTask)).toHaveLength(0);
  });

  it("la prioridad es independiente del spreadsheet (copia de Preview ≠ original) y de la pestaña", async () => {
    const w = weekOf(SPEC);
    await set(w, 0, "URGENTE");
    expect((await loadPriorities("otro-spreadsheet", TAB, [w])).byTask).toEqual({});
    expect((await loadPriorities(SID, "ACONDICIONAMIENTO", [w])).byTask).toEqual({});
  });
});
