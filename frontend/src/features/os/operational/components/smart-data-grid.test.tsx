/**
 * @vitest-environment happy-dom
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SmartDataGrid } from "./smart-data-grid";

afterEach(() => {
  cleanup();
});

interface Row {
  id: string;
  name: string;
}

function rows(n: number): Row[] {
  return Array.from({ length: n }, (_, i) => ({ id: String(i), name: `Fila ${i}` }));
}

const columns = [{ key: "name", label: "Nombre", render: (row: Row) => row.name, minWidth: 80 }];

describe("SmartDataGrid", () => {
  it("renderiza filas y respeta emptyMessage cuando no hay datos", () => {
    render(<SmartDataGrid columns={columns} rows={[]} rowKey={(r) => r.id} emptyMessage="Nada acá." />);
    expect(screen.getByText("Nada acá.")).toBeTruthy();
  });

  it("muestra todas las filas cuando están por debajo del umbral de virtualización", () => {
    render(<SmartDataGrid columns={columns} rows={rows(20)} rowKey={(r) => r.id} virtualizeThreshold={150} />);
    expect(screen.getAllByTestId("smart-grid-row")).toHaveLength(20);
    expect(screen.queryByTestId("smart-grid-virtualized-hint")).toBeNull();
  });

  it("Test 13/16 — tablas grandes: activa virtualización y sigue legible (no renderiza las 1000 filas de una)", () => {
    render(<SmartDataGrid columns={columns} rows={rows(1000)} rowKey={(r) => r.id} virtualizeThreshold={150} />);
    expect(screen.getByTestId("smart-grid-virtualized-hint").textContent).toContain("1000 filas");
    // Con virtualización, el DOM real tiene MUCHAS menos de 1000 filas montadas.
    expect(screen.getAllByTestId("smart-grid-row").length).toBeLessThan(200);
  });

  it("densidad y zoom cambian de estado al hacer click (sin romper el render)", () => {
    render(<SmartDataGrid columns={columns} rows={rows(5)} rowKey={(r) => r.id} />);
    fireEvent.click(screen.getByTestId("smart-grid-density-compacta"));
    fireEvent.click(screen.getByTestId("smart-grid-zoom-80"));
    expect(screen.getAllByTestId("smart-grid-row")).toHaveLength(5);
  });

  it("'Ajustar a pantalla' no rompe el render (columnas se redistribuyen)", () => {
    render(<SmartDataGrid columns={columns} rows={rows(5)} rowKey={(r) => r.id} />);
    fireEvent.click(screen.getByTestId("smart-grid-fit-to-screen"));
    expect(screen.getAllByTestId("smart-grid-row")).toHaveLength(5);
  });

  it("aplica el color de estado por fila (rowStatus)", () => {
    render(
      <SmartDataGrid
        columns={columns}
        rows={rows(2)}
        rowKey={(r) => r.id}
        rowStatus={(r) => (r.id === "0" ? "error" : "valido")}
      />
    );
    const rendered = screen.getAllByTestId("smart-grid-row");
    expect(rendered[0]!.getAttribute("data-status")).toBe("error");
    expect(rendered[1]!.getAttribute("data-status")).toBe("valido");
  });
});
