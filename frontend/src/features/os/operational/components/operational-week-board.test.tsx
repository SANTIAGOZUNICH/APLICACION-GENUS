/**
 * @vitest-environment happy-dom
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DndContext } from "@dnd-kit/core";
import {
  OperationalWeekBoard,
  parseWeekBoardDropId,
  weekBoardDropId,
} from "./operational-week-board";
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

describe("weekBoardDropId / parseWeekBoardDropId — codificación del id de drop", () => {
  it("hace round-trip zona::día", () => {
    const id = weekBoardDropId("2", "2026-08-26");
    expect(id).toBe("2::2026-08-26");
    expect(parseWeekBoardDropId(id)).toEqual({ zone: "2", day: "2026-08-26" });
  });

  it("devuelve null para un id sin separador", () => {
    expect(parseWeekBoardDropId("sin-separador")).toBeNull();
  });
});

/**
 * Bloque 4 — drag & drop de replanificación (solo Producción, opt-in vía
 * `draggable`). Las tarjetas movibles quedan draggable; una entregada/
 * enviada a Calidad/Codificado no. La grilla por defecto (draggable=false,
 * usada por Elaboración/consulta hoy) no cambia — ya cubierto arriba.
 */
describe("OperationalWeekBoard — draggable (drag & drop de Producción)", () => {
  it("con draggable=false (default) las tarjetas no se envuelven en el wrapper draggable", () => {
    const item = createTestWorkItem({ id: "wi-nodrag", sector: "ENVASADO_MASIVO", plannedDate: "2026-08-24", status: "pendiente" });
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
    expect(screen.queryByTestId("week-board-draggable-card")).toBeNull();
  });

  it("con draggable=true, una tarjeta pendiente queda arrastrable (cursor-grab)", () => {
    const item = createTestWorkItem({ id: "wi-drag-1", sector: "ENVASADO_MASIVO", plannedDate: "2026-08-24", status: "pendiente" });
    render(
      <DndContext onDragEnd={() => {}}>
        <OperationalWeekBoard
          weekDays={weekDays}
          today="2026-08-24"
          selectedDate="2026-08-24"
          items={[item]}
          onSelectDay={() => {}}
          richCards
          draggable
          dropZoneId="1"
        />
      </DndContext>
    );
    const wrapper = screen.getByTestId("week-board-draggable-card");
    expect(wrapper.className).toContain("cursor-grab");
  });

  it("10) un trabajo entregado NO queda arrastrable aunque draggable=true", () => {
    const item = createTestWorkItem({ id: "wi-entregado", sector: "ENVASADO_MASIVO", plannedDate: "2026-08-24", status: "entregado" });
    render(
      <DndContext onDragEnd={() => {}}>
        <OperationalWeekBoard
          weekDays={weekDays}
          today="2026-08-24"
          selectedDate="2026-08-24"
          items={[item]}
          onSelectDay={() => {}}
          richCards
          draggable
          dropZoneId="1"
        />
      </DndContext>
    );
    const wrapper = screen.getByTestId("week-board-draggable-card");
    expect(wrapper.className).not.toContain("cursor-grab");
  });

  it("con draggable=true, el día sigue siendo clickeable (onSelectDay)", () => {
    let clicked: string | null = null;
    render(
      <DndContext onDragEnd={() => {}}>
        <OperationalWeekBoard
          weekDays={weekDays}
          today="2026-08-24"
          selectedDate="2026-08-24"
          items={[]}
          onSelectDay={(day) => {
            clicked = day;
          }}
          draggable
          dropZoneId="1"
        />
      </DndContext>
    );
    const cell = screen.getByTestId(`week-board-daycell-${weekBoardDropId("1", "2026-08-26")}`);
    cell.click();
    expect(clicked).toBe("2026-08-26");
  });
});

/**
 * Bloque 1 — botón "+" de asignación directa por celda día/línea. Investigado:
 * una celda ya acepta múltiples trabajos (dayItems es un array, sin límite
 * de a 1) — así que el "+" se muestra siempre que canCreate, no solo cuando
 * la celda está vacía.
 */
describe("OperationalWeekBoard — botón + de asignación directa por celda", () => {
  it("1) canCreate=false (default): no se muestra ningún +", () => {
    render(
      <OperationalWeekBoard
        weekDays={weekDays}
        today="2026-08-24"
        selectedDate="2026-08-24"
        items={[]}
        onSelectDay={() => {}}
      />
    );
    expect(screen.queryByTestId(`week-board-create-${weekBoardDropId("default", "2026-08-26")}`)).toBeNull();
  });

  it("2) Envasado (rol sin permiso): con canCreate=false el + no aparece aunque draggable=true", () => {
    render(
      <DndContext onDragEnd={() => {}}>
        <OperationalWeekBoard
          weekDays={weekDays}
          today="2026-08-24"
          selectedDate="2026-08-24"
          items={[]}
          onSelectDay={() => {}}
          draggable
          canCreate={false}
          dropZoneId="1"
        />
      </DndContext>
    );
    expect(screen.queryByTestId(`week-board-create-${weekBoardDropId("1", "2026-08-26")}`)).toBeNull();
  });

  it("Producción (canCreate=true): el + aparece en una celda vacía Y en una con trabajos (acepta múltiples)", () => {
    const item = createTestWorkItem({
      id: "wi-existing",
      sector: "ENVASADO_MASIVO",
      plannedDate: "2026-08-24",
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
        canCreate
        dropZoneId="1"
        onCreateSlot={() => {}}
      />
    );
    // Día con trabajo (24) y día vacío (25) — ambos con +.
    expect(screen.getByTestId(`week-board-create-${weekBoardDropId("1", "2026-08-24")}`)).toBeTruthy();
    expect(screen.getByTestId(`week-board-create-${weekBoardDropId("1", "2026-08-25")}`)).toBeTruthy();
  });

  it("3/4) click en + de Miércoles·Línea 2 dispara onCreateSlot con day=2026-08-26 y zone='2', sin disparar onSelectDay", async () => {
    const user = userEvent.setup();
    const onCreateSlot = vi.fn();
    const onSelectDay = vi.fn();
    render(
      <OperationalWeekBoard
        weekDays={weekDays}
        today="2026-08-24"
        selectedDate="2026-08-24"
        items={[]}
        onSelectDay={onSelectDay}
        canCreate
        dropZoneId="2"
        onCreateSlot={onCreateSlot}
      />
    );
    const plusButton = screen.getByTestId(`week-board-create-${weekBoardDropId("2", "2026-08-26")}`);
    await user.click(plusButton);
    expect(onCreateSlot).toHaveBeenCalledWith("2026-08-26", "2");
    expect(onSelectDay).not.toHaveBeenCalled();
  });

  it("modo consulta: nunca muestra + aunque canCreate=true (no aplica a planes compartidos RO)", () => {
    render(
      <OperationalWeekBoard
        weekDays={weekDays}
        today="2026-08-24"
        selectedDate="2026-08-24"
        items={[]}
        onSelectDay={() => {}}
        mode="consulta"
        consultaItems={[]}
        canCreate
        dropZoneId="1"
      />
    );
    expect(screen.queryByTestId(`week-board-create-${weekBoardDropId("1", "2026-08-26")}`)).toBeNull();
  });
});
