import { describe, expect, it } from "vitest";
import { groupDeliveries, type EligibleDelivery } from "./delivery-grouping";

const d = (id: string, client: string, date: string, qty: number, pedido: string | null, boxes: Array<{ cajas: number; unidadesPorCaja: number }> = []): EligibleDelivery => ({
  deliveryLineId: id, workItemId: `w-${id}`, client, pedido, orderRef: null, product: `P-${id}`, lote: "", vto: "", quantity: qty, unit: "u", kind: "FINAL",
  deliveredAt: `${date}T15:00:00Z`, deliveryDate: date, packingGroups: boxes, boxesText: null, deliveredBy: "x", deliveryRemito: null,
});

describe("agrupación de entregas en remitos", () => {
  it("un pedido con tres productos entregados el mismo día = UN remito con los tres renglones", () => {
    const g = groupDeliveries([d("1", "Pilar", "2026-10-20", 500, "1520"), d("2", "Pilar", "2026-10-20", 1000, "1520"), d("3", "Pilar", "2026-10-20", 300, "1520")]);
    expect(g).toHaveLength(1);
    expect(g[0]!.lines).toHaveLength(3);
    expect(g[0]!.totalUnits).toBe(1800);
    expect(g[0]!.pedidos).toEqual(["1520"]);
  });
  it("varios pedidos del mismo cliente y fecha se agrupan conservando cada pedido", () => {
    const g = groupDeliveries([d("1", "Pilar", "2026-10-20", 10, "1520"), d("2", "pilar", "2026-10-20", 20, "1521")]);
    expect(g).toHaveLength(1);
    expect(g[0]!.pedidos).toEqual(["1520", "1521"]);
    expect(g[0]!.lines.map((l) => l.workItemId)).toEqual(["w-1", "w-2"]);
  });
  it("no mezcla clientes ni fechas distintas", () => {
    const g = groupDeliveries([d("1", "Pilar", "2026-10-20", 10, "1"), d("2", "Otro", "2026-10-20", 10, "2"), d("3", "Pilar", "2026-10-21", 10, "3")]);
    expect(g).toHaveLength(3);
  });
  it("entrega parcial: cada tramo es un renglón propio y se informa lo que no trae cajas", () => {
    const g = groupDeliveries([d("1", "Pilar", "2026-10-20", 400, "9", [{ cajas: 4, unidadesPorCaja: 100 }]), d("2", "Pilar", "2026-10-20", 600, "9")]);
    expect(g[0]!.totalUnits).toBe(1000);
    expect(g[0]!.totalCajas).toBe(4);
    expect(g[0]!.withoutBoxes).toBe(1);
  });
});
