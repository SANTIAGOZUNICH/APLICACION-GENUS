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
