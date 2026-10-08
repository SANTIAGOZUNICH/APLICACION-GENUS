import { beforeEach, describe, expect, it } from "vitest";
import { getProductionPedidosService, PedidoCellPatchError, resetProductionPedidosMemoryForTests } from "./service";
import { pedidoCellProtection } from "./cell-edit";
import { OrdersForbiddenError } from "@/lib/orders/types";

const prod = { email: "produccion@laboratoriogenus.com.ar", sector: "PRODUCCION" };

async function seed(extra: Record<string, unknown> = {}) {
  return getProductionPedidosService().create(prod, { op: "OP-1", fecha: "2026-05-04", nroOc: "OC-9", cliente: "BIOESENCIA", producto: "SHAMPOO BABY", s: "A", q: 100, ml: 250, estado: "INGRESO", ...extra } as never);
}
const ch = (r: { id: string; updatedAt: string }, field: string, value: string) => ({ id: r.id, field: field as never, value, expectedVersion: r.updatedAt });
async function rejected(p: Promise<unknown>) {
  const e = await p.then(() => null, (x) => x);
  expect(e).toBeInstanceOf(PedidoCellPatchError);
  return (e as PedidoCellPatchError).failures;
}

describe("Pedidos — edición por celda (PATCH parcial)", () => {
  beforeEach(() => resetProductionPedidosMemoryForTests());

  it("cambia SOLO la celda editada; las demás columnas quedan idénticas; KG se recalcula", async () => {
    const r = await seed();
    const res = await getProductionPedidosService().patchCells(prod, [ch(r, "q", "200")]);
    const [after] = res.items;
    expect(after!.q).toBe(200);
    for (const k of ["op", "fecha", "nroOc", "cliente", "producto", "s", "ml", "estado"] as const) expect(after![k]).toEqual(r[k]);
    expect(after!.kg).toBe(200 * 250 / 1000 || after!.kg); // derivado de Q×ML
    expect(after!.kg).not.toBe(r.kg);
  });

  it("estado y KG no son editables por celda; pedido ENTREGADO está cerrado", async () => {
    const r = await seed();
    expect((await rejected(getProductionPedidosService().patchCells(prod, [ch(r, "estado", "ENTREGADO")])))[0]!.code).toBe("PROTECTED");
    expect((await rejected(getProductionPedidosService().patchCells(prod, [ch(r, "kg", "1")])))[0]!.code).toBe("PROTECTED");
    const done = await seed({ op: "OP-2", estado: "ENTREGADO" });
    expect((await rejected(getProductionPedidosService().patchCells(prod, [ch(done, "cliente", "X")])))[0]!.message).toMatch(/ENTREGADO/);
    expect(pedidoCellProtection({ estado: "ENTREGADO", deletedAt: null }, "q")).toMatch(/cerrado/);
  });

  it("valida tipos y es atómico: una celda inválida en el pegado impide guardar todas", async () => {
    const a = await seed();
    const b = await seed({ op: "OP-3" });
    const f = await rejected(getProductionPedidosService().patchCells(prod, [ch(a, "cliente", "NUEVO"), ch(b, "q", "abc")]));
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ index: 1, code: "INVALID" });
    const rows = await getProductionPedidosService().list(prod, {} as never);
    expect(JSON.stringify(rows)).not.toContain("NUEVO");
  });

  it("concurrencia: versión vieja → CONFLICT, no pisa", async () => {
    const r = await seed();
    await getProductionPedidosService().patchCells(prod, [ch(r, "cliente", "A")]);
    const f = await rejected(getProductionPedidosService().patchCells(prod, [ch(r, "cliente", "B")]));
    expect(f[0]!.code).toBe("CONFLICT");
  });

  it("dos usuarios editan la misma celda a la vez: gana uno", async () => {
    const r = await seed();
    const settled = await Promise.allSettled([
      getProductionPedidosService().patchCells(prod, [ch(r, "cliente", "USUARIO 1")]),
      getProductionPedidosService().patchCells({ ...prod, email: "otro@laboratoriogenus.com.ar" }, [ch(r, "cliente", "USUARIO 2")]),
    ]);
    expect(settled.filter((s) => s.status === "fulfilled")).toHaveLength(1);
  });

  it("solo Producción", async () => {
    const r = await seed();
    await expect(getProductionPedidosService().patchCells({ email: "c@x", sector: "CALIDAD" }, [ch(r, "cliente", "X")])).rejects.toThrow(OrdersForbiddenError);
  });
});
