/**
 * @vitest-environment happy-dom
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SmartPasteDialog } from "./smart-paste-dialog";
import { buildMasterData } from "@/lib/smart-paste/master-data";

afterEach(() => {
  cleanup();
});

const FIELDS = [
  { key: "producto" as const, label: "Producto" },
  { key: "cliente" as const, label: "Cliente" },
  { key: "lote" as const, label: "Lote" },
  { key: "vto" as const, label: "VTO" },
  { key: "cantidad" as const, label: "Cantidad" },
];

const master = buildMasterData([{ lote: "G26043", cliente: "NOCE CANA", producto: "SHAVING GEL" }]);

function confirmButton(): HTMLButtonElement {
  return screen.getByTestId("smart-paste-confirm") as HTMLButtonElement;
}

describe("SmartPasteDialog", () => {
  it("pegar texto muestra el resumen interpretado y habilita confirmar", async () => {
    render(
      <SmartPasteDialog
        open
        onOpenChange={() => {}}
        title="Pegado inteligente"
        fields={FIELDS}
        master={master}
        onConfirm={async () => {}}
      />
    );

    fireEvent.change(screen.getByTestId("smart-paste-textarea"), {
      target: { value: "SHAVING GEL\tNOCE CANA\tG26043\t10/2028\t1200" },
    });

    await waitFor(() => {
      expect(screen.getByTestId("smart-paste-summary").textContent).toContain("1 fila(s) detectada(s)");
    });
    expect(confirmButton().disabled).toBe(false);
  });

  it("confirmar llama a onConfirm con las filas resueltas y cierra el diálogo", async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    const onOpenChange = vi.fn();
    render(
      <SmartPasteDialog
        open
        onOpenChange={onOpenChange}
        title="Pegado inteligente"
        fields={FIELDS}
        master={master}
        onConfirm={onConfirm}
      />
    );

    fireEvent.change(screen.getByTestId("smart-paste-textarea"), {
      target: { value: "SHAVING GEL\tNOCE CANA\tG26043\t10/2028\t1200" },
    });
    await waitFor(() => expect(confirmButton().disabled).toBe(false));
    fireEvent.click(confirmButton());

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    const arg = onConfirm.mock.calls[0]![0];
    expect(arg.rows).toHaveLength(1);
    expect(arg.rows[0].assignments.lote?.value).toBe("G26043");
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("Test 18: doble click en confirmar no dispara onConfirm dos veces (idempotencia en el cliente)", async () => {
    let resolveConfirm: () => void = () => {};
    const onConfirm = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveConfirm = resolve;
        })
    );
    render(
      <SmartPasteDialog
        open
        onOpenChange={() => {}}
        title="Pegado inteligente"
        fields={FIELDS}
        master={master}
        onConfirm={onConfirm}
      />
    );
    fireEvent.change(screen.getByTestId("smart-paste-textarea"), {
      target: { value: "SHAVING GEL\tNOCE CANA\tG26043\t10/2028\t1200" },
    });
    await waitFor(() => expect(confirmButton().disabled).toBe(false));

    const button = confirmButton();
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    resolveConfirm();
  });

  it("una fila con error no se cuenta para confirmar por defecto", async () => {
    render(
      <SmartPasteDialog
        open
        onOpenChange={() => {}}
        title="Pegado inteligente"
        fields={FIELDS}
        master={master}
        onConfirm={async () => {}}
      />
    );
    fireEvent.change(screen.getByTestId("smart-paste-textarea"), {
      target: { value: "SHAVING GEL\tNOCE CANA\tG26043\t32/99/2028\t1200" },
    });
    await waitFor(() => {
      expect(screen.getByTestId("smart-paste-summary").textContent).toContain("1 con error");
    });
    expect(confirmButton().disabled).toBe(true);
  });
});
