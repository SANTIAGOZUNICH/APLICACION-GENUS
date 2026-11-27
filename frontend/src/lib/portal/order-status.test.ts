import { describe, expect, it } from "vitest";
import { deriveClientOrderStatus, deriveClientProductStatus, orderProgressText, type ProductStatusInput } from "./order-status";

const base: ProductStatusInput = { hasWork: true, cancelled: false, stage: "ELABORACION", substage: null, started: true, reprocess: false };
const P = (over: Partial<ProductStatusInput> = {}) => deriveClientProductStatus({ ...base, ...over });
const ids = (...overs: Array<Partial<ProductStatusInput>>) => deriveClientOrderStatus(overs.map((o) => P(o)));

describe("estado comercial de un producto", () => {
  it("1 recibido: pedido sin trabajos", () => {
    expect(P({ hasWork: false, stage: null }).status).toMatchObject({ id: 1, label: "Pedido recibido" });
  });
  it("2 programado: trabajo asignado pero la elaboración no empezó", () => {
    expect(P({ started: false }).status).toMatchObject({ id: 2, label: "Pedido programado" });
  });
  it("3 en elaboración: empezó, o terminó y espera pasar a envasado", () => {
    expect(P().status?.id).toBe(3);
    expect(P({ started: false, substage: "TERMINADA_EN_TRASPASO" }).status?.id).toBe(3);
  });
  it("4 en envasado (incluye finalización/codificado)", () => {
    expect(P({ stage: "ENVASADO" }).status?.id).toBe(4);
    expect(P({ stage: "ENVASADO", substage: "FINALIZACION" }).status?.id).toBe(4);
  });
  it("5 listo y 6 entregado según la etapa del circuito", () => {
    expect(P({ stage: "LISTO" }).status?.id).toBe(5);
    expect(P({ stage: "ENTREGADO" }).status?.id).toBe(6);
  });
  it("cancelado no tiene estado", () => {
    expect(P({ cancelled: true })).toEqual({ status: null, cancelled: true, reprocessing: false });
  });
  it("reproceso: no puede figurar listo ni entregado, vuelve a envasado sin exponer el motivo", () => {
    for (const stage of ["LISTO", "ENTREGADO"] as const) {
      const r = P({ stage, reprocess: true });
      expect(r.status?.id).toBe(4);
      expect(r.reprocessing).toBe(true);
    }
    expect(P({ stage: "ELABORACION", reprocess: true }).status?.id).toBe(3);
  });
});

describe("estado comercial del pedido", () => {
  it("un solo producto: su propio estado", () => {
    const o = ids({ stage: "LISTO" });
    expect(o.status?.id).toBe(5);
    expect(o.todoListo).toBe(true);
    expect(o.partial).toBe(false);
  });

  it("NUNCA «Listo para entregar» si hay productos pendientes: manda el menos avanzado y se informa el progreso", () => {
    const o = ids({ stage: "LISTO" }, { stage: "LISTO" }, { stage: "ENVASADO" });
    expect(o.status?.id).toBe(4);
    expect(o.todoListo).toBe(false);
    expect(o.partial).toBe(true);
    expect(o.progress).toEqual({ total: 3, cancelados: 0, listos: 2, entregados: 0, enProceso: 1 });
    expect(o.message).toContain("2 de 3 productos");
  });

  it("todos listos (algunos ya entregados) → Listo para entregar; todos entregados → Entregado", () => {
    expect(ids({ stage: "LISTO" }, { stage: "ENTREGADO" }).status?.id).toBe(5);
    const done = ids({ stage: "ENTREGADO" }, { stage: "ENTREGADO" });
    expect(done.status?.id).toBe(6);
    expect(done.message).toMatch(/Todos los productos/);
  });

  it("entrega parcial: un producto entregado y otro en elaboración → el pedido sigue en elaboración", () => {
    const o = ids({ stage: "ENTREGADO" }, { stage: "ELABORACION" });
    expect(o.status?.id).toBe(3);
    expect(o.partial).toBe(true);
    expect(o.progress.entregados).toBe(1);
  });

  it("producto sin trabajos (recién recibido) frena el pedido en «Pedido recibido»", () => {
    expect(ids({ stage: "ENVASADO" }, { hasWork: false, stage: null }).status?.id).toBe(1);
  });

  it("los cancelados no bloquean el estado del pedido", () => {
    const o = ids({ stage: "LISTO" }, { cancelled: true });
    expect(o.status?.id).toBe(5);
    expect(o.todoListo).toBe(true);
    expect(o.progress).toMatchObject({ total: 1, cancelados: 1 });
  });

  it("todo cancelado → pedido cancelado, sin estado", () => {
    const o = ids({ cancelled: true }, { cancelled: true });
    expect(o).toMatchObject({ status: null, cancelled: true, todoListo: false });
  });

  it("reproceso en un producto listo hace retroceder el pedido", () => {
    const o = ids({ stage: "LISTO" }, { stage: "LISTO", reprocess: true });
    expect(o.status?.id).toBe(4);
    expect(o.todoListo).toBe(false);
  });

  it("texto de progreso", () => {
    expect(orderProgressText({ total: 3, cancelados: 0, listos: 1, entregados: 1, enProceso: 1 })).toBe("Productos listos o entregados: 2 de 3");
    expect(orderProgressText({ total: 1, cancelados: 0, listos: 1, entregados: 0, enProceso: 0 })).toBe("Productos listos o entregados: 1 de 1");
  });
});
