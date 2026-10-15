import { describe, expect, it } from "vitest";
import { dragChipId, moveOptions, parseDragChipId } from "./entrega-drag";
import type { ScheduledDelivery, ScheduledDeliveryItem } from "@/lib/entregas/types";

const item = (o: Partial<ScheduledDeliveryItem>): ScheduledDeliveryItem =>
  ({ id: "i1", deliveryId: "d1", product: "CREMA", quantity: "500", unit: "un", sector: "ENVASADO_MASIVO", plannedProductionDate: null, lot: null, vto: null, notes: null, position: 0, version: 0, createdAt: "", updatedAt: "", works: [], status: "programada", ...o }) as ScheduledDeliveryItem;
const delivery = (o: Partial<ScheduledDelivery>): ScheduledDelivery =>
  ({ id: "d1", client: "LUCENT", deliveryDate: "2026-10-16", responsible: null, notes: null, state: "programada", rescheduleCount: 0, version: 3, cancelledAt: null, cancelledBy: null, cancelReason: null, createdBy: "", createdAt: "", updatedAt: "", items: [], status: "programada", ...o }) as ScheduledDelivery;
const work = (id: string, delivered = 0) => ({ workItemId: id, plannedQuantity: "500", finishedQty: "500", deliveredQty: delivered || null, delivered: false, cancelled: false, realDeliveries: [] }) as never;

describe("arrastre en el Calendario de Entregas", () => {
  it("cliente con varios productos: una opción por producto (nunca se mueven todos juntos)", () => {
    const opts = moveOptions([
      delivery({ items: [item({ id: "a", product: "SERUM ADN 1%" }), item({ id: "b", product: "CREMA" })] }),
      delivery({ id: "derived:x", origin: "desde_trabajo", version: 0, items: [item({ id: "work:w1", product: "GEL", works: [work("w1", 300)] })] }),
    ]);
    expect(opts.map((o) => [o.product, o.kind])).toEqual([["SERUM ADN 1%", "programada"], ["CREMA", "programada"], ["GEL", "trabajo"]]);
    expect(opts[2]).toMatchObject({ workItemId: "w1", detail: "200 un pendientes" });
    expect(opts[0]).toMatchObject({ deliveryId: "d1", itemId: "a", version: 3 });
  });
  it("no se ofrecen productos entregados, quitados ni entregas canceladas o registradas", () => {
    expect(moveOptions([
      delivery({ state: "cancelada", items: [item({})] }),
      delivery({ items: [item({ status: "entregada" }), item({ id: "h", hidden: { id: "x" } as never })] }),
      delivery({ id: "derived:r", origin: "entrega_registrada", items: [item({ works: [work("w9")] })] }),
    ])).toEqual([]);
  });
  it("id del arrastre: cliente con «|» en el nombre", () => {
    expect(parseDragChipId(dragChipId("2026-10-16", "A|B"))).toEqual({ date: "2026-10-16", client: "A|B" });
  });
});
