/**
 * @vitest-environment happy-dom
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestWorkItem } from "@/lib/__fixtures__/work-item.factory";
import { WorkItemProgressTable } from "./work-item-progress-table";

afterEach(() => {
  cleanup();
});

/**
 * Regresión: el badge de advertencias (getWorkItemWarnings) se había
 * integrado en WorkItemRichCard (tarjeta de "Semanas") y en WorkItemDrawer
 * (detalle), pero WorkItemProgressTable — la tabla real de "Pendientes" y
 * de la vista "día" (viewMode por defecto en Envasado/Elaboración) — nunca
 * lo recibió. Por eso en Production Codificado mostraba el warning
 * (tabla propia, ya integrada) y Envasado no (esta tabla compartida,
 * olvidada).
 */
describe("WorkItemProgressTable — mismo warning que el resto de las pantallas", () => {
  const noop = () => "";

  it("Envasado Masivo sin lote/VTO -> warning visible", () => {
    const item = createTestWorkItem({
      id: "wi-masivo",
      sector: "ENVASADO_MASIVO",
      status: "en_curso",
      originStage: "ACONDICIONAMIENTO",
      packagingLote: null,
      packagingVto: null,
      finishedQty: "100",
      packingGroups: [{ cajas: 1, unidadesPorCaja: 100 }],
    });
    render(
      <WorkItemProgressTable
        items={[item]}
        variant="envasado"
        getFinishedQty={noop}
        getObservation={noop}
        onSelectItem={() => {}}
      />
    );
    expect(screen.getByTestId("work-item-warning-badge").textContent).toContain("FALTA LOTE Y VTO");
  });

  it("Envasado Premium sin lote/VTO -> warning visible", () => {
    const item = createTestWorkItem({
      id: "wi-premium",
      sector: "ENVASADO_PREMIUM",
      status: "en_curso",
      originStage: "ACONDICIONAMIENTO",
      packagingLote: null,
      packagingVto: null,
      finishedQty: "100",
      packingGroups: [{ cajas: 1, unidadesPorCaja: 100 }],
    });
    render(
      <WorkItemProgressTable
        items={[item]}
        variant="envasado"
        getFinishedQty={noop}
        getObservation={noop}
        onSelectItem={() => {}}
      />
    );
    expect(screen.getByTestId("work-item-warning-badge").textContent).toContain("FALTA LOTE Y VTO");
  });

  it("con lote/VTO/packing/cantidad completos -> no hay warning", () => {
    const item = createTestWorkItem({
      id: "wi-completo",
      sector: "ENVASADO_MASIVO",
      status: "en_curso",
      originStage: "ACONDICIONAMIENTO",
      packagingLote: "L26099",
      packagingVto: "10/2028",
      finishedQty: "100",
      quantity: "100",
      packingGroups: [{ cajas: 1, unidadesPorCaja: 100 }],
    });
    render(
      <WorkItemProgressTable
        items={[item]}
        variant="envasado"
        getFinishedQty={noop}
        getObservation={noop}
        onSelectItem={() => {}}
      />
    );
    expect(screen.queryByTestId("work-item-warning-badge")).toBeNull();
  });

  it("completar lote/VTO hace desaparecer el warning (re-render con el mismo dato ya cargado)", () => {
    const missing = createTestWorkItem({
      id: "wi-completa-ahora",
      sector: "ENVASADO_MASIVO",
      status: "en_curso",
      originStage: "ACONDICIONAMIENTO",
      packagingLote: null,
      packagingVto: null,
      finishedQty: "100",
      packingGroups: [{ cajas: 1, unidadesPorCaja: 100 }],
    });
    const { rerender } = render(
      <WorkItemProgressTable
        items={[missing]}
        variant="envasado"
        getFinishedQty={noop}
        getObservation={noop}
        onSelectItem={() => {}}
      />
    );
    expect(screen.getByTestId("work-item-warning-badge")).toBeTruthy();

    const completed = { ...missing, packagingLote: "L1", packagingVto: "10/2028" };
    rerender(
      <WorkItemProgressTable
        items={[completed]}
        variant="envasado"
        getFinishedQty={noop}
        getObservation={noop}
        onSelectItem={() => {}}
      />
    );
    expect(screen.queryByTestId("work-item-warning-badge")).toBeNull();
  });

  it("tocar el warning no abre el drawer dos veces ni bloquea el click de la fila", () => {
    const item = createTestWorkItem({
      id: "wi-click",
      sector: "ENVASADO_MASIVO",
      status: "en_curso",
      originStage: "ACONDICIONAMIENTO",
      packagingLote: null,
      packagingVto: "10/2028",
      finishedQty: "100",
      packingGroups: [{ cajas: 1, unidadesPorCaja: 100 }],
    });
    const onSelectItem = vi.fn();
    render(
      <WorkItemProgressTable
        items={[item]}
        variant="envasado"
        getFinishedQty={noop}
        getObservation={noop}
        onSelectItem={onSelectItem}
      />
    );
    fireEvent.click(screen.getByTestId("work-item-warning-badge"));
    expect(onSelectItem).toHaveBeenCalledTimes(1);
    expect(onSelectItem).toHaveBeenCalledWith(item);
  });

  it("Elaboración (granel) también recibe el mismo warning — misma tabla, mismo criterio", () => {
    const item = createTestWorkItem({
      id: "wi-elaboracion",
      sector: "ELABORACION",
      status: "en_curso",
      originStage: "ELABORACION",
      packagingLote: null,
      packagingVto: null,
      finishedQty: "480",
      quantity: "480",
    });
    render(
      <WorkItemProgressTable
        items={[item]}
        variant="elaboracion"
        getFinishedQty={noop}
        getObservation={noop}
        onSelectItem={() => {}}
      />
    );
    // Lote/VTO igual faltan en Elaboración -> advierte, pero nunca por packing (granel puro).
    const badge = screen.getByTestId("work-item-warning-badge");
    expect(badge.textContent).toContain("FALTA LOTE Y VTO");
  });

  it("no afecta el resto de la tabla: columnas, estado y acción siguen renderizando igual", () => {
    const item = createTestWorkItem({
      id: "wi-render",
      sector: "ENVASADO_MASIVO",
      status: "en_curso",
      originStage: "ACONDICIONAMIENTO",
      product: "SERUM TEST",
      client: "CLIENTE TEST",
    });
    render(
      <WorkItemProgressTable
        items={[item]}
        variant="envasado"
        showPackagingColumns
        getFinishedQty={noop}
        getObservation={noop}
        onSelectItem={() => {}}
      />
    );
    expect(screen.getByText("SERUM TEST")).toBeTruthy();
    expect(screen.getByText("CLIENTE TEST")).toBeTruthy();
    expect(screen.getByText("Ver / Registrar avance")).toBeTruthy();
  });
});
