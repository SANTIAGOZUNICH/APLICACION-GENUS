/**
 * @vitest-environment happy-dom
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { useBulkSelection, selectedCountLabel } from "./use-bulk-selection";
import { BulkSelectionBar } from "./bulk-selection-bar";
import { BulkDeleteDialog } from "./bulk-delete-dialog";

afterEach(cleanup);

describe("useBulkSelection", () => {
  it("selecciona uno, varios, todos los visibles y deselecciona", () => {
    const { result } = renderHook(() => useBulkSelection(["a", "b", "c"]));
    act(() => result.current.toggle("a"));
    expect(result.current.count).toBe(1);
    expect(result.current.someSelected).toBe(true);
    act(() => result.current.toggleAllVisible());
    expect(result.current.count).toBe(3);
    expect(result.current.allVisibleSelected).toBe(true);
    act(() => result.current.toggleAllVisible());
    expect(result.current.count).toBe(0);
    act(() => result.current.toggle("b"));
    act(() => result.current.clear());
    expect(result.current.count).toBe(0);
  });

  it("nunca conserva selección de registros que ya no están visibles (filtro/página)", () => {
    const { result, rerender } = renderHook(({ ids }) => useBulkSelection(ids), { initialProps: { ids: ["a", "b", "c"] } });
    act(() => result.current.toggleAllVisible());
    expect(result.current.selected).toEqual(["a", "b", "c"]);
    rerender({ ids: ["b"] });
    expect(result.current.selected).toEqual(["b"]);
    // «seleccionar todos» solo toma los visibles actuales
    act(() => result.current.clear());
    act(() => result.current.toggleAllVisible());
    rerender({ ids: ["a", "b", "c", "d"] });
    expect(result.current.selected).toEqual(["b"]);
  });

  it("etiqueta singular/plural", () => {
    expect(selectedCountLabel(1)).toBe("1 registro seleccionado");
    expect(selectedCountLabel(3)).toBe("3 registros seleccionados");
  });
});

describe("BulkSelectionBar", () => {
  function Host({ canDelete = true, onDelete = vi.fn() }) {
    const sel = useBulkSelection(["a", "b"]);
    return (
      <div>
        <button onClick={() => sel.toggle("a")}>sel-a</button>
        <BulkSelectionBar selection={sel} scopeLabel="de 2 visibles" canDelete={canDelete} onDelete={onDelete} />
      </div>
    );
  }
  it("no aparece sin selección y muestra contador + alcance + botón con la cantidad", () => {
    render(<Host />);
    expect(screen.queryByTestId("bulk-bar")).toBeNull();
    fireEvent.click(screen.getByText("sel-a"));
    expect(screen.getByTestId("bulk-count").textContent).toBe("1 registro seleccionado");
    expect(screen.getByTestId("bulk-scope").textContent).toContain("2 visibles");
    expect(screen.getByTestId("bulk-delete").textContent).toBe("Eliminar seleccionados (1)");
  });
  it("sin permiso no ofrece eliminar", () => {
    render(<Host canDelete={false} />);
    fireEvent.click(screen.getByText("sel-a"));
    expect(screen.queryByTestId("bulk-delete")).toBeNull();
  });
});

describe("BulkDeleteDialog", () => {
  const items = [
    { id: "1", label: "Crema", detail: "Cliente A" },
    { id: "2", label: "Shampoo", detail: "Cliente B" },
  ];
  const verdicts = [
    { id: "1", code: "ELIGIBLE" as const, reason: "" },
    { id: "2", code: "BLOCKED_IN_REMITO" as const, reason: "Está incluido en un remito: se conserva por historial." },
  ];
  it("muestra incluidos, excluidos con motivo y advertencia; no confirma sin motivo", () => {
    const onConfirm = vi.fn();
    render(<BulkDeleteDialog open onOpenChange={() => {}} items={items} verdicts={verdicts} onConfirm={onConfirm} entityPlural="trabajos" />);
    expect(screen.getByTestId("bulk-delete-warning").textContent).toMatch(/información operativa/);
    expect(screen.getByTestId("bulk-delete-included").textContent).toContain("Crema");
    expect(screen.getByTestId("bulk-delete-excluded").textContent).toMatch(/Shampoo.*remito/);
    const confirm = screen.getByTestId("bulk-delete-confirm") as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(screen.getByTestId("bulk-delete-reason"), { target: { value: "Duplicados" } });
    expect(confirm.disabled).toBe(false);
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledWith("Duplicados");
  });
  it("Cancelar no elimina y mientras verifica no deja confirmar", () => {
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    render(<BulkDeleteDialog open onOpenChange={onOpenChange} items={items} verdicts={null} onConfirm={onConfirm} />);
    expect((screen.getByTestId("bulk-delete-confirm") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId("bulk-delete-cancel"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onConfirm).not.toHaveBeenCalled();
  });
  it("si nada es eliminable, confirmar queda deshabilitado", () => {
    render(
      <BulkDeleteDialog open onOpenChange={() => {}} items={[items[1]!]} verdicts={[verdicts[1]!]} onConfirm={vi.fn()} />
    );
    fireEvent.change(screen.getByTestId("bulk-delete-reason"), { target: { value: "x" } });
    expect((screen.getByTestId("bulk-delete-confirm") as HTMLButtonElement).disabled).toBe(true);
  });
});
