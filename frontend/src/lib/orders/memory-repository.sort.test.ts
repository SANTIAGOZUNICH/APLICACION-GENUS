import { describe, expect, it } from "vitest";
import { MemoryOrdersRepository } from "./memory-repository";
import type { OperationalOrderRecord } from "./types";

/**
 * AUDIT_ORDENAMIENTO_GLOBAL — bug real encontrado y corregido: el sort
 * "numero" de la lista de OA/OE comparaba orderNumber como string plano
 * (localeCompare), lo que da resultado numéricamente incorrecto al mezclar
 * números con y sin padding — ej. "OA-2026-99" (autogenerado desde pedido,
 * ver pedido-order-ref.ts) vs "OA-2026-000145" (histórico, con padding):
 * comparación caracter a caracter pone "0" antes que "9", así que 145
 * "ganaba" a 99, que es incorrecto. Ahora usa compareNumericField (extrae
 * el número real y compara numéricamente), igual que el resto de la app.
 */
function makeOrder(overrides: Partial<OperationalOrderRecord>): OperationalOrderRecord {
  const now = "2026-08-03T12:00:00.000Z";
  return {
    id: overrides.id ?? "id",
    orderNumber: "OA-2026-1",
    type: "OA",
    templateId: "t1",
    templateVersion: 1,
    templateSnapshot: { kind: "OA" } as never,
    product: "Producto",
    client: "Cliente",
    code: "",
    lot: "",
    assignedSector: "ENVASADO_MASIVO",
    formulaProductId: null,
    formulaVersionId: null,
    formulaVersionHash: null,
    status: "BORRADOR",
    formData: { kind: "OA" } as never,
    completionPercentage: 0,
    revision: 1,
    version: 1,
    linkedWorkItemId: null,
    reviewedAt: null,
    reviewedBy: null,
    completedAt: null,
    completedBy: null,
    createdBy: "test@genus",
    updatedBy: "test@genus",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("MemoryOrdersRepository.listOrders — sort=numero es numérico, no lexicográfico", () => {
  it("ordena OA-2026-2, OA-2026-9, OA-2026-99, OA-2026-000145 numéricamente, sin importar el padding", async () => {
    const repo = new MemoryOrdersRepository(false);
    repo.orders.set("a", makeOrder({ id: "a", orderNumber: "OA-2026-000145" }));
    repo.orders.set("b", makeOrder({ id: "b", orderNumber: "OA-2026-99" }));
    repo.orders.set("c", makeOrder({ id: "c", orderNumber: "OA-2026-2" }));
    repo.orders.set("d", makeOrder({ id: "d", orderNumber: "OA-2026-9" }));

    const { items } = await repo.listOrders({ sort: "numero" });
    expect(items.map((o) => o.orderNumber)).toEqual([
      "OA-2026-2",
      "OA-2026-9",
      "OA-2026-99",
      "OA-2026-000145",
    ]);
  });

  it("nunca produce el orden lexicográfico incorrecto (000145 antes que 99)", async () => {
    const repo = new MemoryOrdersRepository(false);
    repo.orders.set("a", makeOrder({ id: "a", orderNumber: "OA-2026-000145" }));
    repo.orders.set("b", makeOrder({ id: "b", orderNumber: "OA-2026-99" }));

    const { items } = await repo.listOrders({ sort: "numero" });
    // Bug real: antes, "OA-2026-000145" (145) quedaba ANTES que "OA-2026-99" (99).
    expect(items[0]!.orderNumber).toBe("OA-2026-99");
    expect(items[1]!.orderNumber).toBe("OA-2026-000145");
  });
});
