// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OperationalMonthBoard } from "./operational-month-board";
import type { MonthItem } from "@/lib/operational/month-grid";

afterEach(cleanup);
const it1: MonthItem = { id: "w1", product: "Crema", client: "ACME", quantity: "100", unit: "kg", plannedDate: "2026-11-03", plannedDateTo: null };
const sin: MonthItem = { id: "w2", product: "Shampoo", client: "BETA", quantity: "50", unit: "kg", plannedDate: null, plannedDateTo: null };

function board(over: Partial<React.ComponentProps<typeof OperationalMonthBoard<MonthItem>>> = {}) {
  const props = { monthStart: "2026-11-01", today: "2026-11-10", items: [it1], allItems: [it1, sin], canEdit: true, onSelectItem: vi.fn(), onCreateSlot: vi.fn(), onRequestDate: vi.fn(), onSelectDay: vi.fn(), ...over };
  render(<OperationalMonthBoard {...props} />);
  return props;
}

describe("OperationalMonthBoard", () => {
  it("muestra el mes completo y el trabajo en su día; abre el trabajo al hacer clic", () => {
    const p = board();
    expect(screen.getAllByTestId("month-day").length).toBeGreaterThanOrEqual(35);
    const day = screen.getAllByTestId("month-day").find((d) => d.getAttribute("data-day") === "2026-11-03")!;
    fireEvent.click(within(day).getByTestId("month-chip"));
    expect(p.onSelectItem).toHaveBeenCalledWith(it1);
  });
  it("«+» de un día abre la asignación con ESE día", () => {
    const p = board();
    const day = screen.getAllByTestId("month-day").find((d) => d.getAttribute("data-day") === "2026-11-12")!;
    fireEvent.click(within(day).getByTestId("month-add"));
    expect(p.onCreateSlot).toHaveBeenCalledWith("2026-11-12");
  });
  it("trabajos sin fecha en «Sin fecha asignada»: se programan eligiendo fecha (pasa por onRequestDate)", () => {
    const p = board();
    const section = screen.getByTestId("month-sin-fecha");
    expect(within(section).getAllByTestId("month-sin-fecha-item")).toHaveLength(1);
    expect(section.textContent).toMatch(/Shampoo/);
    fireEvent.change(within(section).getByTestId("month-sin-fecha-date"), { target: { value: "2026-11-20" } });
    expect(p.onRequestDate).toHaveBeenCalledWith(sin, "2026-11-20");
  });
  it("reprogramar arrastrando a otro día", () => {
    const p = board();
    const chip = screen.getByTestId("month-chip");
    const target = screen.getAllByTestId("month-day").find((d) => d.getAttribute("data-day") === "2026-11-18")!;
    const store = new Map<string, string>();
    const dt = { setData: (k: string, v: string) => store.set(k, v), getData: (k: string) => store.get(k) ?? "" };
    fireEvent.dragStart(chip, { dataTransfer: dt });
    fireEvent.drop(target, { dataTransfer: dt });
    expect(p.onRequestDate).toHaveBeenCalledWith(it1, "2026-11-18");
  });
  it("solo lectura: sin «+», sin fecha para programar ni arrastre", () => {
    board({ canEdit: false });
    expect(screen.queryAllByTestId("month-add")).toHaveLength(0);
    expect(screen.queryAllByTestId("month-sin-fecha-date")).toHaveLength(0);
    expect(screen.getByTestId("month-chip").getAttribute("draggable")).toBe("false");
  });
  it("showUndated=false oculta la sección", () => {
    board({ showUndated: false });
    expect(screen.queryByTestId("month-sin-fecha")).toBeNull();
  });
  describe("feriados de la planta (PBA)", () => {
    const dayEl = (d: string) => screen.getAllByTestId("month-day").find((x) => x.getAttribute("data-day") === d)!;
    it("marca los feriados con «FERIADO», diferencia nacional/provincial y muestra el nombre al tocar", () => {
      board({ monthStart: "2026-11-01" });
      expect(dayEl("2026-11-09").getAttribute("data-holiday")).toBe("nacional");
      expect(dayEl("2026-11-10").getAttribute("data-holiday")).toBeNull();
      expect(dayEl("2026-11-11").getAttribute("data-holiday")).toBe("provincial");
      expect(dayEl("2026-11-23").getAttribute("data-holiday")).toBe("nacional");
      const label = within(dayEl("2026-11-11")).getByTestId("month-holiday-label");
      expect(label.textContent).toMatch(/feriado/i);
      fireEvent.click(label);
      expect(within(dayEl("2026-11-11")).getByTestId("month-holiday-detail").textContent).toMatch(/Feriado provincial · Provincia de Buenos Aires/);
      fireEvent.click(dayEl("2026-11-09")); // tocar el día también muestra el nombre
      expect(within(dayEl("2026-11-09")).getByTestId("month-holiday-detail").textContent).toMatch(/Visita del Papa/);
    });
    it("diciembre: 07/12 sin marca; 08/12 y 25/12 marcados; cambiar de mes actualiza", () => {
      board({ monthStart: "2026-12-01" });
      expect(dayEl("2026-12-07").getAttribute("data-holiday")).toBeNull();
      expect(dayEl("2026-12-08").getAttribute("data-holiday")).toBe("nacional");
      expect(dayEl("2026-12-25").getAttribute("data-holiday")).toBe("nacional");
      expect(screen.getAllByTestId("month-holiday-label")).toHaveLength(3); // + 01/01/2027, visible en la última semana de la grilla
    });
    it("no bloquea la planificación: el trabajo sigue visible y se puede programar/reprogramar en un feriado", () => {
      const onCreateSlot = vi.fn();
      const onRequestDate = vi.fn();
      const feriado: MonthItem = { ...it1, id: "wf", plannedDate: "2026-11-09" };
      board({ items: [feriado], allItems: [feriado, sin], onCreateSlot, onRequestDate });
      expect(within(dayEl("2026-11-09")).getByTestId("month-chip").textContent).toMatch(/Crema/);
      fireEvent.click(within(dayEl("2026-11-09")).getByTestId("month-add"));
      expect(onCreateSlot).toHaveBeenCalledWith("2026-11-09");
      fireEvent.change(within(screen.getByTestId("month-sin-fecha")).getByTestId("month-sin-fecha-date"), { target: { value: "2026-11-11" } });
      expect(onRequestDate).toHaveBeenCalledWith(sin, "2026-11-11");
    });
  });
});
