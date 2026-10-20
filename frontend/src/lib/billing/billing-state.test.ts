import { describe, expect, it } from "vitest";
import { computeBalances, computeDeliveryState, computeInvoicingState, normalizeInvoiceNumber, validateInvoiceQuantity } from "./billing-state";

describe("estados de facturación", () => {
  it("sin entregas → SIN ENTREGAS (aunque haya pedido)", () => {
    expect(computeInvoicingState({ requested: 500, delivered: 0, invoiced: 0 })).toBe("SIN_ENTREGAS");
    expect(computeDeliveryState({ requested: 500, delivered: 0 })).toBe("SIN_ENTREGAS");
  });
  it("entregado y sin facturar → PENDIENTE DE FACTURAR", () => {
    expect(computeInvoicingState({ requested: 500, delivered: 300, invoiced: 0 })).toBe("PENDIENTE_DE_FACTURAR");
  });
  it("facturación parcial y facturado se miden contra lo ENTREGADO, no contra lo pedido", () => {
    expect(computeInvoicingState({ requested: 500, delivered: 300, invoiced: 100 })).toBe("FACTURACION_PARCIAL");
    const q = { requested: 500, delivered: 300, invoiced: 300 };
    expect(computeInvoicingState(q)).toBe("FACTURADO");
    // Estado de entrega y de facturación son independientes: facturado al 100 % de lo entregado y todavía faltan 200 por entregar.
    expect(computeDeliveryState(q)).toBe("ENTREGA_PARCIAL");
    expect(computeBalances(q)).toEqual({ pendingDelivery: 200, pendingInvoice: 0 });
  });
  it("entrega completa", () => {
    expect(computeDeliveryState({ requested: 500, delivered: 500 })).toBe("ENTREGA_COMPLETA");
    expect(computeDeliveryState({ requested: null, delivered: 10 })).toBe("ENTREGA_COMPLETA");
  });
  it("facturado > entregado o facturación sobre entrega anulada → ANULADO / CON INCIDENCIA", () => {
    expect(computeInvoicingState({ requested: 100, delivered: 50, invoiced: 80 })).toBe("CON_INCIDENCIA");
    expect(computeInvoicingState({ requested: 100, delivered: 100, invoiced: 100, hasIncidence: true })).toBe("CON_INCIDENCIA");
  });
  it("no hay saldos negativos", () => {
    expect(computeBalances({ requested: 100, delivered: 120, invoiced: 150 })).toEqual({ pendingDelivery: 0, pendingInvoice: 0 });
  });
});

describe("validación de cantidades a facturar", () => {
  it("rechaza cero, negativos y no numéricos", () => {
    for (const quantity of [0, -5, Number.NaN]) expect(validateInvoiceQuantity({ quantity, deliveredLine: 100, invoicedLine: 0 }).ok).toBe(false);
  });
  it("no deja facturar más de lo entregado y todavía disponible", () => {
    expect(validateInvoiceQuantity({ quantity: 101, deliveredLine: 300, invoicedLine: 200 }).ok).toBe(false);
    expect(validateInvoiceQuantity({ quantity: 100, deliveredLine: 300, invoicedLine: 200 }).ok).toBe(true);
  });
  it("unidades enteras", () => {
    expect(validateInvoiceQuantity({ quantity: 1.5, deliveredLine: 10, invoicedLine: 0, integerUnits: true }).ok).toBe(false);
  });
  it("normaliza números de factura (mayúsculas y espacios)", () => {
    expect(normalizeInvoiceNumber("  a-0001  00001 ")).toBe("A-0001 00001");
  });
});
