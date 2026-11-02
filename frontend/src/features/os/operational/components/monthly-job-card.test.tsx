// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { formatJobDates, formatJobQuantity, MonthlyJobCard } from "./monthly-job-card";
import type { WeeklyPlanItemDto } from "@/lib/planning/weekly-plan-dto";

const job = (over: Partial<WeeklyPlanItemDto> = {}): WeeklyPlanItemDto => ({
  workItemId: "w1", plannedDate: "2026-11-05", plannedDateTo: "2026-11-05", product: "Serum Capilar", client: "Aqualo", quantity: "2000", unit: "un.",
  sector: "ENVASADO_PREMIUM", sectorLabel: "Envasado Premium", responsible: "Línea 1", deliveryDate: null, status: "PUBLICADO", statusLabel: "Publicado", lote: null, notes: null, progressLabel: "Pendiente", stateLabel: "Pendiente", ...over,
});

describe("MonthlyJobCard", () => {
  afterEach(cleanup);
  it("formatea cantidad con miles y unidad legible, y fechas", () => {
    expect(formatJobQuantity("2000", "un.")).toBe("2.000 unidades");
    expect(formatJobQuantity("2.000", "un.")).toBe("2.000 unidades");
    expect(formatJobQuantity("500", "kg")).toBe("500 kg");
    expect(formatJobQuantity("12,5", "kg")).toBe("12,5 kg");
    expect(formatJobDates("2026-11-05", "2026-11-05")).toBe("05/11/2026");
    expect(formatJobDates("2026-11-05", "2026-11-07")).toBe("05/11/2026 al 07/11/2026");
  });

  it("muestra cliente, producto y cantidad (principal) y fecha, sector y estado; sin lote si no está asignado; sin acciones", () => {
    render(<MonthlyJobCard job={job()} />);
    expect(screen.getByTestId("job-card-client").textContent).toBe("Aqualo");
    expect(screen.getByTestId("job-card-product").textContent).toBe("Serum Capilar");
    expect(screen.getByTestId("job-card-quantity").textContent).toBe("2.000 unidades");
    expect(screen.getByTestId("job-card-date").textContent).toBe("05/11/2026");
    expect(screen.getByTestId("job-card-sector").textContent).toBe("Envasado Premium");
    expect(screen.getByTestId("job-card-state").textContent).toBe("Pendiente");
    expect(screen.queryByTestId("job-card-lote")).toBeNull();
    expect(screen.queryAllByRole("button")).toHaveLength(0); // solo informativa
  });

  it("incluye el lote solo cuando está asignado y no muestra campos vacíos", () => {
    const { rerender } = render(<MonthlyJobCard job={job({ lote: "L-26099" })} />);
    expect(screen.getByTestId("job-card-lote").textContent).toBe("L-26099");
    rerender(<MonthlyJobCard job={job({ stateLabel: "" })} />);
    expect(screen.queryByTestId("job-card-state")).toBeNull();
  });
});
