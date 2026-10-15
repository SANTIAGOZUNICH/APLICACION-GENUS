import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/client", () => ({ getDb: () => ({}) }));

import { closePedidoIfAllDelivered } from "./delivery-core";
import { productionPedidos, workItems } from "@/lib/db/schema";

/**
 * Carrera de dos entregas finales concurrentes de trabajos hermanos: si ninguna bloquea el pedido ANTES de leer a
 * las hermanas, cada transacción ve a la otra como «no entregada» y el pedido nunca se cierra. El pedido se bloquea
 * (SELECT … FOR UPDATE) antes de consultar a las hermanas, así la segunda espera el commit de la primera.
 */
function recordingTx(opts: { pedidoEstado: string; siblings: Array<{ id: string; operationalStatus: string; sector: string }> }) {
  const calls: string[] = [];
  const updates: unknown[] = [];
  const events: unknown[] = [];
  const tx = {
    select() {
      let table: unknown = null;
      const api = {
        from(t: unknown) {
          table = t;
          calls.push(t === productionPedidos ? "select:pedido" : t === workItems ? "select:hermanas" : "select:?");
          return api;
        },
        where() {
          return api;
        },
        for(mode: string) {
          calls.push(`for:${mode}:${table === productionPedidos ? "pedido" : "otro"}`);
          return api;
        },
        limit() {
          return Promise.resolve(table === productionPedidos ? [{ id: "ped-1", estado: opts.pedidoEstado }] : []);
        },
        then(resolve: (v: unknown) => unknown) {
          return Promise.resolve(resolve(opts.siblings));
        },
      };
      return api;
    },
    update() {
      return {
        set(patch: unknown) {
          updates.push(patch);
          return { where: () => Promise.resolve() };
        },
      };
    },
    insert() {
      return {
        values(v: unknown) {
          events.push(v);
          return Promise.resolve();
        },
      };
    },
  };
  return { tx, calls, updates, events };
}

const actor = { email: "p@x.com", sector: "PRODUCCION", displayName: "P" } as never;

describe("closePedidoIfAllDelivered — bloqueo del pedido (carrera entre hermanas)", () => {
  it("1) bloquea el pedido FOR UPDATE ANTES de consultar a las hermanas", async () => {
    const r = recordingTx({
      pedidoEstado: "EN_ENVASADO",
      siblings: [
        { id: "w1", operationalStatus: "entregado", sector: "ENVASADO_MASIVO" },
        { id: "w2", operationalStatus: "entregado", sector: "ENVASADO_MASIVO" },
      ],
    });
    const closed = await closePedidoIfAllDelivered(r.tx as never, { id: "w2", productionPedidoId: "ped-1" }, actor);
    expect(closed).toBe(true);
    expect(r.calls.indexOf("for:update:pedido")).toBeGreaterThan(r.calls.indexOf("select:pedido"));
    expect(r.calls.indexOf("for:update:pedido")).toBeLessThan(r.calls.indexOf("select:hermanas"));
    expect(r.updates).toHaveLength(1);
    expect(r.events).toHaveLength(1);
  });

  it("no cierra mientras falte una hermana, y es monótono si el pedido ya está ENTREGADO", async () => {
    const pending = recordingTx({
      pedidoEstado: "EN_ENVASADO",
      siblings: [
        { id: "w1", operationalStatus: "entregado", sector: "ENVASADO_MASIVO" },
        { id: "w2", operationalStatus: "en_curso", sector: "CODIFICADO" },
      ],
    });
    expect(await closePedidoIfAllDelivered(pending.tx as never, { id: "w1", productionPedidoId: "ped-1" }, actor)).toBe(false);
    expect(pending.updates).toHaveLength(0);

    const already = recordingTx({ pedidoEstado: "ENTREGADO", siblings: [] });
    expect(await closePedidoIfAllDelivered(already.tx as never, { id: "w1", productionPedidoId: "ped-1" }, actor)).toBe(false);
    expect(already.events).toHaveLength(0);
  });
});
