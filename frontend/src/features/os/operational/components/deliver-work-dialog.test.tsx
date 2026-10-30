/**
 * @vitest-environment happy-dom
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DeliverWorkDialog } from "./deliver-work-dialog";

afterEach(cleanup);

const open = (over: Partial<React.ComponentProps<typeof DeliverWorkDialog>> = {}) => {
  const onConfirm = vi.fn(async () => undefined);
  render(
    <DeliverWorkDialog
      open
      onOpenChange={() => undefined}
      title="Entregar parcial"
      mode="partial"
      clientLabel="CLIENTE X"
      productLabel="ORIGINAL BLACK"
      target={2000}
      produced={1000}
      unit="un."
      progress={{ delivered: 0, pending: null, complete: false }}
      onConfirm={onConfirm}
      {...over}
    />
  );
  return onConfirm;
};

describe("DeliverWorkDialog — modo «Entregar parcial»", () => {
  it("muestra cliente, producto, total, ya entregado y pendiente; sin remito, cajas ni fecha", () => {
    open();
    expect(screen.getByTestId("deliver-identity").textContent).toContain("CLIENTE X");
    expect(screen.getByTestId("deliver-identity").textContent).toContain("ORIGINAL BLACK");
    const bal = screen.getByTestId("deliver-balance").textContent ?? "";
    expect(bal).toContain("Cantidad total del trabajo");
    expect(bal).toContain("2000");
    expect(bal).toContain("Pendiente de entregar");
    expect(screen.queryByTestId("deliver-remito")).toBeNull();
    expect(screen.queryByTestId("deliver-boxes-toggle")).toBeNull();
    expect(screen.queryByTestId("deliver-at")).toBeNull();
    expect(screen.getByText(/Cancelar/)).toBeTruthy();
  });

  it("la cantidad arranca vacía y se confirma con partial=true y la clave de idempotencia", async () => {
    const onConfirm = open();
    expect((screen.getByTestId("deliver-quantity") as HTMLInputElement).value).toBe("");
    fireEvent.change(screen.getByTestId("deliver-quantity"), { target: { value: "1000" } });
    expect(screen.getByTestId("deliver-partial-note").textContent).toContain("1000");
    fireEvent.click(screen.getByTestId("confirm-deliver"));
    fireEvent.click(screen.getByTestId("confirm-deliver")); // doble clic
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    const payload = (onConfirm.mock.calls[0] as unknown as [{ partial: boolean; deliverQuantity: number; idempotencyKey: string }])[0];
    expect(payload).toMatchObject({ partial: true, deliverQuantity: 1000 });
    expect(payload.idempotencyKey).toMatch(/^deliver/);
  });

  it("valida en pantalla: vacío, mayor al saldo y mayor a lo terminado", async () => {
    const onConfirm = open();
    fireEvent.click(screen.getByTestId("confirm-deliver"));
    expect((await screen.findByTestId("deliver-error")).textContent).toMatch(/mayor que 0/);
    fireEvent.change(screen.getByTestId("deliver-quantity"), { target: { value: "2500" } });
    fireEvent.click(screen.getByTestId("confirm-deliver"));
    await waitFor(() => expect(screen.getByTestId("deliver-error").textContent).toMatch(/supera el saldo/));
    fireEvent.change(screen.getByTestId("deliver-quantity"), { target: { value: "1500" } });
    fireEvent.click(screen.getByTestId("confirm-deliver"));
    await waitFor(() => expect(screen.getByTestId("deliver-error").textContent).toMatch(/terminadas/));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("segunda entrega: ya entregado 1000 → pendiente 1000; entregar 600 deja 400", async () => {
    open({ progress: { delivered: 1000, pending: 1000, complete: false }, produced: 1600 });
    expect(screen.getByTestId("deliver-balance").textContent).toContain("1000");
    fireEvent.change(screen.getByTestId("deliver-quantity"), { target: { value: "600" } });
    expect(screen.getByTestId("deliver-partial-note").textContent).toContain("400");
  });
});
