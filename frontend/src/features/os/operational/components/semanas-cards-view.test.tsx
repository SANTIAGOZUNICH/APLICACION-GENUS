/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CalendarCell, CalendarWeek } from "@/lib/semanas-sheet/calendar-model";
import { buildWeekModel } from "@/lib/semanas-sheet/calendar-tasks";
import type { PrioritiesPayload } from "@/lib/semanas-sheet/priorities";
import { SemanasCardsView, type SemanasCardsViewProps } from "./semanas-cards-view";

afterEach(cleanup);
const cell = (a1: string, value = "", extra: Partial<CalendarCell> = {}): CalendarCell => ({ a1, value, covered: false, span: 1, rowSpan: 1, protection: null, date: "2026-05-07", ...extra });
const cov = (a1: string): CalendarCell => cell(a1, "", { covered: true, protection: "Celda combinada: se edita en la celda ancla." });

/** CRISTIAN: tarea con producto protegido (cerrado) y una tarea de 2 días combinada; NICOLAS: tarea simple. */
function week(): CalendarWeek {
  const rows: CalendarWeek["rows"] = [
    { rowNumber: 4, role: "planning", cells: [cell("B4", "CRISTIAN", { span: 5 }), cov("D4"), cov("F4"), cov("H4"), cov("J4")] },
    { rowNumber: 5, role: "planning", cells: [cell("B5", "THELMA"), cell("D5", "TYL"), cell("F5", "BL COSMETICS", { protection: "Producción ya cerrada en GENUS." }), cell("H5"), cell("J5")] },
    { rowNumber: 6, role: "planning", cells: [cell("B6", "ALC EN GEL 300KG"), cell("D6", "CREMA 95kg"), cell("F6", "ALISADO 1100KG", { protection: "Producción ya cerrada en GENUS." }), cell("H6"), cell("J6")] },
    { rowNumber: 7, role: "planning", cells: [cell("B7"), cell("D7", "ENTREGA 7/5"), cell("F7"), cell("H7"), cell("J7")] },
    { rowNumber: 8, role: "planning", cells: [cell("B8", "BIOESENCIA UNGUENTO", { span: 2 }), cov("D8"), cell("F8"), cell("H8"), cell("J8")] },
    { rowNumber: 9, role: "planning", cells: [cell("B9", "NICOLAS", { span: 5 }), cov("D9"), cov("F9"), cov("H9"), cov("J9")] },
    { rowNumber: 10, role: "planning", cells: [cell("B10", "UNICA"), cell("D10"), cell("F10"), cell("H10"), cell("J10")] },
    { rowNumber: 11, role: "planning", cells: [cell("B11", "CREMA DE ORDEÑE"), cell("D11"), cell("F11"), cell("H11"), cell("J11")] },
    { rowNumber: 12, role: "planning", cells: [cell("B12", "160KG"), cell("D12"), cell("F12"), cell("H12"), cell("J12")] },
  ];
  return { id: "1", headerRow: 1, lastRow: 12, dates: ["2026-05-04", "2026-05-05", "2026-05-06", "2026-05-07", "2026-05-08"], label: "04/05 – 08/05/2026", rows };
}
const keyOf = (text: string) => buildWeekModel(week(), "ELABORACION").sections.flatMap((s) => s.tasks).find((t) => t.lines.some((l) => l.value.includes(text)))!.key;

function setup(over: Partial<SemanasCardsViewProps> = {}, priorities?: PrioritiesPayload) {
  const onCommit = vi.fn(async () => ({ ok: true, failures: [] as Array<{ a1: string; message: string }> }));
  const onPriorityChange = vi.fn(async () => undefined);
  render(
    <SemanasCardsView tabKey="ELABORACION" weeks={[week()]} weekId="1" today="2026-05-06" canEdit reasonRequiredBefore="2026-05-06" priorities={priorities ?? { available: true, byTask: {} }}
      priorityLock={null} sectionLabel="Responsable" onPriorityChange={onPriorityChange} onCommit={onCommit} {...over} />
  );
  return { onCommit, onPriorityChange };
}
const line = (a1: string) => document.querySelector(`[data-a1="${a1}"]`) as HTMLElement;

describe("Calendario operativo (tarjetas)", () => {
  it("muestra tareas como tarjetas por responsable y día, con la correspondencia a su celda (A1)", () => {
    setup();
    expect(screen.getAllByTestId("task-card")).toHaveLength(5);
    expect(screen.getByText("CRISTIAN")).toBeTruthy();
    expect(screen.getByText("NICOLAS")).toBeTruthy();
    expect(line("B6").textContent).toBe("ALC EN GEL 300KG");
    expect(document.querySelector("th[scope=row]")).toBeNull(); // sin numeración de filas
  });

  it("la tarea combinada de 2 días ocupa 2 columnas (celda combinada conservada)", () => {
    setup();
    const strip = screen.getByTestId("multi-day-strip");
    expect((strip.firstElementChild as HTMLElement).style.gridColumn).toMatch(/span 2/);
    expect(strip.textContent).toContain("BIOESENCIA UNGUENTO");
  });

  it("edición en el lugar: doble clic → input, Enter guarda SOLO esa celda con su valor anterior; sin diálogos", async () => {
    const { onCommit } = setup();
    fireEvent.doubleClick(line("D6"));
    const input = screen.getByTestId("semanas-cal-input") as HTMLInputElement;
    expect(input.value).toBe("CREMA 95kg");
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.change(input, { target: { value: "CREMA 100kg" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(onCommit).toHaveBeenCalledTimes(1));
    expect(onCommit).toHaveBeenCalledWith([{ a1: "D6", oldValue: "CREMA 95kg", newValue: "CREMA 100kg", reason: undefined }]);
  });

  it("Escape cancela y no guarda", () => {
    const { onCommit } = setup();
    fireEvent.doubleClick(line("D6"));
    const input = screen.getByTestId("semanas-cal-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "otra cosa" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByTestId("semanas-cal-input")).toBeNull();
    expect(onCommit).not.toHaveBeenCalled();
    expect(line("D6").textContent).toBe("CREMA 95kg");
  });

  it("celdas protegidas: no entran en edición, se explica el motivo y nunca se guarda", () => {
    const { onCommit } = setup();
    fireEvent.doubleClick(line("F5"));
    expect(screen.queryByTestId("semanas-cal-input")).toBeNull();
    expect(screen.getByTestId("semanas-cal-notice").textContent).toContain("Producción ya cerrada en GENUS");
    expect(line("F5").getAttribute("data-protected")).toBe("1");
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("sin permiso de edición todo queda de solo lectura (se puede seleccionar y copiar)", () => {
    const { onCommit } = setup({ canEdit: false });
    fireEvent.doubleClick(line("D6"));
    expect(screen.queryByTestId("semanas-cal-input")).toBeNull();
    fireEvent.mouseDown(line("D6"));
    const data = { setData: vi.fn() };
    fireEvent.copy(screen.getByRole("grid"), { clipboardData: data });
    expect(data.setData).toHaveBeenCalledWith("text/plain", "CREMA 95kg");
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("pegar un rango muestra vista previa y omite las celdas protegidas", async () => {
    const { onCommit } = setup();
    fireEvent.mouseDown(line("D5"));
    fireEvent.paste(screen.getByRole("grid"), { clipboardData: { getData: () => "A\tB\tC\nD\tE\tF" } });
    const dlg = await screen.findByTestId("semanas-cal-preview");
    expect(screen.getByTestId("semanas-cal-skipped").textContent).toMatch(/F5|F6/);
    fireEvent.click(screen.getByTestId("semanas-cal-confirm"));
    await waitFor(() => expect(onCommit).toHaveBeenCalled());
    const sent = (onCommit.mock.calls[0]![0] as Array<{ a1: string }>).map((c) => c.a1);
    expect(sent).not.toContain("F5");
    expect(sent).not.toContain("F6");
    void dlg;
  });
});

describe("Prioridades en las tarjetas", () => {
  it("el chip muestra texto + color, se cambia desde un menú mínimo y llama al guardado con la tarea correcta", async () => {
    const { onPriorityChange } = setup({}, { available: true, byTask: { [keyOf("CREMA 95kg")]: { priority: "URGENTE", version: 2, updatedBy: "p@x", updatedByName: "Producción", updatedAt: "2026-05-06T10:00:00Z" } } });
    const urgent = document.querySelector("[data-priority=URGENTE]") as HTMLElement;
    expect(urgent.textContent).toContain("URGENTE");
    const chip = screen.getAllByTestId("priority-chip")[0]!;
    fireEvent.click(chip);
    expect(screen.getByTestId("priority-menu")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByTestId("priority-option-IMPORTANTE"));
    await waitFor(() => expect(onPriorityChange).toHaveBeenCalledTimes(1));
    const [task, next] = onPriorityChange.mock.calls[0] as unknown as [{ key: string }, string];
    expect(next).toBe("IMPORTANTE");
    expect(task.key).toBeTruthy();
  });

  it("sin permiso (o sin migración) el chip es de solo lectura y explica por qué", () => {
    setup({ priorityLock: "Solo Producción puede cambiar prioridades." });
    const chip = screen.getAllByTestId("priority-chip")[0]!;
    expect(chip.getAttribute("data-readonly")).toBe("1");
    expect(chip.getAttribute("title")).toContain("Solo Producción");
    fireEvent.click(chip);
    expect(screen.queryByTestId("priority-menu")).toBeNull();
  });

  it("filtrar y ordenar por prioridad es solo visual", () => {
    setup({}, { available: true, byTask: { [keyOf("UNICA")]: { priority: "URGENTE", version: 1, updatedBy: "p", updatedByName: "P", updatedAt: "2026-05-06T10:00:00Z" } } });
    fireEvent.click(screen.getByTestId("priority-filter-URGENTE"));
    expect(screen.getAllByTestId("task-card")).toHaveLength(1);
    fireEvent.click(screen.getByTestId("priority-filter-ALL"));
    expect(screen.getAllByTestId("task-card")).toHaveLength(5);
    expect(line("B6").textContent).toBe("ALC EN GEL 300KG"); // la planilla no cambia
  });

  it("migración 0041 pendiente: se avisa y todo se ve NORMAL", () => {
    setup({ priorityLock: "Las prioridades no están habilitadas" }, { available: false, byTask: {} });
    expect(screen.getByTestId("priority-unavailable")).toBeTruthy();
    expect(document.querySelectorAll("[data-priority=NORMAL]").length).toBeGreaterThan(0);
  });
});
