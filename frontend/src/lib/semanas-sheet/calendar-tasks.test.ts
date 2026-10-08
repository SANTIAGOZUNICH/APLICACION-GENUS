import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { CalendarCell, CalendarWeek } from "./calendar-model";
import { parseWeeklyCalendar } from "./calendar-model";
import { buildWeekModel, isQuantityLike } from "./calendar-tasks";
import { XlsxFixtureGateway } from "./xlsx-grid";

const COLS = "BDFHJ";
const cell = (a1: string, value = "", extra: Partial<CalendarCell> = {}): CalendarCell => ({ a1, value, covered: false, span: 1, rowSpan: 1, protection: null, date: null, ...extra });
const cov = (a1: string): CalendarCell => cell(a1, "", { covered: true, protection: "Celda combinada: se edita en la celda ancla." });

/** Semana sintética: secciones con un array por día de líneas (null/"" = celda vacía). `startRow` desplaza TODO (simula insertar filas). */
function weekOf(spec: Array<{ title: string; days: string[][] }>, startRow = 4, id = "1"): CalendarWeek {
  const rows: CalendarWeek["rows"] = [];
  let r = startRow;
  for (const sec of spec) {
    rows.push({ rowNumber: r, role: "planning", cells: [cell(`B${r}`, sec.title, { span: 5 }), ...[1, 2, 3, 4].map((d) => cov(`${COLS[d]}${r}`))] });
    r += 1;
    const height = Math.max(...sec.days.map((l) => l.length));
    for (let i = 0; i < height; i += 1) {
      rows.push({ rowNumber: r, role: "planning", cells: sec.days.map((lines, d) => cell(`${COLS[d]}${r}`, lines[i] ?? "")) });
      r += 1;
    }
  }
  return { id, headerRow: startRow - 3, lastRow: r, dates: ["2026-05-04", "2026-05-05", "2026-05-06", "2026-05-07", "2026-05-08"], label: "04/05 – 08/05/2026", rows };
}
const keys = (w: CalendarWeek) => buildWeekModel(w, "ELABORACION").sections.flatMap((s) => s.tasks.map((t) => t.key));

describe("calendar-tasks (tareas de la planilla)", () => {
  const spec = [
    { title: "CRISTIAN", days: [["THELMA", "ALC EN GEL 300KG", "", "UNICA", "CREMA", "160KG"], ["TYL", "CREMA 95kg", "ENTREGA 7/5"], [], [], []] },
    { title: "NICOLAS", days: [["BL COSMETICS", "ALISADO", "1100KG"], [], [], [], []] },
  ];

  it("agrupa por columna de día, separa por celda vacía y por «ENTREGA», y asigna roles sin perder líneas", () => {
    const m = buildWeekModel(weekOf(spec), "ELABORACION");
    expect(m.sections.map((s) => s.title?.value)).toEqual(["CRISTIAN", "NICOLAS"]);
    const t = m.sections[0]!.tasks;
    expect(t.map((x) => x.lines.map((l) => l.value))).toEqual([
      ["THELMA", "ALC EN GEL 300KG"],
      ["UNICA", "CREMA", "160KG"],
      ["TYL", "CREMA 95kg", "ENTREGA 7/5"],
    ]);
    expect(t[1]!.lines.map((l) => l.role)).toEqual(["client", "product", "quantity"]);
    expect(t[2]!.lines.map((l) => l.role)).toEqual(["client", "product", "note"]);
    expect(t.map((x) => x.d)).toEqual([0, 0, 1]);
    expect(t[0]!.date).toBe("2026-05-04");
    // cada línea conserva su celda de origen
    expect(t[0]!.lines.map((l) => l.a1)).toEqual(["B5", "B6"]);
    expect(m.sections[1]!.tasks[0]!.lines.map((l) => l.a1)).toEqual(["B12", "B13", "B14"]);
  });

  it("identidad estable: insertar filas arriba o reordenar tareas NO cambia las claves", () => {
    const base = keys(weekOf(spec));
    expect(keys(weekOf(spec, 40))).toEqual(base); // todo desplazado 36 filas
    const reordered = [{ title: "CRISTIAN", days: [["UNICA", "CREMA", "160KG", "", "THELMA", "ALC EN GEL 300KG"], spec[0]!.days[1]!, [], [], []] }, spec[1]!];
    expect([...keys(weekOf(reordered))].sort()).toEqual([...base].sort());
    // renombrar al responsable tampoco cambia las claves de contenido
    const renamed = [{ ...spec[0]!, title: "CRISTIAN G." }, spec[1]!];
    expect(keys(weekOf(renamed))).toEqual(base);
  });

  it("tareas idénticas el mismo día reciben claves distintas (n-ésima repetición); otro día = otra tarea", () => {
    const dup = [{ title: "X", days: [["TYL", "SANITIZANTE", "5000x40ml", "", "TYL", "SANITIZANTE", "5000x40ml"], [], [], [], []] }];
    const k = keys(weekOf(dup));
    expect(new Set(k).size).toBe(2);
    const otherDay = [{ title: "X", days: [[], ["TYL", "SANITIZANTE", "5000x40ml"], [], [], []] }];
    expect(keys(weekOf(otherDay))[0]).not.toBe(k[0]);
  });

  it("posKey conserva el lugar cuando se corrige el texto (key cambia, posKey no)", () => {
    const a = buildWeekModel(weekOf(spec), "ELABORACION").sections[0]!.tasks[0]!;
    const edited = [{ ...spec[0]!, days: [["THELMA Y LOUISE", "ALC EN GEL 300KG", "", ...spec[0]!.days[0]!.slice(3)], spec[0]!.days[1]!, [], [], []] }, spec[1]!];
    const b = buildWeekModel(weekOf(edited), "ELABORACION").sections[0]!.tasks[0]!;
    expect(b.key).not.toBe(a.key);
    expect(b.posKey).toBe(a.posKey);
  });

  it("detecta cantidades", () => {
    for (const q of ["55KG", "265KG TOTAL", "1000 x200ml", "5000×40ml", "6400", "2000 x 28g c/u", "800"]) expect(isQuantityLike(q), q).toBe(true);
    for (const t of ["SERUM AH+NIA", "ALC EN GEL SANDIA 300KG", "THELMA Y LOUISE"]) expect(isQuantityLike(t), t).toBe(false);
  });

  it("no inventa tareas con las bandas vacías ni con la plantilla de la semana siguiente", () => {
    const w = weekOf([{ title: "CRISTIAN", days: [["A", "B"], [], [], [], []] }]);
    w.rows.push({ rowNumber: 99, role: "planning", cells: [cell("B99", "LABORATORIO GENUS", { span: 2 }), cov("D99"), cell("F99", "PLANIFICACIÓN SEMANAL"), cell("H99"), cell("J99")] });
    w.rows.push({ rowNumber: 100, role: "planning", cells: ["11/05/2026", "12/05/2026", "13/05/2026", "14/05/2026", "15/05/2026"].map((v, d) => cell(`${COLS[d]}100`, v)) });
    const m = buildWeekModel(w, "ELABORACION");
    expect(m.sections.flatMap((s) => s.tasks)).toHaveLength(1);
  });
});

const FIXTURE = path.resolve(__dirname, "../../../assets/semanas-preview/SEMANAS-2026-copia-de-prueba.xlsx");
describe.skipIf(!existsSync(FIXTURE))("calendar-tasks sobre la copia de SEMANAS 2026", () => {
  it("ELABORACION y ACONDICIONAMIENTO: todas las tareas tienen líneas con celda de origen, claves únicas y responsables", async () => {
    const gw = new XlsxFixtureGateway(FIXTURE);
    for (const tab of ["ELABORACION", "ACONDICIONAMIENTO"]) {
      const formats = await gw.readFormats("x", tab);
      const weeks = parseWeeklyCalendar(await gw.readTab("x", tab), await gw.readMerges("x", tab), { year: 2026, formats });
      const models = weeks.map((w) => buildWeekModel(w, tab));
      const tasks = models.flatMap((m) => m.sections.flatMap((s) => s.tasks));
      expect(tasks.length).toBeGreaterThan(150);
      expect(new Set(tasks.map((t) => t.key)).size).toBe(tasks.length);
      expect(tasks.every((t) => t.lines.length > 0 && t.lines.every((l) => /^[A-Z]+\d+$/.test(l.a1) && l.value.trim()))).toBe(true);
      const titles = new Set(models.flatMap((m) => m.sections.map((s) => s.title?.value)));
      if (tab === "ELABORACION") expect([...titles]).toEqual(expect.arrayContaining(["CRISTIAN", "NICOLAS"]));
      else expect([...titles].some((t) => /ENVASADO CONSUMO MASIVO/.test(t ?? ""))).toBe(true);
      // ninguna línea de la plantilla de semanas futuras se cuela como tarea
      expect(tasks.some((t) => t.lines.some((l) => /laboratorio genus|planificaci[oó]n semanal|l[ií]neas? de producci/i.test(l.value)))).toBe(false);
    }
  });
});
