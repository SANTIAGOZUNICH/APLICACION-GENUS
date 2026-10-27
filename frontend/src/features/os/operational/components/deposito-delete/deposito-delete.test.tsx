/**
 * @vitest-environment happy-dom
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { bulkResultMessage, useDepositoDelete, type DepositoBulkResult } from "./use-deposito-delete";

afterEach(cleanup);

const ok = (ids: string[]): DepositoBulkResult => ({ requested: ids.length, deleted: ids, skipped: [], failed: [] });

function setup(visible = ["a", "b", "c", "d", "e", "f"], tableCount = 40) {
  const deleteIds = vi.fn(async (ids: string[]) => ok(ids));
  const deleteAll = vi.fn(async () => ok(Array.from({ length: tableCount }, (_, i) => `t${i}`)));
  const afterDelete = vi.fn(async () => undefined);
  const hook = renderHook(
    ({ ids }) => useDepositoDelete({ canWrite: true, visibleIds: ids, tableCount, noun: "ingresos", deleteIds, deleteAll, afterDelete }),
    { initialProps: { ids: visible } }
  );
  const ui = () => render(<div>{hook.result.current.bar}</div>);
  return { hook, ui, deleteIds, deleteAll, afterDelete };
}

describe("useDepositoDelete — selección y alcances", () => {
  it("sin permiso de escritura no hay casillas ni barra", () => {
    const { result } = renderHook(() => useDepositoDelete({ canWrite: false, visibleIds: ["a"], tableCount: 1, noun: "x", deleteIds: async () => ok([]), deleteAll: async () => ok([]), afterDelete: async () => undefined }));
    expect(result.current.rowCheck).toBeUndefined();
    expect(result.current.bar).toBeNull();
  });

  it("selecciona filas no consecutivas, todas las visibles y cancela", () => {
    const { hook } = setup();
    act(() => hook.result.current.rowCheck!.onToggle("a"));
    act(() => hook.result.current.rowCheck!.onToggle("d"));
    expect([...hook.result.current.rowCheck!.checked]).toEqual(["a", "d"]);
    act(() => hook.result.current.rowCheck!.onToggleAll());
    expect(hook.result.current.rowCheck!.allChecked).toBe(true);
    expect(hook.result.current.selectedCount).toBe(6);
    act(() => hook.result.current.clear());
    expect(hook.result.current.selectedCount).toBe(0);
  });

  it("un filtro nunca deja seleccionado (ni borra) lo que ya no se ve", () => {
    const { hook } = setup();
    act(() => hook.result.current.rowCheck!.onToggleAll());
    expect(hook.result.current.selectedCount).toBe(6);
    hook.rerender({ ids: ["a", "b"] });
    expect(hook.result.current.selectedCount).toBe(2);
    hook.rerender({ ids: ["a", "b", "c", "d", "e", "f"] });
    expect(hook.result.current.selectedCount).toBe(2); // lo que salió de la vista no vuelve a quedar marcado solo
  });

  it("Eliminar seleccionadas: una sola confirmación con la cantidad y manda solo esos ids", async () => {
    const { hook, ui, deleteIds, afterDelete } = setup();
    act(() => hook.result.current.rowCheck!.onToggle("b"));
    act(() => hook.result.current.rowCheck!.onToggle("e"));
    const view = ui();
    expect(screen.getByTestId("deposito-delete-count").textContent).toBe("2 filas seleccionadas");
    fireEvent.click(screen.getByTestId("deposito-delete-selected"));
    expect(screen.getByRole("dialog").textContent).toContain("Eliminar 2 registros seleccionados");
    expect(screen.queryByPlaceholderText(/motivo/i)).toBeNull();
    fireEvent.click(screen.getByTestId("deposito-delete-confirm"));
    await waitFor(() => expect(deleteIds).toHaveBeenCalledWith(["b", "e"]));
    await waitFor(() => expect(afterDelete).toHaveBeenCalled());
    expect(hook.result.current.selectedCount).toBe(0);
    view.unmount();
  });

  it("visibles y toda la tabla son opciones distintas con su propio conteo", async () => {
    const { hook, ui, deleteIds, deleteAll } = setup(["a", "b", "c"], 40);
    ui();
    fireEvent.click(screen.getByTestId("deposito-delete-all-menu"));
    fireEvent.click(screen.getByTestId("deposito-delete-visible"));
    expect(screen.getByRole("dialog").textContent).toContain("Eliminar las 3 filas visibles");
    fireEvent.click(screen.getByTestId("deposito-delete-confirm"));
    await waitFor(() => expect(deleteIds).toHaveBeenCalledWith(["a", "b", "c"]));
    expect(deleteAll).not.toHaveBeenCalled();

    cleanup();
    ui();
    fireEvent.click(screen.getByTestId("deposito-delete-all-menu"));
    fireEvent.click(screen.getByTestId("deposito-delete-table"));
    expect(screen.getByRole("dialog").textContent).toContain("Eliminar TODOS los registros de la tabla (40)");
    expect(screen.getByRole("dialog").textContent).toContain("también los que hoy no se ven");
    fireEvent.click(screen.getByTestId("deposito-delete-confirm"));
    await waitFor(() => expect(deleteAll).toHaveBeenCalledTimes(1));
    expect(hook.result.current.selectedCount).toBe(0);
  });

  it("cancelar la confirmación no elimina nada", () => {
    const { hook, ui, deleteIds, deleteAll } = setup();
    act(() => hook.result.current.rowCheck!.onToggle("a"));
    ui();
    fireEvent.click(screen.getByTestId("deposito-delete-selected"));
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(deleteIds).not.toHaveBeenCalled();
    expect(deleteAll).not.toHaveBeenCalled();
  });

  it("fallo parcial: informa cuántos fallaron y cómo reintentar; el error total no deja la tabla desactualizada", async () => {
    const deleteIds = vi.fn(async (ids: string[]): Promise<DepositoBulkResult> => ({ requested: ids.length, deleted: [ids[0]!], skipped: [], failed: [{ id: ids[1]!, message: "boom" }] }));
    const afterDelete = vi.fn(async () => undefined);
    const onMessage = vi.fn();
    const hook = renderHook(() => useDepositoDelete({ canWrite: true, visibleIds: ["a", "b"], tableCount: 2, noun: "ingresos", deleteIds, deleteAll: async () => ok([]), afterDelete, onMessage }));
    act(() => hook.result.current.rowCheck!.onToggleAll());
    render(<div>{hook.result.current.bar}</div>);
    fireEvent.click(screen.getByTestId("deposito-delete-selected"));
    fireEvent.click(screen.getByTestId("deposito-delete-confirm"));
    await waitFor(() => expect(onMessage).toHaveBeenCalled());
    expect(onMessage.mock.calls[0]![0]).toMatch(/1 ingresos? eliminado.*1 con error \(boom\).*volver a intentarlo/);

    deleteIds.mockRejectedValueOnce(new Error("sin conexión"));
    act(() => hook.result.current.rowCheck!.onToggleAll());
    cleanup();
    render(<div>{hook.result.current.bar}</div>);
    fireEvent.click(screen.getByTestId("deposito-delete-selected"));
    fireEvent.click(screen.getByTestId("deposito-delete-confirm"));
    await waitFor(() => expect(onMessage).toHaveBeenLastCalledWith("sin conexión"));
    expect(afterDelete.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

describe("bulkResultMessage", () => {
  it("redacta eliminados, omitidos y errores", () => {
    expect(bulkResultMessage(ok(["a"]), "ingresos")).toBe("1 ingresos eliminado.");
    expect(bulkResultMessage({ requested: 3, deleted: ["a", "b"], skipped: ["c"], failed: [] }, "ingresos")).toBe("2 ingresos eliminados · 1 ya no estaban.");
  });
});
