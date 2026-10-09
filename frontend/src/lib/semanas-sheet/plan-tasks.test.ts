import path from "node:path";
import { describe, expect, it } from "vitest";
import type { CalendarCell, CalendarWeek } from "./calendar-model";
import { parseWeeklyCalendar } from "./calendar-model";
import { buildCalendarModel } from "./calendar-tasks";
import {
  byPriority,
  classifySections,
  cleanBandTitle,
  coversDay,
  filterBySectors,
  formatDay,
  pickDays,
  plannedDays,
  projectPlanTasks,
  viewablePlanSectors,
} from "./plan-tasks";
import { buildWeekModel } from "./calendar-tasks";
import { XlsxFixtureGateway } from "./xlsx-grid";

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
  return { id: "1", headerRow: startRow - 3, lastRow: r, dates: ["2026-05-25", "2026-05-26", "2026-05-27", "2026-05-28", "2026-05-29"], label: "25/05 – 29/05/2026", rows };
}

const ACOND = [
  { title: "🍶  ENVASADO CONSUMO MASIVO", days: [[], ["FOLIMETTO", "SHAMPOO ANTICAIDA", "1000 x200ml"], [], [], []] },
  { title: "LÍNEA 2", days: [["TYL", "ALC EN GEL", "500 x1L"], [], [], [], []] },
  { title: "👑  ENVASADO PRODUCTOS PREMIUN", days: [[], ["BL COSMETICS", "ALISADO KERATIN", "2000 x300ml"], [], [], []] },
  { title: "PREMIUM A", days: [[], [], ["LAB ONCE", "SERUM AH 1500x30ml"], [], []] },
  { title: "OTRA COSA", days: [[], [], [], ["X", "Y"], []] },
];

describe("plan-tasks: proyección por sector (misma para Producción, sectores y TV)", () => {
  it("Acondicionamiento: banda Masivo / Premium (con typo «PREMIUN») y líneas que heredan el sector; banda desconocida = sin sector", () => {
    const model = buildWeekModel(weekOf(ACOND), "ACONDICIONAMIENTO");
    const meta = [...classifySections("ACONDICIONAMIENTO", model).values()];
    expect(meta.map((m) => m.sector)).toEqual(["ENVASADO_MASIVO", "ENVASADO_MASIVO", "ENVASADO_PREMIUM", "ENVASADO_PREMIUM", null]);
    expect(meta.map((m) => m.assignee)).toEqual([null, { kind: "LÍNEA", value: "LÍNEA 2" }, null, { kind: "LÍNEA", value: "PREMIUM A" }, null]);
    expect(meta[0]!.section).toBe("ENVASADO CONSUMO MASIVO"); // sin emojis
  });

  it("separa cliente / productos / cantidades / notas tal cual la planilla (sin inventar ni partir textos)", () => {
    const [t] = projectPlanTasks("ELABORACION", [weekOf([{ title: "CRISTIAN", days: [["TYL", "CREMA CHICLE 95kg", "SARAC CR NEUTRA 30KG", "ENTREGA 7/5"], [], [], [], []] }])], "ELABORACION", undefined);
    expect(t).toMatchObject({ client: "TYL", products: ["CREMA CHICLE 95kg", "SARAC CR NEUTRA 30KG"], quantities: [], notes: ["ENTREGA 7/5"], assignee: { kind: "RESPONSABLE", value: "CRISTIAN" }, sector: "ELABORACION", priority: "NORMAL", priorityInfo: null, date: "2026-05-25" });
    // a los sectores no se les mandan celdas
    expect(t!.lines[0]).toEqual({ role: "client", value: "TYL" });
    const [withCells] = projectPlanTasks("ELABORACION", [weekOf([{ title: "CRISTIAN", days: [["TYL", "CREMA"], [], [], [], []] }])], "ELABORACION", undefined, { withCells: true });
    expect(withCells!.lines[0]).toMatchObject({ a1: "B5", role: "client" });
  });

  it("la prioridad sale de la MISMA tabla por clave de tarea: Producción y el sector ven lo mismo", () => {
    const w = weekOf(ACOND);
    const keys = buildCalendarModel([w], "ACONDICIONAMIENTO").flatMap((m) => m.sections.flatMap((s) => s.tasks.map((t) => t.key)));
    const priorities = { available: true, byTask: { [keys[2]!]: { priority: "URGENTE" as const, version: 3, updatedBy: "p@x", updatedByName: "Producción", updatedAt: "2026-05-20T10:00:00Z" } } };
    const prod = projectPlanTasks("ACONDICIONAMIENTO", [w], "ACONDICIONAMIENTO", priorities, { withCells: true });
    const premium = filterBySectors(projectPlanTasks("ACONDICIONAMIENTO", [w], "ACONDICIONAMIENTO", priorities), ["ENVASADO_PREMIUM"], false);
    const p = prod.find((t) => t.key === keys[2])!;
    const s = premium.find((t) => t.key === keys[2])!;
    expect(s.priority).toBe("URGENTE");
    for (const f of ["key", "date", "client", "products", "quantities", "assignee", "sector", "priority"] as const) expect(s[f]).toEqual(p[f]);
  });

  it("filtro por sector: nunca mezcla Masivo con Premium; lo no clasificado solo para quien ve todo", () => {
    const all = projectPlanTasks("ACONDICIONAMIENTO", [weekOf(ACOND)], "ACONDICIONAMIENTO", undefined);
    expect(filterBySectors(all, ["ENVASADO_MASIVO"], false).map((t) => t.client)).toEqual(["FOLIMETTO", "TYL"]);
    expect(filterBySectors(all, ["ENVASADO_PREMIUM"], false).map((t) => t.client)).toEqual(["BL COSMETICS", "LAB ONCE"]);
    expect(filterBySectors(all, ["ENVASADO_MASIVO", "ENVASADO_PREMIUM"], true)).toHaveLength(5);
  });

  it("alcance por sector de sesión (igual que el plan semanal compartido)", () => {
    expect(viewablePlanSectors("ELABORACION")).toEqual(["ELABORACION"]);
    expect(viewablePlanSectors("ENVASADO_MASIVO")).toEqual(["ENVASADO_MASIVO"]);
    expect(viewablePlanSectors("ENVASADO_PREMIUM")).toEqual(["ENVASADO_PREMIUM"]);
    expect(viewablePlanSectors("CODIFICADO")).toEqual(["ENVASADO_MASIVO", "ENVASADO_PREMIUM"]);
    expect(viewablePlanSectors("DEPOSITO")).toEqual(["ENVASADO_MASIVO", "ENVASADO_PREMIUM"]);
    expect(viewablePlanSectors("MATERIA_PRIMA")).toEqual(["ELABORACION"]);
    expect(viewablePlanSectors("PRODUCCION")).toHaveLength(3);
    expect(viewablePlanSectors("CALIDAD")).toEqual([]);
    expect(viewablePlanSectors("COMERCIAL")).toEqual([]);
    expect(viewablePlanSectors(null)).toEqual([]);
  });

  it("días: tareas de varios días cubren cada día; los días se deduplican entre pestañas; prioridad URGENTE primero sin perder el orden", () => {
    const t = { weekStart: "2026-05-25", d: 1, span: 3 };
    expect([0, 1, 2, 3, 4].map((d) => coversDay(t, "2026-05-25", d))).toEqual([false, true, true, true, false]);
    const tasks = projectPlanTasks("ACONDICIONAMIENTO", [weekOf(ACOND)], "ACONDICIONAMIENTO", undefined);
    const w = weekOf(ACOND);
    const days = plannedDays([w, { ...w, id: "otra-pestaña" }], tasks);
    expect(days.map((d) => d.date)).toEqual(["2026-05-25", "2026-05-26", "2026-05-27", "2026-05-28"]);
    expect(pickDays(days, "2026-05-26", 2).days.map((d) => d.date)).toEqual(["2026-05-26", "2026-05-27"]);
    expect(pickDays(days, "2026-05-26", 2).reason).toBeNull();
    expect(pickDays(days, "2026-05-24", 1).reason).toMatch(/próximo día/);
    expect(pickDays(days, "2026-06-30", 2).reason).toMatch(/últimos días/);
    const sorted = byPriority([{ priority: "NORMAL" as const, n: 1 }, { priority: "URGENTE" as const, n: 2 }, { priority: "NORMAL" as const, n: 3 }, { priority: "IMPORTANTE" as const, n: 4 }]);
    expect(sorted.map((x) => x.n)).toEqual([2, 4, 1, 3]);
  });

  it("formato de fecha y limpieza de bandas", () => {
    expect(formatDay("2026-05-26")).toBe("Mar 26 may");
    expect(formatDay("2026-05-26", { long: true })).toBe("Martes 26 may");
    expect(formatDay(null)).toBe("—");
    expect(cleanBandTitle("👑  ENVASADO PRODUCTOS PREMIUM  |  1 LÍNEA")).toBe("ENVASADO PRODUCTOS PREMIUM | 1 LÍNEA");
  });

  it("copia real de SEMANAS 2026 (Preview): cada tarea de ACONDICIONAMIENTO queda en Masivo o Premium; ELABORACION con responsable", async () => {
    const gw = new XlsxFixtureGateway(path.resolve(__dirname, "../../../assets/semanas-preview/SEMANAS-2026-copia-de-prueba.xlsx"));
    for (const tab of ["ELABORACION", "ACONDICIONAMIENTO"] as const) {
      const weeks = parseWeeklyCalendar(await gw.readTab("x", tab), await gw.readMerges("x", tab), { year: 2026, formulaCells: await gw.readFormulaCells("x", tab), formats: await gw.readFormats!("x", tab) });
      const tasks = projectPlanTasks(tab, weeks, tab, undefined);
      expect(tasks.length).toBeGreaterThan(100);
      expect(tasks.every((t) => t.sector !== null)).toBe(true);
      if (tab === "ELABORACION") expect(new Set(tasks.map((t) => t.assignee?.value))).toEqual(new Set(["CRISTIAN", "NICOLAS"]));
      else {
        expect(tasks.some((t) => t.sector === "ENVASADO_MASIVO")).toBe(true);
        expect(tasks.some((t) => t.sector === "ENVASADO_PREMIUM")).toBe(true);
      }
      // ninguna línea se pierde en la proyección
      const lines = buildCalendarModel(weeks, tab).flatMap((m) => m.sections.flatMap((s) => s.tasks.flatMap((t) => t.lines.map((l) => l.value))));
      expect(tasks.flatMap((t) => t.lines.map((l) => l.value))).toEqual(lines);
    }
  });
});
