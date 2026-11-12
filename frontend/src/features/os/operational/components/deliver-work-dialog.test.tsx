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
  it("muestra cliente, producto, total, ya entregado y pendiente; sin remito ni fecha; las cajas son opcionales", () => {
    open();
    expect(screen.getByTestId("deliver-identity").textContent).toContain("CLIENTE X");
    expect(screen.getByTestId("deliver-identity").textContent).toContain("ORIGINAL BLACK");
    const bal = screen.getByTestId("deliver-balance").textContent ?? "";
    expect(bal).toContain("Cantidad total del trabajo");
    expect(bal).toContain("2000");
    expect(bal).toContain("Pendiente de entregar");
    expect(screen.queryByTestId("deliver-remito")).toBeNull();
    expect(screen.getByTestId("deliver-boxes-toggle")).toBeTruthy(); // cajas de esta entrega: opcionales (cerradas por defecto)
    expect(screen.queryByTestId("deliver-box-groups-editor")).toBeNull();
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

  it("valida en pantalla: vacío y mayor a lo realizado (la cantidad pedida ya no es tope)", async () => {
    const onConfirm = open();
    fireEvent.click(screen.getByTestId("confirm-deliver"));
    expect((await screen.findByTestId("deliver-error")).textContent).toMatch(/mayor que 0/);
    fireEvent.change(screen.getByTestId("deliver-quantity"), { target: { value: "2500" } });
    fireEvent.click(screen.getByTestId("confirm-deliver"));
    await waitFor(() => expect(screen.getByTestId("deliver-error").textContent).toMatch(/realizadas/));
    fireEvent.change(screen.getByTestId("deliver-quantity"), { target: { value: "1500" } });
    fireEvent.click(screen.getByTestId("confirm-deliver"));
    await waitFor(() => expect(screen.getByTestId("deliver-error").textContent).toMatch(/realizadas/));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("segunda entrega: ya entregado 1000 → pendiente 1000; entregar 600 deja 400", async () => {
    open({ progress: { delivered: 1000, pending: 1000, complete: false }, produced: 1600 });
    expect(screen.getByTestId("deliver-balance").textContent).toContain("1000");
    fireEvent.change(screen.getByTestId("deliver-quantity"), { target: { value: "600" } });
    expect(screen.getByTestId("deliver-partial-note").textContent).toContain("400");
  });

  it("más de lo pedido: con 2.050 realizadas se pueden entregar 2.050 (pedido 2.000) con observación opcional, sin avisos de excedente", async () => {
    const onConfirm = open({ produced: 2050 });
    fireEvent.change(screen.getByTestId("deliver-quantity"), { target: { value: "2050" } });
    fireEvent.change(screen.getByTestId("deliver-observations"), { target: { value: "50 unidades de más" } });
    expect(screen.queryByTestId("deliver-partial-note")).toBeNull(); // completa: nada «parcial» ni de excedente
    fireEvent.click(screen.getByTestId("confirm-deliver"));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect((onConfirm.mock.calls[0] as unknown[])[0]).toMatchObject({ deliverQuantity: 2050, observations: "50 unidades de más", partial: true });
    expect(document.body.textContent).not.toMatch(/exced|sobreprod/i);
  });

  it("cajas en la entrega parcial: 8 × 100 calcula el total (opción A); con cajas incompletas 8 × 100 + 1 × 50 = 850 en 9 cajas", async () => {
    const onConfirm = open({ produced: 2050 });
    fireEvent.click(screen.getByTestId("deliver-boxes-toggle"));
    fireEvent.change(screen.getByTestId("deliver-box-cajas-0"), { target: { value: "8" } });
    fireEvent.change(screen.getByTestId("deliver-box-upc-0"), { target: { value: "100" } });
    fireEvent.change(screen.getByTestId("deliver-box-cajas-1"), { target: { value: "1" } });
    fireEvent.change(screen.getByTestId("deliver-box-upc-1"), { target: { value: "50" } });
    expect(screen.getByTestId("deliver-boxes-total").textContent).toMatch(/9 cajas · 850 u\./);
    fireEvent.click(screen.getByTestId("confirm-deliver")); // sin escribir la cantidad: el total sale de las cajas
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect((onConfirm.mock.calls[0] as unknown[])[0]).toMatchObject({ deliverQuantity: 850, deliveryPackingGroups: [{ cajas: 8, unidadesPorCaja: 100 }, { cajas: 1, unidadesPorCaja: 50 }], partial: true });
  });

  it("opción B: cantidad informada y cajas que no suman → advertencia con los números exactos, pero se registra igual (diferencia por conciliar)", async () => {
    const onConfirm = open({ produced: 2050 });
    fireEvent.change(screen.getByTestId("deliver-quantity"), { target: { value: "850" } });
    fireEvent.click(screen.getByTestId("deliver-boxes-toggle"));
    fireEvent.change(screen.getByTestId("deliver-box-cajas-0"), { target: { value: "8" } });
    fireEvent.change(screen.getByTestId("deliver-box-upc-0"), { target: { value: "100" } });
    expect(screen.getByTestId("deliver-boxes-diff").textContent).toMatch(/suman 800 u\. y la entrega es de 850 u\./);
    fireEvent.click(screen.getByTestId("confirm-deliver"));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect((onConfirm.mock.calls[0] as unknown[])[0]).toMatchObject({ deliverQuantity: 850, deliveryPackingGroups: [{ cajas: 8, unidadesPorCaja: 100 }] });
  });

  it("entregar más de lo registrado como realizado: se pide confirmar las unidades realmente producidas (no se bloquea sin alternativa)", async () => {
    const onConfirm = open({ produced: 300 });
    fireEvent.change(screen.getByTestId("deliver-quantity"), { target: { value: "700" } });
    fireEvent.click(screen.getByTestId("confirm-deliver"));
    await waitFor(() => expect(screen.getByTestId("deliver-confirm-produced")).toBeTruthy());
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("deliver-confirm-produced"));
    fireEvent.click(screen.getByTestId("confirm-deliver"));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect((onConfirm.mock.calls[0] as unknown[])[0]).toMatchObject({ deliverQuantity: 700, confirmProduced: true });
  });
});
