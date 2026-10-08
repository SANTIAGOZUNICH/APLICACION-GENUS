/**
 * Tareas del calendario de SEMANAS 2026 (modelo PURO, sin escribir nada).
 *
 * La Sheet no tiene "registros": un trabajo es un grupo de celdas contiguas de una columna de día
 * (cliente / producto / cantidad…), separado de los demás por una celda vacía, dentro de una banda
 * de responsable (celda combinada de ≥3 días). Este módulo reconstruye ese agrupamiento SIN cambiar
 * ni reordenar nada: cada línea conserva su celda (A1) de origen y puede editarse con el mismo
 * mecanismo por celda que la planilla.
 *
 * Identidad estable de una tarea (para guardar la prioridad en la base):
 *  - `key`   (contenido): pestaña · fecha del día · texto normalizado de las líneas · n-ésima repetición.
 *            NO depende del n° de fila ni del responsable → sobrevive a insertar/borrar filas,
 *            reordenar tareas dentro del día o renombrar/mover el bloque de responsable.
 *  - `posKey` (posición): semana · día · n° de sección · n° de tarea en la columna. Sirve de respaldo
 *            cuando alguien corrige el texto de la tarea (cambia `key`) sin cambiar su lugar.
 * Mover una tarea a OTRO DÍA la convierte en otra tarea (otra fecha) y empieza en NORMAL.
 */
import { buildLayout, cellAt, type Pos, type WeekLayout } from "./calendar-grid-model";
import type { CalendarWeek } from "./calendar-model";

export type LineRole = "client" | "product" | "quantity" | "note";

export interface TaskLine {
  a1: string;
  ri: number;
  d: number;
  value: string;
  protection: string | null;
  role: LineRole;
  span: number;
  /** Color de fondo de la Sheet (separa trabajos contiguos: cada bloque de color es un trabajo). */
  bg?: string;
}

export interface CalendarTask {
  key: string;
  posKey: string;
  weekId: string;
  /** Día de la semana (0 = lunes). Para tareas de varios días es el día de inicio. */
  d: number;
  /** Fecha ISO del día de inicio (null si el encabezado no es interpretable). */
  date: string | null;
  sectionIndex: number;
  /** Días que abarca la combinación (1 = normal). */
  span: number;
  lines: TaskLine[];
  /** Fila (índice dentro de la semana) de la primera línea. */
  startRi: number;
}

export interface SectionTitle {
  a1: string;
  ri: number;
  d: number;
  value: string;
  protection: string | null;
  span: number;
}

export interface CalendarSection {
  index: number;
  title: SectionTitle | null;
  tasks: CalendarTask[];
}

export interface WeekModel {
  weekId: string;
  label: string;
  dates: (string | null)[];
  sections: CalendarSection[];
}

const fold = (v: string) => v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

const QTY_RE = /^[\d.,\s]+(kg|kgs|lt|lts|l|ml|g|gr|un|u|unid\w*)?(\s*(total|x\s*\S*|×\s*\S*|c\/u))?$|^\d[\d.,]*\s*[x×]\s*\S+/i;
const NOTE_RE = /^entrega\b/i;
/** Texto que marca el comienzo de la plantilla de la semana siguiente (no es una tarea). */
const TEMPLATE_RE = /laboratorio genus|planificaci[oó]n semanal|l[ií]neas? de producci[oó]n/i;
/** Azules de las plantillas de semanas futuras generadas por GENUS (nunca usados en las bandas reales). */
const TEMPLATE_BG = new Set(["#1B2F5C", "#2E4A8A"]);
const DATE_CELL_RE = /^\d{1,2}\/\d{1,2}\/\d{4}$/;

export function isQuantityLike(value: string): boolean {
  return QTY_RE.test(value.trim());
}

function assignRoles(values: string[]): LineRole[] {
  const roles: LineRole[] = values.map((v) => (NOTE_RE.test(v.trim()) ? "note" : isQuantityLike(v) ? "quantity" : "product"));
  const products = roles.map((r, i) => (r === "product" ? i : -1)).filter((i) => i >= 0);
  // Cliente = primera línea cuando hay al menos otra línea de texto (producto) después.
  if (products.length >= 2 && products[0] === 0) roles[0] = "client";
  return roles;
}

function bandOf(layout: WeekLayout, ri: number): { d: number; value: string; span: number } | null {
  const row = layout.week.rows[ri]!;
  const filled = row.cells.map((c, d) => ({ c, d })).filter(({ c }) => !c.covered && c.value.trim());
  if (filled.length !== 1) return null;
  const { c, d } = filled[0]!;
  return c.span >= 3 ? { d, value: c.value.trim(), span: c.span } : null;
}

export function buildWeekModel(week: CalendarWeek, tab: string): WeekModel {
  const layout = buildLayout(week);
  const rows = week.rows;
  const firstPlanning = rows.findIndex((r) => r.role === "planning");
  const model: WeekModel = { weekId: week.id, label: week.label, dates: week.dates, sections: [] };
  const seen = new Map<string, number>(); // repeticiones del mismo contenido en el mismo día (en toda la semana)
  if (firstPlanning < 0) return model;

  // 1) límites de sección (bandas) y fin de contenido (plantilla de la semana siguiente)
  let end = rows.length;
  for (let ri = firstPlanning; ri < rows.length; ri += 1) {
    const r = rows[ri]!;
    const dateCells = r.cells.filter((c) => !c.covered && DATE_CELL_RE.test(c.value.trim())).length;
    if (r.cells.some((c) => (!c.covered && TEMPLATE_RE.test(c.value)) || (c.format?.bg && TEMPLATE_BG.has(c.format.bg.toUpperCase()))) || dateCells >= 3) {
      end = ri;
      break;
    }
  }
  const bandRows: number[] = [];
  for (let ri = firstPlanning; ri < end; ri += 1) if (bandOf(layout, ri)) bandRows.push(ri);
  const starts = bandRows.length > 0 && bandRows[0] === firstPlanning ? bandRows : [firstPlanning - 1, ...bandRows];
  // Sin banda inicial: sección "sin título" desde la primera fila de planificación.
  const sectionRanges = starts.map((s, i) => ({ headerRi: s >= firstPlanning && bandRows.includes(s) ? s : null, from: s >= firstPlanning && bandRows.includes(s) ? s + 1 : firstPlanning, to: (starts[i + 1] ?? end) }));

  sectionRanges.forEach((range, sectionIndex) => {
    const bandCell = range.headerRi !== null ? bandOf(layout, range.headerRi) : null;
    const headerRow = range.headerRi !== null ? rows[range.headerRi]! : null;
    const bandPos = bandCell && headerRow ? headerRow.cells[bandCell.d]! : null;
    const section: CalendarSection = {
      index: sectionIndex,
      title: bandCell && bandPos ? { a1: bandPos.a1, ri: range.headerRi!, d: bandCell.d, value: bandCell.value, protection: bandPos.protection, span: bandCell.span } : null,
      tasks: [],
    };
    const perDayOrdinal = new Array(5).fill(0) as number[];
    const collected: CalendarTask[] = [];
    for (let d = 0; d < 5; d += 1) {
      let lines: TaskLine[] = [];
      const flush = () => {
        if (lines.length === 0) return;
        const roles = assignRoles(lines.map((l) => l.value));
        lines.forEach((l, i) => (l.role = roles[i]!));
        const span = Math.max(...lines.map((l) => l.span));
        const date = week.dates[d] ?? null;
        collected.push({
          key: "",
          posKey: "",
          weekId: week.id,
          d,
          date,
          sectionIndex,
          span,
          lines,
          startRi: lines[0]!.ri,
        });
        lines = [];
      };
      for (let ri = range.from; ri < range.to; ri += 1) {
        const owner = layout.owner[ri]![d]!;
        if (owner.ri !== ri || owner.d !== d) {
          // cubierta por una combinación: si viene de otra columna, corta la pila de este día
          if (owner.d !== d) flush();
          continue; // (si es la misma columna y otra fila, es la continuación vertical de la línea anterior)
        }
        const cell = cellAt(layout, owner)!;
        const value = cell.value.trim();
        if (!value) {
          flush();
          continue;
        }
        const line: TaskLine = { a1: cell.a1, ri, d, value, protection: cell.protection, role: "product", span: cell.span, bg: cell.format?.bg };
        const isNote = NOTE_RE.test(value);
        // Un bloque de color distinto es otro trabajo; la nota «ENTREGA …» cierra el trabajo al que pertenece.
        const prevBg = [...lines].reverse().find((l) => l.bg)?.bg;
        if (!isNote && prevBg && line.bg && prevBg !== line.bg) flush();
        lines.push(line);
        if (isNote) flush();
      }
      flush();
    }
    // orden estable: por día y por fila de inicio
    collected.sort((a, b) => a.d - b.d || a.startRi - b.startRi);
    for (const t of collected) {
      const norm = t.lines.map((l) => fold(l.value)).join("|");
      const base = `${tab}|${t.date ?? `d${t.d}:${week.id}`}|${norm}`;
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      t.key = `${base}|${n}`;
      t.posKey = `${tab}|${week.dates[0] ?? week.id}|${t.d}|s${sectionIndex}|${perDayOrdinal[t.d]!++}`;
      section.tasks.push(t);
    }
    if (section.tasks.length > 0 || section.title) model.sections.push(section);
  });
  return model;
}

export function buildCalendarModel(weeks: CalendarWeek[], tab: string): WeekModel[] {
  return weeks.map((w) => buildWeekModel(w, tab));
}

// ---------- navegación por teclado entre las líneas VISIBLES del calendario operativo ----------


const navCache = new WeakMap<CalendarWeek, Pos[]>();

/** Posiciones (fila, día) de todo lo que se ve y se edita en las tarjetas: títulos de sección y líneas de tareas. */
export function visiblePositions(week: CalendarWeek): Pos[] {
  let cached = navCache.get(week);
  if (!cached) {
    const model = buildWeekModel(week, "nav");
    cached = model.sections.flatMap((s) => [...(s.title ? [{ ri: s.title.ri, d: s.title.d }] : []), ...s.tasks.flatMap((t) => t.lines.map((l) => ({ ri: l.ri, d: l.d })))]);
    navCache.set(week, cached);
  }
  return cached;
}

/** Flechas sobre líneas visibles: ↑↓ dentro de la columna del día; ←→ a la línea más cercana (en altura) del día contiguo. */
export function moveVisible(week: CalendarWeek, from: Pos, key: "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight"): Pos {
  const all = visiblePositions(week);
  if (all.length === 0) return from;
  if (key === "ArrowDown" || key === "ArrowUp") {
    const col = all.filter((p) => p.d === from.d).sort((a, b) => a.ri - b.ri);
    const next = key === "ArrowDown" ? col.find((p) => p.ri > from.ri) : [...col].reverse().find((p) => p.ri < from.ri);
    return next ?? from;
  }
  const step = key === "ArrowRight" ? 1 : -1;
  for (let d = from.d + step; d >= 0 && d <= 4; d += step) {
    const col = all.filter((p) => p.d === d);
    if (col.length === 0) continue;
    return col.reduce((best, p) => (Math.abs(p.ri - from.ri) < Math.abs(best.ri - from.ri) ? p : best));
  }
  return from;
}
