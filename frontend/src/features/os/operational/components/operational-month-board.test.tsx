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
});
