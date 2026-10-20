import { describe, expect, it } from "vitest";
import { buildBillingNotification, describePacking } from "./billing-notification-builder";

const base = { eventKey: "k1", workItemId: "w1", client: "Pilar", product: "Crema Facial", pedido: "1520", orderRef: "OA-1520", quantity: 1250, unit: "u", at: new Date("2026-10-19T15:00:00Z"), actorName: "Producción" };

describe("avisos a Administración", () => {
  it("distingue «listo para entregar» de «entrega registrada» (ids y textos distintos)", () => {
    const listo = buildBillingNotification({ type: "LISTO_PARA_ENTREGAR", ...base });
    const ent = buildBillingNotification({ type: "ENTREGA_REGISTRADA", ...base, remito: null, packingGroups: [], complete: true, deliveredAt: null });
    expect(listo.id).not.toBe(ent.id);
    expect(listo.message).toMatch(/LISTO PARA ENTREGAR/);
    expect(listo.message).toMatch(/NO se entregó/);
    expect(ent.title).toMatch(/YA SE PUEDE FACTURAR/);
    expect(listo.sectors).toEqual(["ADMINISTRACION"]);
  });
  it("es determinístico: el mismo evento no genera otro aviso", () => {
    const a = buildBillingNotification({ type: "LISTO_PARA_ENTREGAR", ...base });
    const b = buildBillingNotification({ type: "LISTO_PARA_ENTREGAR", ...base });
    expect(a.id).toBe(b.id);
  });
  it("cajas distintas: 12 de 100 + 1 de 50 = 13 cajas / 1.250 u.", () => {
    expect(describePacking([{ cajas: 12, unidadesPorCaja: 100 }, { cajas: 1, unidadesPorCaja: 50 }])).toBe("12 cajas de 100 u. + 1 caja de 50 u. = 13 cajas / 1.250 u.");
    expect(describePacking([])).toBeNull();
  });
  it("incluye cliente, pedido, producto, OE/OA, cantidades, usuario y remito", () => {
    const ent = buildBillingNotification({ type: "ENTREGA_REGISTRADA", ...base, remito: "R-1", packingGroups: [{ cajas: 5, unidadesPorCaja: 250 }], complete: false, deliveredAt: new Date("2026-10-19T14:00:00Z") });
    for (const t of ["Cliente: Pilar", "Pedido: 1520", "Producto: Crema Facial", "OE/OA: OA-1520", "parcial", "5 cajas de 250 u.", "Registró: Producción", "Remito: R-1"]) expect(ent.message).toContain(t);
  });
});

describe("avisos de facturación: parcial, completa y remitos", () => {
  const delivery = { ...base, remito: "R-1", packingGroups: [{ cajas: 3, unidadesPorCaja: 100 }], deliveredAt: new Date("2026-10-19T14:00:00Z"), totals: { requested: 500, delivered: 300, pending: 200 } };
  it("entrega parcial: título propio y cantidades pedido / acumulado / pendiente", () => {
    const n = buildBillingNotification({ type: "ENTREGA_REGISTRADA", ...delivery, complete: false });
    expect(n.title).toMatch(/ENTREGA PARCIAL REGISTRADA/);
    for (const t of ["Total pedido: 500 u", "Entregado acumulado: 300 u", "Pendiente de entregar: 200 u", "entregar no es facturar"]) expect(n.message).toContain(t);
    expect(n.href).toContain("/facturacion");
  });
  it("entrega completa: aviso aparte con id distinto al de la entrega", () => {
    const a = buildBillingNotification({ type: "ENTREGA_REGISTRADA", ...delivery, complete: true });
    const c = buildBillingNotification({ type: "ENTREGA_COMPLETA", ...delivery });
    expect(c.title).toMatch(/PEDIDO ENTREGADO COMPLETO/);
    expect(c.id).not.toBe(a.id);
    expect(c.kind).toBe("entrega_completa");
  });
  it("remito generado / anulado: contenido, motivo y unidades pendientes; ids estables y distintos", () => {
    const common = { remitoId: "r1", remitoNumber: "R-20261019-ABC-1", client: "Pilar", lines: [{ product: "Crema", quantity: 100, unit: "u", orderRef: "OA-1" }, { product: "Serum", quantity: 50, unit: "u" }], totalUnits: 150, totalCajas: 3, at: new Date("2026-10-19T15:00:00Z"), actorName: "Producción" };
    const g = buildBillingNotification({ type: "REMITO_GENERADO", ...common });
    const x = buildBillingNotification({ type: "REMITO_ANULADO", ...common, reason: "error de carga", pendingInvoiceUnits: 150 });
    expect(g.message).toContain("Remito: R-20261019-ABC-1");
    expect(g.message).toContain("Crema (100 u · OA-1); Serum (50 u)");
    expect(x.message).toContain("Motivo de anulación: error de carga");
    expect(x.message).toContain("pendientes de facturar afectadas: 150 u.");
    expect(g.id).not.toBe(x.id);
    expect(buildBillingNotification({ type: "REMITO_GENERADO", ...common }).id).toBe(g.id);
  });
});
