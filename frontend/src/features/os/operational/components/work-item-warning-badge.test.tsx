/**
 * @vitest-environment happy-dom
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestWorkItem } from "@/lib/__fixtures__/work-item.factory";
import { WorkItemWarningBadge } from "./work-item-warning-badge";

afterEach(() => {
  cleanup();
});

describe("WorkItemWarningBadge", () => {
  it("no renderiza nada si el WorkItem no tiene advertencias", () => {
    const item = createTestWorkItem({
      id: "wi-1",
      sector: "ENVASADO_MASIVO",
      status: "en_curso",
      originStage: "ACONDICIONAMIENTO",
      packagingLote: "L1",
      packagingVto: "10/2028",
      finishedQty: "100",
      quantity: "100",
      packingGroups: [{ cajas: 1, unidadesPorCaja: 100 }],
    });
    render(<WorkItemWarningBadge item={item} />);
    expect(screen.queryByTestId("work-item-warning-badge")).toBeNull();
  });

  it("una sola advertencia: tocar el badge llama onSelectField directo, sin panel de detalle", () => {
    const item = createTestWorkItem({
      id: "wi-2",
      sector: "ENVASADO_MASIVO",
      status: "en_curso",
      originStage: "ACONDICIONAMIENTO",
      packagingLote: null,
      packagingVto: "10/2028",
      finishedQty: "100",
      quantity: "100",
      packingGroups: [{ cajas: 1, unidadesPorCaja: 100 }],
    });
    const onSelectField = vi.fn();
    render(<WorkItemWarningBadge item={item} onSelectField={onSelectField} />);

    expect(screen.getByTestId("work-item-warning-badge").textContent).toContain("FALTA LOTE");
    fireEvent.click(screen.getByTestId("work-item-warning-badge"));
    expect(onSelectField).toHaveBeenCalledWith("lote");
    expect(screen.queryByTestId("work-item-warning-detail")).toBeNull();
  });

  it("varias advertencias: el badge combina LOTE Y VTO y abre un detalle con cada ítem accionable", () => {
    const item = createTestWorkItem({
      id: "wi-3",
      sector: "ENVASADO_MASIVO",
      status: "en_curso",
      originStage: "ACONDICIONAMIENTO",
      packagingLote: null,
      packagingVto: null,
      finishedQty: "100",
      quantity: "100",
      packingGroups: [],
    });
    const onSelectField = vi.fn();
    render(<WorkItemWarningBadge item={item} onSelectField={onSelectField} />);

    expect(screen.getByTestId("work-item-warning-badge").textContent).toBe("🔴FALTA LOTE Y VTO (+1)");
    fireEvent.click(screen.getByTestId("work-item-warning-badge"));
    expect(screen.getByTestId("work-item-warning-detail")).toBeTruthy();

    fireEvent.click(screen.getByTestId("work-item-warning-item-FALTA_PACKING"));
    expect(onSelectField).toHaveBeenCalledWith("packing");
    expect(screen.queryByTestId("work-item-warning-detail")).toBeNull();
  });

  it("la advertencia desaparece si el WorkItem ya tiene el dato completo", () => {
    const missing = createTestWorkItem({
      id: "wi-4",
      sector: "ENVASADO_MASIVO",
      status: "en_curso",
      originStage: "ACONDICIONAMIENTO",
      packagingLote: null,
      packagingVto: "10/2028",
      finishedQty: "100",
      quantity: "100",
      packingGroups: [{ cajas: 1, unidadesPorCaja: 100 }],
    });
    const { rerender } = render(<WorkItemWarningBadge item={missing} />);
    expect(screen.getByTestId("work-item-warning-badge")).toBeTruthy();

    const completed = { ...missing, packagingLote: "L26099" };
    rerender(<WorkItemWarningBadge item={completed} />);
    expect(screen.queryByTestId("work-item-warning-badge")).toBeNull();
  });
});
