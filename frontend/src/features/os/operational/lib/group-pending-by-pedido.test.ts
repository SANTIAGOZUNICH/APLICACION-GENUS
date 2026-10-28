import { describe, expect, it } from "vitest";
import { groupPendingByPedido, generalStatus, type PedidoGroup, type PendingEntry } from "./group-pending-by-pedido";
import { createTestWorkItem } from "@/lib/__fixtures__/work-item.factory";
import type { WorkItem } from "@/types/operational/work-item";

const mk = (over: Partial<WorkItem> & Pick<WorkItem, "id">) => createTestWorkItem({ sector: "ENVASADO_MASIVO", ...over });
const grp = (e: PendingEntry | undefined): PedidoGroup => {
  if (!e || e.kind !== "group") throw new Error("se esperaba un grupo");
  return e.group;
};
const nat = (n: string, over: Partial<WorkItem> = {}) =>
  mk({ id: `native:${n}`, sector: "ENVASADO_MASIVO", client: "CLIENTE A", product: "CREMA", quantity: "1000", unit: "u", status: "pendiente", pedidoRef: "ped-125", pedidoOp: "125", plannedDate: "2026-11-02", ...over });

describe("groupPendingByPedido (solo visual de Pendientes)", () => {
  it("tres trabajos del mismo pedido en días distintos → UNA tarjeta con total 6.000 y 3 trabajos; los items originales intactos", () => {
    const items = [nat("a", { quantity: "2000", plannedDate: "2026-11-02" }), nat("b", { quantity: "3000", plannedDate: "2026-11-04" }), nat("c", { quantity: "1000", plannedDate: "2026-11-06" })];
    const snapshot = JSON.stringify(items);
    const out = groupPendingByPedido(items);
    expect(out).toHaveLength(1);
    const g = { group: grp(out[0]) };
    expect(g.group).toMatchObject({ label: "Pedido 125", client: "CLIENTE A", totalPending: 6000, unit: "u", status: "pendiente", firstDate: "2026-11-02", lastDate: "2026-11-06" });
    expect(g.group.items.map((i) => i.id)).toEqual(["native:a", "native:b", "native:c"]);
    expect(g.group.items[0]).toBe(items[0]); // mismos objetos: nada copiado ni modificado
    expect(JSON.stringify(items)).toBe(snapshot);
  });

  it("dos pedidos distintos del mismo cliente y producto → dos tarjetas", () => {
    const out = groupPendingByPedido([nat("a"), nat("b"), nat("c", { pedidoRef: "ped-126", pedidoOp: "126" }), nat("d", { pedidoRef: "ped-126", pedidoOp: "126" })]);
    expect(out.map((e) => (e.kind === "group" ? e.group.label : "single"))).toEqual(["Pedido 125", "Pedido 126"]);
  });

  it("sin pedido vinculado, de la planilla histórica (texto libre) o único de su pedido: NO se agrupan", () => {
    const out = groupPendingByPedido(
      [
        nat("a", { pedidoRef: null }),
        nat("b", { pedidoRef: null }),
        mk({ id: "sheet-1", pedidoRef: "125", client: "CLIENTE A" }), // no nativo: el «pedido» es texto libre
        mk({ id: "sheet-2", pedidoRef: "125", client: "CLIENTE A" }),
        nat("c", { pedidoRef: "ped-9" }),
        nat("d", { pedidoRef: " " }),
      ]
    );
    expect(out.every((e) => e.kind === "single")).toBe(true);
    expect(out).toHaveLength(6);
  });

  it("no mezcla sectores (Masivo / Premium) aunque compartan pedido", () => {
    const out = groupPendingByPedido([nat("a"), nat("b", { sector: "ENVASADO_PREMIUM" })]);
    expect(out.every((e) => e.kind === "single")).toBe(true);
  });

  it("el total suma lo PLANIFICADO de los trabajos pendientes (no resta «realizado», que en nativos arranca igual al plan)", () => {
    const items = [nat("a", { quantity: "2000", finishedQty: "2000" }), nat("b", { quantity: "3000", finishedQty: "3000" }), nat("c", { quantity: "1000", finishedQty: "1000" })];
    expect(grp(groupPendingByPedido(items)[0]).totalPending).toBe(6000);
  });

  it("un trabajo completo (ya filtrado de pendientes) no suma; con dos pendientes el grupo muestra 2 trabajos y su total", () => {
    // La lista de Pendientes ya no trae el entregado: el grupo se arma con los dos que quedan.
    const out = groupPendingByPedido([nat("b", { quantity: "3000" }), nat("c", { quantity: "1000" })]);
    const g = grp(out[0]);
    expect(g.items).toHaveLength(2);
    expect(g.totalPending).toBe(4000);
  });

  it("estado general y cantidades no numéricas", () => {
    expect(generalStatus([nat("a", { status: "pendiente" }), nat("b", { status: "en_curso" })])).toBe("en_curso");
    expect(generalStatus([nat("a", { status: "pendiente" }), nat("b", { status: "bloqueado" })])).toBe("bloqueado");
    expect(generalStatus([nat("a"), nat("b")])).toBe("pendiente");
    const g = grp(groupPendingByPedido([nat("a", { quantity: "abc" }), nat("b", { quantity: "100" })])[0]);
    expect(g).toMatchObject({ totalPending: 100, unparsed: 1 });
    const sinNum = grp(groupPendingByPedido([nat("a", { quantity: null }), nat("b", { quantity: "x" })])[0]);
    expect(sinNum.totalPending).toBeNull();
  });

  it("conserva el orden: la tarjeta del grupo ocupa el lugar de su primer trabajo", () => {
    const out = groupPendingByPedido([nat("x", { pedidoRef: null }), nat("a"), nat("y", { pedidoRef: null }), nat("b")]);
    expect(out.map((e) => (e.kind === "single" ? e.item.id : "grupo"))).toEqual(["native:x", "grupo", "native:y"]);
  });
});
