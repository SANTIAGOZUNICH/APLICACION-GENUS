/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  bulkDeleteConfirmMessage,
  useListSelectionMode,
} from "./list-selection-mode";

describe("useListSelectionMode", () => {
  it("no selecciona fuera del modo activo", () => {
    const { result } = renderHook(() => useListSelectionMode(["a", "b"]));
    act(() => result.current.toggle("a"));
    expect(result.current.selectedCount).toBe(0);
    expect(result.current.active).toBe(false);
  });

  it("entra en modo y permite toggle / select all / deselect / cancel", () => {
    const { result } = renderHook(() => useListSelectionMode(["a", "b", "c"]));
    act(() => result.current.enter());
    expect(result.current.active).toBe(true);
    expect(result.current.selectedCount).toBe(0);

    act(() => result.current.toggle("a"));
    act(() => result.current.toggle("b"));
    expect(result.current.selectedCount).toBe(2);
    expect(result.current.isSelected("a")).toBe(true);

    act(() => result.current.toggle("a"));
    expect(result.current.isSelected("a")).toBe(false);

    act(() => result.current.selectAllVisible());
    expect(result.current.selectedCount).toBe(3);

    act(() => result.current.deselectAll());
    expect(result.current.selectedCount).toBe(0);

    act(() => result.current.selectAllVisible());
    act(() => result.current.cancel());
    expect(result.current.active).toBe(false);
    expect(result.current.selectedCount).toBe(0);
  });

  it("selectAllVisible solo usa ids visibles", () => {
    const { result, rerender } = renderHook(
      ({ ids }) => useListSelectionMode(ids),
      { initialProps: { ids: ["a", "b"] } }
    );
    act(() => result.current.enter());
    act(() => result.current.selectAllVisible());
    expect([...result.current.selectedIds].sort()).toEqual(["a", "b"]);
    rerender({ ids: ["b"] });
    expect([...result.current.selectedIds]).toEqual(["b"]);
  });
});

describe("bulkDeleteConfirmMessage", () => {
  it("incluye cantidad", () => {
    expect(bulkDeleteConfirmMessage(8)).toContain("8 registros");
    expect(bulkDeleteConfirmMessage(1)).toContain("1 registro");
    expect(bulkDeleteConfirmMessage(8)).toContain("no se puede deshacer");
  });
});
