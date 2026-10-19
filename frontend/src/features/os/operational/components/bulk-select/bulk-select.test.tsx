/**
 * @vitest-environment happy-dom
 */
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
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
    const { result, rerender } = renderHook(
      ({ ids }) => useBulkSelection(ids),
      { initialProps: { ids: ["a", "b", "c"] } },
    );
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
  function Host({ canDelete = true, onDelete = vi.fn(), onDeliver = vi.fn(), onSendCodificado = vi.fn() }) {
    const sel = useBulkSelection(["a", "b"]);
    return (
      <div>
        <button onClick={() => sel.toggle("a")}>sel-a</button>
        <BulkSelectionBar
          selection={sel}
          scopeLabel="de 2 visibles"
          onDelete={canDelete ? onDelete : undefined}
          onDeliver={onDeliver}
          onSendCodificado={onSendCodificado}
        />
      </div>
    );
  }
  it("no aparece sin selección y muestra contador + alcance + botón con la cantidad", () => {
    render(<Host />);
    expect(screen.queryByTestId("bulk-bar")).toBeNull();
    fireEvent.click(screen.getByText("sel-a"));
    expect(screen.getByTestId("bulk-count").textContent).toBe(
      "1 registro seleccionado",
    );
    expect(screen.getByTestId("bulk-scope").textContent).toContain(
      "2 visibles",
    );
    expect(screen.getByTestId("bulk-delete").textContent).toBe(
      "Eliminar seleccionados (1)",
    );
  });
  it("ofrece las tres acciones con la cantidad y «Deseleccionar»", () => {
    render(<Host />);
    fireEvent.click(screen.getByText("sel-a"));
    expect(screen.getByTestId("bulk-deliver").textContent).toBe("Marcar como entregados (1)");
    expect(screen.getByTestId("bulk-codificado").textContent).toBe("Enviar a Codificado (1)");
    expect(screen.getByTestId("bulk-delete").textContent).toBe("Eliminar seleccionados (1)");
    expect(screen.getByTestId("bulk-clear").textContent).toBe("Deseleccionar");
    // los botones se distribuyen en varias líneas en tablets angostas
    expect(screen.getByTestId("bulk-bar").className).toContain("flex-wrap");
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
    {
      id: "2",
      code: "BLOCKED_IN_REMITO" as const,
      reason: "Está incluido en un remito: se conserva por historial.",
    },
  ];
  it("muestra incluidos, excluidos con motivo y advertencia; no confirma sin motivo", () => {
    const onConfirm = vi.fn();
    render(
      <BulkDeleteDialog
        open
        onOpenChange={() => {}}
        items={items}
        verdicts={verdicts}
        onConfirm={onConfirm}
        entityPlural="trabajos"
      />,
    );
    expect(screen.getByTestId("bulk-delete-warning").textContent).toMatch(
      /información operativa/,
    );
    expect(screen.getByTestId("bulk-delete-included").textContent).toContain(
      "Crema",
    );
    expect(screen.getByTestId("bulk-delete-excluded").textContent).toMatch(
      /Shampoo.*remito/,
    );
    const confirm = screen.getByTestId(
      "bulk-delete-confirm",
    ) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(screen.getByTestId("bulk-delete-reason"), {
      target: { value: "Duplicados" },
    });
    expect(confirm.disabled).toBe(false);
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledWith("Duplicados");
  });
  it("Cancelar no elimina y mientras verifica no deja confirmar", () => {
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <BulkDeleteDialog
        open
        onOpenChange={onOpenChange}
        items={items}
        verdicts={null}
        onConfirm={onConfirm}
      />,
    );
    expect(
      (screen.getByTestId("bulk-delete-confirm") as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByTestId("bulk-delete-cancel"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onConfirm).not.toHaveBeenCalled();
  });
  it("si nada es eliminable, confirmar queda deshabilitado", () => {
    render(
      <BulkDeleteDialog
        open
        onOpenChange={() => {}}
        items={[items[1]!]}
        verdicts={[verdicts[1]!]}
        onConfirm={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByTestId("bulk-delete-reason"), {
      target: { value: "x" },
    });
    expect(
      (screen.getByTestId("bulk-delete-confirm") as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});

describe("estilos de selección (tema oscuro)", () => {
  it("la fila seleccionada usa turquesa translúcido y nunca fondos claros ni cambia su tamaño", async () => {
    const { bulkRowClassName } = await import("./bulk-select-checkbox");
    const on = bulkRowClassName(true);
    expect(bulkRowClassName(false)).toBe("");
    expect(on).toContain("rgb(18_191_183_/_0.12)");
    expect(on).toContain("inset_3px_0_0_0");
    // sin fondos blancos/claros, sin padding/borde/alto que muevan la fila
    expect(on).not.toMatch(/white|#fff|e8f3ec|primary-soft|\bp[xytblr]?-|\bh-|border-/);
  });
  it("ningún componente del kit referencia variables inexistentes (causa del fondo claro)", async () => {
    const { readFileSync, readdirSync } = await import("node:fs");
    const dir = `${process.cwd()}/src/features/os/operational/components/bulk-select/`;
    for (const f of readdirSync(dir).filter((x) => /\.(tsx|ts)$/.test(x) && !x.includes("test"))) {
      const src = readFileSync(dir + f, "utf8");
      expect(src, f).not.toMatch(/--genus-primary|genus-warning-soft|genus-error-soft/);
    }
  });
});

describe("BulkPendingActionDialog", () => {
  const items = [
    { id: "a", label: "Crema", detail: "Cli A", defaultTotal: 100, unit: "un" },
    { id: "b", label: "Gel", detail: "Cli B", defaultTotal: 50, unit: "un" },
  ];
  const verdicts = [
    { id: "a", code: "ELIGIBLE" as const, reason: "", outcome: "Entrega completa: 100 un" },
    { id: "b", code: "REJECTED" as const, reason: "Este trabajo ya tiene su entrega completa." },
  ];
  it("entregar: lista incluidos/excluidos con motivo, pide fecha obligatoria y confirma una sola vez", async () => {
    const { BulkPendingActionDialog } = await import("./bulk-pending-action-dialog");
    const onConfirm = vi.fn();
    render(<BulkPendingActionDialog open onOpenChange={() => {}} action="DELIVER" items={items} verdicts={verdicts} onConfirm={onConfirm} />);
    expect(screen.getByTestId("bulk-action-included").textContent).toContain("Crema");
    expect(screen.getByTestId("bulk-action-excluded").textContent).toMatch(/Gel.*entrega completa/);
    expect(screen.getByTestId("bulk-action-expected").textContent).toMatch(/Registrar entrega/);
    fireEvent.change(screen.getByTestId("bulk-deliver-at"), { target: { value: "" } });
    fireEvent.click(screen.getByTestId("bulk-action-confirm"));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toMatch(/fecha y hora/i);
    fireEvent.change(screen.getByTestId("bulk-deliver-at"), { target: { value: "2026-10-19T10:00" } });
    fireEvent.change(screen.getByTestId("bulk-deliver-remito"), { target: { value: "R-1" } });
    fireEvent.click(screen.getByTestId("bulk-action-confirm"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm.mock.calls[0]![0].delivery).toMatchObject({ remito: "R-1" });
  });
  it("Codificado: cantidad total editable por trabajo y validada", async () => {
    const { BulkPendingActionDialog } = await import("./bulk-pending-action-dialog");
    const onConfirm = vi.fn();
    render(<BulkPendingActionDialog open onOpenChange={() => {}} action="SEND_CODIFICADO" items={items} verdicts={[verdicts[0]!, { id: "b", code: "ELIGIBLE", reason: "" }]} onConfirm={onConfirm} />);
    const totals = screen.getAllByTestId("bulk-action-total") as HTMLInputElement[];
    expect(totals.map((t) => t.value)).toEqual(["100", "50"]);
    fireEvent.change(totals[1]!, { target: { value: "abc" } });
    fireEvent.click(screen.getByTestId("bulk-action-confirm"));
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.change(totals[1]!, { target: { value: "40" } });
    fireEvent.click(screen.getByTestId("bulk-action-confirm"));
    expect(onConfirm.mock.calls[0]![0].totals).toEqual({ a: 100, b: 40 });
  });
  it("cancelar no confirma y con nada elegible no deja confirmar", async () => {
    const { BulkPendingActionDialog } = await import("./bulk-pending-action-dialog");
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    render(<BulkPendingActionDialog open onOpenChange={onOpenChange} action="DELIVER" items={[items[1]!]} verdicts={[verdicts[1]!]} onConfirm={onConfirm} />);
    expect((screen.getByTestId("bulk-action-confirm") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId("bulk-action-cancel"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
