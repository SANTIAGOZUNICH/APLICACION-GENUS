/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { LIST_CHUNK, OperationalTable } from "./operational-ui";

type R = { id: string; nombre: string };
const rows = (n: number): R[] => Array.from({ length: n }, (_, i) => ({ id: `r${i}`, nombre: `MP ${n - i}` }));
const columns = [{ key: "nombre", header: "Nombre", render: (r: R) => r.nombre }];

describe("OperationalTable continua (hoja única de Materias Primas)", () => {
  it("sin paginación: pocas filas → todas, en el MISMO orden recibido (no ordena por nombre)", () => {
    const { container } = render(<OperationalTable<R> tableId="t" continuous columns={columns} rows={rows(5)} rowKey={(r) => r.id} />);
    const names = [...container.querySelectorAll("tbody tr td")].map((td) => td.textContent);
    expect(names).toEqual(["MP 5", "MP 4", "MP 3", "MP 2", "MP 1"]);
    expect(screen.queryByText(/Página/)).toBeNull();
  });

  it("muchas filas: carga progresiva — arranca con una tanda y suma más al llegar al final, sin ocultar ni reordenar", () => {
    const { container } = render(<OperationalTable<R> tableId="t" continuous columns={columns} rows={rows(LIST_CHUNK * 3)} rowKey={(r) => r.id} />);
    const count = () => container.querySelectorAll("tbody tr").length;
    expect(count()).toBe(LIST_CHUNK);
    const sheet = container.querySelector('[data-testid="t-list-sheet"]') as HTMLElement;
    Object.defineProperty(sheet, "scrollHeight", { value: 10_000, configurable: true });
    Object.defineProperty(sheet, "clientHeight", { value: 500, configurable: true });
    sheet.scrollTop = 9_000;
    fireEvent.scroll(sheet);
    expect(count()).toBe(LIST_CHUNK * 2);
    fireEvent.scroll(sheet);
    expect(count()).toBe(LIST_CHUNK * 3);
    fireEvent.scroll(sheet);
    expect(count()).toBe(LIST_CHUNK * 3);
    // El primero sigue siendo el primero cargado.
    expect(container.querySelector("tbody tr td")?.textContent).toBe(`MP ${LIST_CHUNK * 3}`);
  });

  it("el marco de la hoja se desplaza (overflow-auto) con encabezado fijo", () => {
    const { container } = render(<OperationalTable<R> tableId="t" continuous columns={columns} rows={rows(3)} rowKey={(r) => r.id} />);
    expect(container.querySelector('[data-testid="t-list-sheet"]')?.className).toContain("overflow-auto");
    expect(container.querySelector("thead")?.className).toContain("sticky");
  });
});
