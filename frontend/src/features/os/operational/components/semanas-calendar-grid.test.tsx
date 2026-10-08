/**
 * @vitest-environment happy-dom
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CalendarCell, CalendarWeek } from "@/lib/semanas-sheet/calendar-model";
import { SemanasCalendarGrid, type CalendarCommitChange } from "./semanas-calendar-grid";

/** IntersectionObserver simulado: "ve" solo los primeros `LIMIT` bloques observados (los que caben en el viewport). */
let LIMIT = 50;
class FakeIO {
  static count = 0;
  constructor(private cb: (e: Array<{ isIntersecting: boolean }>) => void) {}
  observe() {
    const visible = FakeIO.count++ < LIMIT;
    queueMicrotask(() => this.cb([{ isIntersecting: visible }]));
  }
  disconnect() {}
  unobserve() {}
}
beforeEach(() => {
  FakeIO.count = 0;
  LIMIT = 50;
  vi.stubGlobal("IntersectionObserver", FakeIO);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const cell = (a1: string, value = "", extra: Partial<CalendarCell> = {}): CalendarCell => ({
  a1, value, covered: false, span: 1, rowSpan: 1, protection: null, date: "2026-02-25", ...extra,
});
const cov = (a1: string): CalendarCell => cell(a1, "", { covered: true, protection: "Celda combinada: se edita en la celda ancla." });
const hdr = (n: number, label: string[]): CalendarWeek["rows"][number] => ({
  rowNumber: n,
  role: "structural",
  cells: label.map((v, i) => cell(`${"BDFHJ"[i]}${n}`, v, { protection: "Encabezado del calendario (día, fecha, mes): solo lectura." })),
});

/** Semana con varios productos: banda del responsable (5 días), bloque 2x2 combinado, celda cerrada y fondo de la Sheet. */
function makeWeek(id = "1", offset = 0): CalendarWeek {
  const r = (n: number) => n + offset;
  return {
    id, headerRow: r(1), lastRow: r(7), dates: ["2026-02-23", "2026-02-24", "2026-02-25", "2026-02-26", "2026-02-27"], label: "23/02 – 27/02/2026",
    rows: [
      hdr(r(1), ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes"]),
      hdr(r(2), ["23", "24", "25", "26", "27"]),
      hdr(r(3), ["Febrero", "Febrero", "Febrero", "Febrero", "Febrero"]),
      { rowNumber: r(4), role: "planning", cells: [cell(`B${r(4)}`, "CRISTIAN", { span: 5, format: { bg: "#CFE2F3", bold: true } }), cov(`D${r(4)}`), cov(`F${r(4)}`), cov(`H${r(4)}`), cov(`J${r(4)}`)] },
      { rowNumber: r(5), role: "planning", cells: [cell(`B${r(5)}`, "LAB ONCE"), cell(`D${r(5)}`, "NIZA"), cell(`F${r(5)}`, "BLOQUE", { span: 1, rowSpan: 2, format: { bg: "#00FF00" } }), cell(`H${r(5)}`, "ALL BEAUTY"), cell(`J${r(5)}`, "CERRADO", { protection: "Producción cerrada en GENUS." })] },
      { rowNumber: r(6), role: "planning", cells: [cell(`B${r(6)}`, "SERUM AH"), cell(`D${r(6)}`, "MIXOLOGI"), cov(`F${r(6)}`), cell(`H${r(6)}`, "CREMA"), cell(`J${r(6)}`, "AGUA", { date: "2026-02-27" })] },
      { rowNumber: r(7), role: "planning", cells: [cell(`B${r(7)}`, "55KG"), cell(`D${r(7)}`, "95KG"), cell(`F${r(7)}`, "265KG"), cell(`H${r(7)}`, "450KG"), cell(`J${r(7)}`, "") ] },
    ],
  };
}

const WIDTHS = [288, 280, 266, 265, 266];
async function setup(over: Partial<React.ComponentProps<typeof SemanasCalendarGrid>> = {}) {
  const onCommit = vi.fn(async (changes: CalendarCommitChange[]) => ({ ok: true, failures: [] as Array<{ a1: string; message: string }>, changes }));
  const utils = render(
    <SemanasCalendarGrid weeks={[makeWeek()]} dayWidths={WIDTHS} canEdit reasonRequiredBefore="2026-02-24" onCommit={onCommit} {...over} />
  );
  await waitFor(() => expect(document.querySelector("td[data-a1]")).not.toBeNull());
  return { onCommit, ...utils };
}
const td = (a1: string) => document.querySelector(`td[data-a1="${a1}"]`) as HTMLTableCellElement;
const click = (a1: string, shift = false) => fireEvent.mouseDown(td(a1), { shiftKey: shift });

describe("SemanasCalendarGrid — celdas combinadas y bloques", () => {
  it("renderiza la banda de 5 días con colSpan=5, el bloque 2x2 con rowSpan=2 y omite las cubiertas", async () => {
    await setup();
    expect(td("B4").colSpan).toBe(5);
    expect(td("B4").textContent).toContain("CRISTIAN");
    expect(td("D4")).toBeNull();
    expect(td("F5").rowSpan).toBe(2);
    expect(td("F6")).toBeNull();
    // cada fila del <tr> suma 5 columnas de día (las cubiertas no ocupan <td>)
    const rows = document.querySelectorAll("tbody tr");
    expect(rows).toHaveLength(7);
  });

  it("reproduce colores de la Sheet y anchos de columnas por día", async () => {
    await setup();
    expect(td("B4").style.background).toMatch(/207, 226, 243|#cfe2f3/i);
    expect(td("F5").style.background).toMatch(/0, 255, 0|#00ff00/i);
    const cols = document.querySelectorAll("colgroup col");
    expect([...cols].slice(1).map((c) => (c as HTMLElement).style.width)).toEqual(WIDTHS.map((w) => `${w}px`));
  });

  it("mantiene el encabezado de días y las semanas con varios productos", async () => {
    render(<SemanasCalendarGrid weeks={[makeWeek("1", 0), makeWeek("10", 10)]} dayWidths={WIDTHS} canEdit reasonRequiredBefore="2026-02-24" onCommit={vi.fn()} />);
    await waitFor(() => expect(td("D15")).not.toBeNull());
    expect(screen.getAllByText("Lunes").length).toBeGreaterThan(1);
    expect(document.querySelectorAll("[data-testid^='semanas-week-']")).toHaveLength(2);
    expect(td("D15")).not.toBeNull(); // 2ª semana (offset 10)
  });
});

describe("SemanasCalendarGrid — selección y copia", () => {
  it("selecciona un rango arrastrando y lo copia como TSV (la combinación va en su esquina)", async () => {
    await setup();
    click("B5");
    fireEvent.mouseEnter(td("H6"));
    fireEvent.mouseUp(window);
    expect(td("F5").getAttribute("aria-selected")).toBe("true");
    const data = { setData: vi.fn() };
    fireEvent.copy(screen.getByRole("grid"), { clipboardData: data });
    expect(data.setData).toHaveBeenCalledWith("text/plain", "LAB ONCE\tNIZA\tBLOQUE\tALL BEAUTY\nSERUM AH\tMIXOLOGI\t\tCREMA");
  });

  it("Shift+clic extiende y las flechas se mueven saltando bloques", async () => {
    await setup();
    click("B5");
    click("D5", true);
    expect(td("D5").getAttribute("aria-selected")).toBe("true");
    click("D5");
    fireEvent.keyDown(screen.getByRole("grid"), { key: "ArrowRight" });
    expect(screen.getByTestId("semanas-cal-a1").textContent).toBe("F5");
    fireEvent.keyDown(screen.getByRole("grid"), { key: "ArrowRight" });
    expect(screen.getByTestId("semanas-cal-a1").textContent).toBe("H5");
  });
});

describe("SemanasCalendarGrid — edición y protección", () => {
  it("edita una celda autorizada (doble clic + Enter) y envía SOLO esa celda con su valor anterior", async () => {
    const { onCommit } = await setup();
    fireEvent.doubleClick(td("H5"));
    const input = screen.getByTestId("semanas-cal-input") as HTMLInputElement;
    expect(input.value).toBe("ALL BEAUTY");
    fireEvent.change(input, { target: { value: "ALL BEAUTY 2" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(onCommit).toHaveBeenCalledTimes(1));
    expect(onCommit).toHaveBeenCalledWith([{ a1: "H5", oldValue: "ALL BEAUTY", newValue: "ALL BEAUTY 2", reason: undefined }]);
  });

  it("no permite editar celdas bloqueadas, encabezados ni cubiertas y explica por qué", async () => {
    const { onCommit } = await setup();
    fireEvent.doubleClick(td("J5"));
    expect(screen.queryByTestId("semanas-cal-input")).toBeNull();
    expect(screen.getByTestId("semanas-cal-notice").textContent).toContain("Producción cerrada en GENUS");
    fireEvent.doubleClick(td("B1"));
    expect(screen.queryByTestId("semanas-cal-input")).toBeNull();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("rechaza fórmulas", async () => {
    const { onCommit } = await setup();
    fireEvent.doubleClick(td("H5"));
    const input = screen.getByTestId("semanas-cal-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "=SUM(A1:A2)" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByTestId("semanas-cal-notice").textContent).toMatch(/fórmulas/);
  });

  it("pegar un rango muestra vista previa, omite las protegidas y escribe solo las editables", async () => {
    const { onCommit } = await setup();
    click("B5");
    fireEvent.paste(screen.getByRole("grid"), { clipboardData: { getData: () => "A\tB\tC\tD\tE" } });
    const dialog = screen.getByTestId("semanas-cal-preview");
    expect(within(dialog).getByTestId("semanas-cal-skipped").textContent).toContain("J5");
    expect(dialog.textContent).toContain("4 celda(s)");
    fireEvent.click(screen.getByTestId("semanas-cal-confirm"));
    await waitFor(() => expect(onCommit).toHaveBeenCalled());
    expect(onCommit.mock.calls[0]![0].map((c: CalendarCommitChange) => c.a1)).toEqual(["B5", "D5", "F5", "H5"]);
  });

  it("fecha anterior a hoy exige motivo antes de guardar", async () => {
    const { onCommit } = await setup({ reasonRequiredBefore: "2026-02-26" });
    fireEvent.doubleClick(td("D5"));
    const input = screen.getByTestId("semanas-cal-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "NIZA 2" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).not.toHaveBeenCalled();
    const confirm = screen.getByTestId("semanas-cal-confirm") as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(screen.getByTestId("semanas-cal-reason"), { target: { value: "Corrección de producto" } });
    fireEvent.click(confirm);
    await waitFor(() => expect(onCommit).toHaveBeenCalled());
    expect(onCommit.mock.calls[0]![0][0].reason).toBe("Corrección de producto");
  });

  it("sin permiso de edición todo es solo lectura (se puede seleccionar y copiar)", async () => {
    const { onCommit } = await setup({ canEdit: false });
    fireEvent.doubleClick(td("H5"));
    expect(screen.queryByTestId("semanas-cal-input")).toBeNull();
    click("H5");
    fireEvent.paste(screen.getByRole("grid"), { clipboardData: { getData: () => "X" } });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("si Google rechaza la celda, vuelve al valor anterior y muestra el error real", async () => {
    const onCommit = vi.fn(async () => ({ ok: false, failures: [{ a1: "H5", message: "Otro usuario modificó esta celda en Google." }] }));
    await setup({ onCommit });
    fireEvent.doubleClick(td("H5"));
    const input = screen.getByTestId("semanas-cal-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "NUEVO" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(screen.getByTestId("semanas-cal-notice").textContent).toContain("Otro usuario modificó"));
    expect(td("H5").textContent).toContain("ALL BEAUTY");
    expect(td("H5").getAttribute("data-status")).toBe("error");
  });
});

describe("SemanasCalendarGrid — rendimiento", () => {
  it("con 200 semanas monta solo las cercanas al viewport (virtualización por bloque)", async () => {
    LIMIT = 3;
    const weeks = Array.from({ length: 200 }, (_, i) => makeWeek(String(i * 10 + 1), i * 10));
    const t0 = performance.now();
    render(<SemanasCalendarGrid weeks={weeks} dayWidths={WIDTHS} canEdit reasonRequiredBefore="2026-01-01" onCommit={vi.fn()} />);
    const ms = performance.now() - t0;
    await waitFor(() => expect(document.querySelectorAll("[data-testid='semanas-cal-table']").length).toBe(3));
    expect(document.querySelectorAll("tbody tr").length).toBe(21); // 3 semanas × 7 filas, no 1400
    expect(document.querySelectorAll("[data-testid^='semanas-week-']")).toHaveLength(200);
    expect(ms).toBeLessThan(3000);
  });
});

const FIXTURE = path.resolve(__dirname, "../../../../../../SEMANAS 2026.xlsx");
describe.skipIf(!existsSync(FIXTURE))("SemanasCalendarGrid sobre la copia local de SEMANAS 2026", () => {
  it("ELABORACION: la banda B:K de cada responsable es una sola celda de 5 días y hay bloques 2x2 reales", async () => {
    const { XlsxFixtureGateway } = await import("@/lib/semanas-sheet/xlsx-grid");
    const { parseWeeklyCalendar, dayWidths } = await import("@/lib/semanas-sheet/calendar-model");
    const gw = new XlsxFixtureGateway(FIXTURE);
    const [rows, merges, formats] = await Promise.all([gw.readTab("x", "ELABORACION"), gw.readMerges("x", "ELABORACION"), gw.readFormats("x", "ELABORACION")]);
    const weeks = parseWeeklyCalendar(rows, merges, { year: 2026, formats });
    // semanas plegadas (ocultas en la Sheet original) se identifican; las visibles se renderizan
    expect(weeks.some((w) => w.hidden)).toBe(true);
    const visible = weeks.filter((w) => !w.hidden);
    expect(visible.length).toBeGreaterThan(0);
    const first = weeks[0]!;
    expect(first.rows.find((r) => r.rowNumber === 4)!.cells[0]!.span).toBe(5);
    expect(weeks.flatMap((w) => w.rows).some((r) => r.cells.some((c) => c.rowSpan === 2))).toBe(true);
    expect(weeks.flatMap((w) => w.rows).some((r) => r.cells.some((c) => c.format?.bg === "#00FF00"))).toBe(true);
    const dw = dayWidths(formats);
    expect(dw).toHaveLength(5);
    expect(dw[0]).toBe(288);
    LIMIT = 3;
    render(<SemanasCalendarGrid weeks={visible} dayWidths={dw} canEdit={false} reasonRequiredBefore="2026-01-01" onCommit={vi.fn()} />);
    await waitFor(() => expect(document.querySelector("td[colspan='5']")).not.toBeNull());
    const firstBand = document.querySelector("td[colspan='5']") as HTMLTableCellElement;
    expect(firstBand).not.toBeNull();
    expect(document.querySelectorAll("td[rowspan='2']").length).toBeGreaterThan(0);
  });
});
