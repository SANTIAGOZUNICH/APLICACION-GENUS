import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests de assignWorkItemDurable con un fake tx que simula Neon (mismo
 * patrón que ensure-oa-on-assign.test.ts). Cubren la asignación
 * origen-Pedido: transición de estado del Pedido según sector, "nunca
 * retrocede", y rechazo explícito de Pedido inexistente/borrado — sin
 * tocar OA/OE (ningún test manda orderNumber, así que ensureOaForAssignment
 * nunca se invoca).
 */

type FakeWorkItem = Record<string, unknown> & { id: string };
type FakePedido = Record<string, unknown> & { id: string; estado: string | null };

function createFakeDb() {
  const workItems = new Map<string, FakeWorkItem>();
  const planningWeeks = new Map<string, Record<string, unknown> & { id: string }>();
  const productionPedidos = new Map<string, FakePedido>();
  const productionPedidoStatusEvents: Record<string, unknown>[] = [];
  const operationalEvents: Record<string, unknown>[] = [];
  let seq = 0;
  const nextId = (p: string) => `${p}-${++seq}`;

  function matchCond(row: Record<string, unknown>, cond: unknown): boolean {
    if (!cond) return true;
    if (Array.isArray(cond)) return cond.every((c) => matchCond(row, c));
    const c = cond as { __eq?: [string, unknown] };
    if (c.__eq) return row[c.__eq[0]] === c.__eq[1];
    // Predicado SQL crudo (ej. deleted_at IS NULL) — no introspectable en el
    // fake; los tests simulan "borrado"/"inexistente" simplemente no
    // insertando la fila, así que esto siempre puede tratarse como cierto.
    return true;
  }

  function selectApi(rows: Map<string, Record<string, unknown>> | Record<string, unknown>[]) {
    let cond: unknown = null;
    const all = () => (Array.isArray(rows) ? rows : [...rows.values()]);
    const api = {
      from() {
        return api;
      },
      where(c: unknown) {
        cond = c;
        return api;
      },
      limit(n: number) {
        // Postgres devuelve filas independientes — clonar para que una
        // mutación posterior vía UPDATE no reescriba silenciosamente un
        // snapshot ya leído (fidelidad del fake, no del código real).
        return Promise.resolve(
          all()
            .filter((r) => matchCond(r, cond))
            .slice(0, n)
            .map((r) => ({ ...r }))
        );
      },
    };
    return api;
  }

  const tx = {
    select() {
      return {
        from(t: { __name: string }) {
          const target =
            t.__name === "workItems"
              ? workItems
              : t.__name === "planningWeeks"
                ? planningWeeks
                : t.__name === "productionPedidos"
                  ? productionPedidos
                  : workItems;
          return selectApi(target);
        },
      };
    },
    insert(table: { __name: string }) {
      return {
        values(row: Record<string, unknown>) {
          if (table.__name === "workItems") {
            const id = (row.id as string) ?? nextId("wi");
            const stored: FakeWorkItem = {
              status: "PUBLICADO",
              version: 1,
              publishedAt: new Date(),
              createdAt: new Date(),
              updatedAt: new Date(),
              plannedDateTo: null,
              orderId: null,
              orderNumber: null,
              productionPedidoId: null,
              deliveryDate: null,
              packagingLote: null,
              packagingVto: null,
              packagingTotalUnits: null,
              notes: null,
              ...row,
              id,
            };
            workItems.set(id, stored);
            return { returning: () => Promise.resolve([stored]) };
          }
          if (table.__name === "planningWeeks") {
            const id = (row.id as string) ?? nextId("week");
            const stored = {
              status: "PUBLISHED",
              version: 1,
              createdAt: new Date(),
              updatedAt: new Date(),
              publishedAt: new Date(),
              ...row,
              id,
            };
            planningWeeks.set(id, stored);
            return { returning: () => Promise.resolve([stored]) };
          }
          if (table.__name === "operationalEvents") {
            operationalEvents.push(row);
            return Promise.resolve();
          }
          if (table.__name === "productionPedidoStatusEvents") {
            productionPedidoStatusEvents.push(row);
            return Promise.resolve();
          }
          return Promise.resolve();
        },
      };
    },
    update(table: { __name: string }) {
      return {
        set(patch: Record<string, unknown>) {
          return {
            where(cond: unknown) {
              if (table.__name === "productionPedidos") {
                for (const row of productionPedidos.values()) {
                  if (matchCond(row, cond)) Object.assign(row, patch);
                }
              }
              if (table.__name === "planningWeeks") {
                for (const row of planningWeeks.values()) {
                  if (matchCond(row, cond)) Object.assign(row, patch);
                }
              }
              return Promise.resolve();
            },
          };
        },
      };
    },
    transaction(fn: (tx: unknown) => unknown) {
      return fn(tx);
    },
  };

  return {
    tx,
    workItems,
    planningWeeks,
    productionPedidos,
    productionPedidoStatusEvents,
    operationalEvents,
  };
}

let fakeDbHandle: ReturnType<typeof createFakeDb>;

vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual<typeof import("drizzle-orm")>("drizzle-orm");
  return {
    ...actual,
    eq: (col: { name?: string } | string, val: unknown) => ({
      __eq: [typeof col === "string" ? col : (col as { name?: string }).name ?? "id", val],
    }),
    and: (...args: unknown[]) => args,
    sql: actual.sql,
  };
});

vi.mock("@/lib/db/client", () => ({
  getDb: () => ({ transaction: (fn: (tx: unknown) => unknown) => fn(fakeDbHandle.tx) }),
}));

vi.mock("@/lib/db/schema", () => {
  const table = (name: string, cols: string[]) => {
    const t: Record<string, unknown> = { __name: name };
    for (const c of cols) t[c] = { name: c };
    return t;
  };
  return {
    workItems: table("workItems", [
      "id",
      "originRef",
      "planningWeekId",
      "sector",
      "productionPedidoId",
    ]),
    planningWeeks: table("planningWeeks", ["id", "weekStart", "status"]),
    productionPedidos: table("productionPedidos", ["id", "estado", "deletedAt"]),
    productionPedidoStatusEvents: table("productionPedidoStatusEvents", []),
    operationalEvents: table("operationalEvents", []),
    operationalOrders: table("operationalOrders", ["id", "orderNumber", "linkedWorkItemId"]),
  };
});

describe("assignWorkItemDurable — origen Pedido (fake tx)", () => {
  let assignWorkItemDurable: typeof import("./work-assignment-service").assignWorkItemDurable;

  const actor = {
    email: "produccion@laboratoriogenus.com.ar",
    sector: "PRODUCCION",
    displayName: "Producción",
  };

  function seedPedido(estado: string | null) {
    fakeDbHandle.productionPedidos.set("pedido-1", {
      id: "pedido-1",
      estado,
      deletedAt: null,
    });
  }

  beforeEach(async () => {
    vi.resetModules();
    fakeDbHandle = createFakeDb();
    ({ assignWorkItemDurable } = await import("./work-assignment-service"));
  });

  it("1) Envasado Masivo con Pedido → crea trabajo y pedido pasa a EN_ENVASADO", async () => {
    seedPedido("INGRESO");
    const result = await assignWorkItemDurable(
      {
        sector: "ENVASADO_MASIVO",
        client: "Cliente A",
        product: "Crema",
        plannedQuantity: "500",
        plannedDate: "2026-08-24",
        line: "Línea 1",
        productionPedidoId: "pedido-1",
        idempotencyKey: "idem-masivo-000001",
      },
      actor
    );
    expect(result.item.productionPedidoId).toBe("pedido-1");
    expect(fakeDbHandle.productionPedidos.get("pedido-1")!.estado).toBe("EN_ENVASADO");
    expect(fakeDbHandle.productionPedidoStatusEvents).toHaveLength(1);
    expect(fakeDbHandle.productionPedidoStatusEvents[0]).toMatchObject({
      fromEstado: "INGRESO",
      toEstado: "EN_ENVASADO",
      event: "WORK_ITEM_ASSIGNED",
    });
  });

  it("2) Envasado Premium con Pedido → pedido pasa a EN_ENVASADO", async () => {
    seedPedido("INGRESO");
    await assignWorkItemDurable(
      {
        sector: "ENVASADO_PREMIUM",
        client: "Cliente B",
        product: "Serum",
        plannedQuantity: "300",
        plannedDate: "2026-08-24",
        line: "Línea 1",
        productionPedidoId: "pedido-1",
        idempotencyKey: "idem-premium-000001",
      },
      actor
    );
    expect(fakeDbHandle.productionPedidos.get("pedido-1")!.estado).toBe("EN_ENVASADO");
  });

  it("3) Codificado con Pedido → pedido pasa a EN_ENVASADO (no existe EN_CODIFICADO)", async () => {
    seedPedido("INGRESO");
    await assignWorkItemDurable(
      {
        sector: "CODIFICADO",
        client: "Cliente C",
        product: "Loción",
        plannedQuantity: "100",
        plannedDate: "2026-08-24",
        productionPedidoId: "pedido-1",
        idempotencyKey: "idem-codificado-000001",
      },
      actor
    );
    expect(fakeDbHandle.productionPedidos.get("pedido-1")!.estado).toBe("EN_ENVASADO");
  });

  it("4) Elaboración con Pedido → pedido pasa a EN_ELABORACION", async () => {
    seedPedido("INGRESO");
    const result = await assignWorkItemDurable(
      {
        sector: "ELABORACION",
        client: "Cliente D",
        product: "Base",
        plannedQuantity: "120.5",
        unit: "kg",
        plannedDate: "2026-08-24",
        branchOwner: "Cristian",
        productionPedidoId: "pedido-1",
        idempotencyKey: "idem-elaboracion-000001",
      },
      actor
    );
    expect(result.item.plannedQuantity).toBe("120.5");
    expect(fakeDbHandle.productionPedidos.get("pedido-1")!.estado).toBe("EN_ELABORACION");
  });

  it("5) Nunca retrocede: un segundo trabajo en Elaboración no baja un pedido ya EN_ENVASADO", async () => {
    seedPedido("INGRESO");
    await assignWorkItemDurable(
      {
        sector: "ENVASADO_PREMIUM",
        client: "Cliente E",
        product: "Serum",
        plannedQuantity: "300",
        plannedDate: "2026-08-24",
        line: "Línea 1",
        productionPedidoId: "pedido-1",
        idempotencyKey: "idem-multi-000001",
      },
      actor
    );
    expect(fakeDbHandle.productionPedidos.get("pedido-1")!.estado).toBe("EN_ENVASADO");

    await assignWorkItemDurable(
      {
        sector: "ELABORACION",
        client: "Cliente E",
        product: "Serum — insumo",
        plannedQuantity: "50",
        unit: "kg",
        plannedDate: "2026-08-24",
        branchOwner: "Nicolás",
        productionPedidoId: "pedido-1",
        idempotencyKey: "idem-multi-000002",
      },
      actor
    );
    // Un pedido con varios work items refleja la fase más avanzada real —
    // no puede "retroceder" a EN_ELABORACION porque el segundo trabajo es
    // de un sector anterior en el flujo.
    expect(fakeDbHandle.productionPedidos.get("pedido-1")!.estado).toBe("EN_ENVASADO");
    expect(fakeDbHandle.productionPedidoStatusEvents).toHaveLength(1);
  });

  it("6) Pedido inexistente → PlanningValidationError 'Pedido no encontrado.', sin crear nada", async () => {
    await expect(
      assignWorkItemDurable(
        {
          sector: "ENVASADO_MASIVO",
          client: "Cliente F",
          product: "Crema",
          plannedQuantity: "10",
          plannedDate: "2026-08-24",
          line: "Línea 1",
          productionPedidoId: "no-existe",
          idempotencyKey: "idem-notfound-000001",
        },
        actor
      )
    ).rejects.toMatchObject({ name: "PlanningValidationError", message: "Pedido no encontrado." });
    expect(fakeDbHandle.workItems.size).toBe(0);
    expect(fakeDbHandle.productionPedidoStatusEvents).toHaveLength(0);
  });

  it("7) Reintento con la misma idempotencyKey no duplica el trabajo ni retransiciona el pedido", async () => {
    seedPedido("INGRESO");
    const input = {
      sector: "ENVASADO_MASIVO" as const,
      client: "Cliente G",
      product: "Crema",
      plannedQuantity: "500",
      plannedDate: "2026-08-24",
      line: "Línea 1",
      productionPedidoId: "pedido-1",
      idempotencyKey: "idem-replay-000001",
    };
    const first = await assignWorkItemDurable(input, actor);
    const second = await assignWorkItemDurable(input, actor);
    expect(second.replayed).toBe(true);
    expect(second.item.id).toBe(first.item.id);
    expect(fakeDbHandle.workItems.size).toBe(1);
    expect(fakeDbHandle.productionPedidoStatusEvents).toHaveLength(1);
  });

  it("8) Trabajo sin Pedido (productionPedidoId ausente) no toca production_pedidos", async () => {
    await assignWorkItemDurable(
      {
        sector: "ENVASADO_MASIVO",
        client: "Cliente H",
        product: "Crema",
        plannedQuantity: "10",
        plannedDate: "2026-08-24",
        line: "Línea 1",
        idempotencyKey: "idem-nopedido-000001",
      },
      actor
    );
    expect(fakeDbHandle.productionPedidoStatusEvents).toHaveLength(0);
  });
});
