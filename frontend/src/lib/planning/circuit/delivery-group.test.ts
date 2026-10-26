import { describe, expect, it } from "vitest";
import { groupSiblings, isSameOperationalJob, primaryOfSyncObs, syncObsMark, type DeliveryGroupCandidate } from "./delivery-group";

const w = (id: string, over: Partial<DeliveryGroupCandidate> = {}): DeliveryGroupCandidate => ({ id, sector: "ENVASADO_MASIVO", orderId: "OA1", productionPedidoId: "P1", operationalStatus: "pendiente", status: "PUBLICADO", ...over });

describe("grupo de entrega: mismo trabajo operativo", () => {
  it("tres apariciones de la misma OA y pedido (lunes, miércoles, viernes) son el mismo trabajo", () => {
    const all = [w("a"), w("b", { scheduleRootId: "a" }), w("c", { scheduleRootId: "a" })];
    expect(groupSiblings(all[1]!, all).map((x) => x.id)).toEqual(["a", "c"]);
  });
  it("mismo cliente y producto pero distinta orden/pedido: NO se agrupan", () => {
    expect(isSameOperationalJob(w("a"), w("b", { orderId: "OA2" }))).toBe(false);
    expect(isSameOperationalJob(w("a"), w("b", { productionPedidoId: "P2" }))).toBe(false);
  });
  it("sin referencia estable (sin orden ni programación) no se agrupa por nombre", () => {
    expect(isSameOperationalJob(w("a", { orderId: null }), w("b", { orderId: null }))).toBe(false);
  });
  it("etapas distintas del mismo pedido (otro sector) NO se arrastran", () => {
    expect(isSameOperationalJob(w("a"), w("b", { sector: "CODIFICADO" }))).toBe(false);
    expect(isSameOperationalJob(w("a"), w("b", { sector: "ENVASADO_PREMIUM" }))).toBe(false);
    expect(isSameOperationalJob(w("a", { sector: "ELABORACION", orderId: "OE1" }), w("b", { sector: "ENVASADO_MASIVO", orderId: "OE1" }))).toBe(false);
  });
  it("pedido ambiguo (uno sin pedido) no se agrupa; borrados y cancelados quedan afuera", () => {
    expect(isSameOperationalJob(w("a"), w("b", { productionPedidoId: null }))).toBe(false);
    const all = [w("a"), w("b", { deletedAt: new Date() }), w("c", { operationalStatus: "cancelado" }), w("d")];
    expect(groupSiblings(all[0]!, all).map((x) => x.id)).toEqual(["d"]);
  });
  it("la marca de sincronización identifica a quién se entregó", () => {
    const id = "00000000-0000-0000-0000-000000000001";
    expect(primaryOfSyncObs(`Recibió Juan · ${syncObsMark(id)}`)).toBe(id);
    expect(primaryOfSyncObs("observación común")).toBeNull();
  });
});
