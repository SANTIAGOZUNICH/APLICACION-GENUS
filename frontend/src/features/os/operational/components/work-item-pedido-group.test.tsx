/**
 * @vitest-environment happy-dom
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestWorkItem } from "@/lib/__fixtures__/work-item.factory";
import type { WorkItem } from "@/types/operational/work-item";
import { WorkItemProgressTable } from "./work-item-progress-table";

afterEach(cleanup);

const noop = () => "";
const nat = (n: string, over: Partial<WorkItem> = {}) =>
  createTestWorkItem({ id: `native:${n}`, sector: "ENVASADO_MASIVO", client: "CLIENTE A", product: "CREMA", quantity: "1000", unit: "u", status: "pendiente", pedidoRef: "ped-125", pedidoOp: "125", plannedDate: "2026-11-02", ...over });
const three = () => [nat("a", { quantity: "2000", plannedDate: "2026-11-02" }), nat("b", { quantity: "3000", plannedDate: "2026-11-04" }), nat("c", { quantity: "1000", plannedDate: "2026-11-06" })];
const table = (items: WorkItem[], extra: { groupByPedido?: boolean; onSelectItem?: (i: WorkItem) => void } = {}) => (
  <WorkItemProgressTable items={items} variant="envasado" getFinishedQty={noop} getObservation={noop} onSelectItem={extra.onSelectItem ?? (() => {})} groupByPedido={extra.groupByPedido} />
);

describe("Pendientes de Envasado: una tarjeta por pedido (solo presentación)", () => {
  it("tres trabajos del mismo pedido → UNA tarjeta general con total y cantidad de trabajos", () => {
    render(table(three(), { groupByPedido: true }));
    expect(screen.getAllByTestId("work-item-pedido-group")).toHaveLength(1);
    expect(screen.queryAllByTestId("work-item-card")).toHaveLength(0); // plegada: los trabajos están adentro
    expect(screen.getByTestId("pedido-group-label").textContent).toBe("Pedido 125");
    expect(screen.getByTestId("pedido-group-total").textContent).toContain("6.000");
    expect(screen.getByTestId("pedido-group-count").textContent).toBe("3 trabajos pendientes");
  });

  it("al abrirla muestra los tres trabajos individuales con sus acciones; «Ver / Registrar avance» abre SOLO ese trabajo", () => {
    const onSelect = vi.fn();
    render(table(three(), { groupByPedido: true, onSelectItem: onSelect }));
    fireEvent.click(screen.getByRole("button", { name: /Ver trabajos \(3\)/ }));
    const cards = screen.getAllByTestId("work-item-card");
    expect(cards.map((c) => c.getAttribute("data-item-id"))).toEqual(["native:a", "native:b", "native:c"]);
    fireEvent.click(within(cards[1]!).getByRole("button", { name: /Ver \/ Registrar avance/ }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0]![0].id).toBe("native:b");
  });

  it("sin la opción (Semana y demás vistas) cada trabajo sigue siendo su propia tarjeta: nada cambia", () => {
    render(table(three()));
    expect(screen.queryAllByTestId("work-item-pedido-group")).toHaveLength(0);
    expect(screen.getAllByTestId("work-item-card")).toHaveLength(3);
  });

  it("dos pedidos del mismo cliente → dos tarjetas; sin pedido vinculado → no se agrupa", () => {
    const items = [nat("a"), nat("b"), nat("c", { pedidoRef: "ped-126", pedidoOp: "126" }), nat("d", { pedidoRef: "ped-126", pedidoOp: "126" }), nat("e", { pedidoRef: null }), nat("f", { pedidoRef: null })];
    render(table(items, { groupByPedido: true }));
    expect(screen.getAllByTestId("work-item-pedido-group").map((g) => g.getAttribute("data-pedido-ref"))).toEqual(["ped-125", "ped-126"]);
    expect(screen.getAllByTestId("work-item-card")).toHaveLength(2); // e y f, sueltos
  });

  it("un trabajo completado sale de la lista: el grupo muestra 2 trabajos y el total pendiente nuevo; sin pendientes, desaparece", () => {
    const { rerender } = render(table(three(), { groupByPedido: true }));
    rerender(table(three().slice(1), { groupByPedido: true })); // «a» (2.000) se completó: ya no es pendiente
    expect(screen.getByTestId("pedido-group-count").textContent).toBe("2 trabajos pendientes");
    expect(screen.getByTestId("pedido-group-total").textContent).toContain("4.000");
    rerender(table(three().slice(2), { groupByPedido: true })); // queda uno: vuelve a ser una tarjeta individual
    expect(screen.queryAllByTestId("work-item-pedido-group")).toHaveLength(0);
    expect(screen.getAllByTestId("work-item-card")).toHaveLength(1);
    rerender(table([], { groupByPedido: true }));
    expect(screen.queryAllByTestId("work-item-pedido-group")).toHaveLength(0);
    expect(screen.queryAllByTestId("work-item-card")).toHaveLength(0);
  });
});
