/**
 * @vitest-environment happy-dom
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { OperationalWeekBoard } from "./operational-week-board";
import { createTestWorkItem } from "@/lib/__fixtures__/work-item.factory";

afterEach(() => {
  cleanup();
});

const weekDays = ["2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28"];

/**
 * Bloque 2/8/9 — layout de Semanas: tarjetas ricas (richCards) muestran
 * Producto/Cliente/Cantidad/Lote/VTO/OA/Estado/Entrega sin comprimir, el
 * modo por defecto (usado por Elaboración/consulta) queda intacto, y un día
 * sin trabajos muestra "Sin trabajos" en vez de un bloque vacío.
 */
describe("OperationalWeekBoard — richCards (Envasado Semanas)", () => {
  it("richCards=true muestra Producto, Cliente, Cantidad, Lote/VTO/OA y Estado", () => {
    const item = createTestWorkItem({
      id: "wi-1",
      sector: "ENVASADO_MASIVO",
      plannedDate: "2026-08-24",
      product: "Shampoo Anticaspa",
      client: "Cosmética del Sur S.A.",
      quantity: "2400",
      unit: "un.",
      packagingLote: "L26001",
      packagingVto: "08/2027",
      oaRef: "OA-2026-000101",
      deliveryDate: "2026-08-26",
      status: "pendiente",
    });

    render(
      <OperationalWeekBoard
        weekDays={weekDays}
        today="2026-08-24"
        selectedDate="2026-08-24"
        items={[item]}
        onSelectDay={() => {}}
        richCards
      />
    );

    expect(screen.getByText("Shampoo Anticaspa")).toBeTruthy();
    expect(screen.getByText("Cosmética del Sur S.A.")).toBeTruthy();
    expect(screen.getByText("2400 un.")).toBeTruthy();
    expect(screen.getByText(/Lote L26001/)).toBeTruthy();
    expect(screen.getByText(/VTO 08\/2027/)).toBeTruthy();
    expect(screen.getByText(/OA-2026-000101/)).toBeTruthy();
  });

  it("día sin trabajos muestra 'Sin trabajos', no un bloque vacío", () => {
    render(
      <OperationalWeekBoard
        weekDays={weekDays}
        today="2026-08-24"
        selectedDate="2026-08-24"
        items={[]}
        onSelectDay={() => {}}
        richCards
      />
    );
    expect(screen.getAllByText("Sin trabajos")).toHaveLength(weekDays.length);
  });

  it("richCards=false (default) mantiene el formato mínimo existente — sin romper Elaboración/consulta", () => {
    const item = createTestWorkItem({
      id: "wi-2",
      sector: "ELABORACION",
      plannedDate: "2026-08-24",
      product: "Base Crema",
      client: "Cliente Y",
      quantity: "50",
      ownerPerson: "Cristian",
      line: null,
    });

    render(
      <OperationalWeekBoard
        weekDays={weekDays}
        today="2026-08-24"
        selectedDate="2026-08-24"
        items={[item]}
        onSelectDay={() => {}}
      />
    );

    expect(screen.getByText("Base Crema")).toBeTruthy();
    // El formato viejo no arma la línea "Lote ... · VTO ..." — no debe aparecer.
    expect(screen.queryByText(/VTO/)).toBeNull();
  });

  it("cada trabajo aparece en el día que le corresponde (no se mezclan días)", () => {
    const monday = createTestWorkItem({
      id: "wi-mon",
      sector: "ENVASADO_MASIVO",
      plannedDate: "2026-08-24",
      product: "Producto Lunes",
    });
    const wednesday = createTestWorkItem({
      id: "wi-wed",
      sector: "ENVASADO_MASIVO",
      plannedDate: "2026-08-26",
      product: "Producto Miércoles",
    });

    render(
      <OperationalWeekBoard
        weekDays={weekDays}
        today="2026-08-24"
        selectedDate="2026-08-24"
        items={[monday, wednesday]}
        onSelectDay={() => {}}
        richCards
      />
    );

    expect(screen.getByText("Producto Lunes")).toBeTruthy();
    expect(screen.getByText("Producto Miércoles")).toBeTruthy();
  });
});
