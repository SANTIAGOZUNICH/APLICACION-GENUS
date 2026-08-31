/**
 * @vitest-environment happy-dom
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SortSelect } from "./sort-select";

afterEach(() => {
  cleanup();
});

describe("SortSelect", () => {
  const options = [
    { key: "fecha_desc", label: "Más recientes" },
    { key: "fecha_asc", label: "Más antiguos" },
    { key: "numero_asc", label: "N° menor a mayor" },
  ];

  it("muestra todas las opciones y el valor seleccionado", () => {
    render(<SortSelect value="fecha_asc" onChange={() => {}} options={options} />);
    const select = screen.getByTestId("sort-select") as HTMLSelectElement;
    expect(select.value).toBe("fecha_asc");
    expect(screen.getByText("Más recientes")).toBeTruthy();
    expect(screen.getByText("Más antiguos")).toBeTruthy();
    expect(screen.getByText("N° menor a mayor")).toBeTruthy();
  });

  it("llama a onChange con la key elegida", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SortSelect value="fecha_desc" onChange={onChange} options={options} />);
    await user.selectOptions(screen.getByTestId("sort-select"), "numero_asc");
    expect(onChange).toHaveBeenCalledWith("numero_asc");
  });

  it("acepta un testId propio para convivir con varias instancias en la misma pantalla", () => {
    render(
      <SortSelect value="fecha_desc" onChange={() => {}} options={options} testId="sort-calidad-aprobados" />
    );
    expect(screen.getByTestId("sort-calidad-aprobados")).toBeTruthy();
  });
});
