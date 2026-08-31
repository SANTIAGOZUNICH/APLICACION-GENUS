import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * DECISIÓN_FUNCIONAL (PR #81, cuarta vuelta) — ensureOeForAssignment.
 * Antes, Elaboración con un orderNumber que no existía todavía (típicamente
 * el OE-{año}-{número} autogenerado desde el N° de Pedido, ver
 * pedido-order-ref.ts) hacía fallar la asignación entera con "No se
 * encontró la orden indicada (OE/OA)." — el lookup era obligatorio, sin
 * auto-crear, a diferencia de OA (ensureOaForAssignment ya auto-creaba).
 * Estos tests prueban assignWorkItemDurable end-to-end para Elaboración con
 * un fake tx que simula Neon (mismo patrón que work-assignment-service.test.ts,
 * extendido acá con operational_orders/order_templates/order_versions/
 * order_audit_events/order_number_sequences — las tablas que ensureOa/
 * ensureOeForAssignment tocan y que el harness original no necesitaba
 * porque ningún test existente mandaba orderNumber).
 */

type FakeRow = Record<string, unknown> & { id: string };

function createFakeDb() {
  const workItems = new Map<string, FakeRow>();
  const planningWeeks = new Map<string, FakeRow>();
  const productionPedidos = new Map<string, FakeRow>();
  const productionPedidoStatusEvents: Record<string, unknown>[] = [];
  const operationalEvents: Record<string, unknown>[] = [];
  const operationalOrders = new Map<string, FakeRow & { orderNumber: string }>();
  const orderTemplates = new Map<string, FakeRow>();
  const orderVersions: Record<string, unknown>[] = [];
  const orderAuditEvents: Record<string, unknown>[] = [];
  const orderNumberSequences = new Map<string, Record<string, unknown>>();
  let seq = 0;
  const nextId = (p: string) => `${p}-${++seq}`;

  function matchCond(row: Record<string, unknown>, cond: unknown): boolean {
    if (!cond) return true;
    if (Array.isArray(cond)) return cond.every((c) => matchCond(row, c));
    const c = cond as { __eq?: [string, unknown] };
    if (c.__eq) return row[c.__eq[0]] === c.__eq[1];
    // Predicado SQL crudo (ej. deleted_at IS NULL, "linkedWorkItemId IS NULL
    // OR = ''") — no introspectable en el fake; ensureOeForAssignment ya
    // rechaza ANTES de esto si la orden ya estaba vinculada a otro trabajo,
    // así que para los casos que este archivo prueba tratarlo como cierto
    // es fiel al comportamiento real.
    return true;
  }

  function tableMap(name: string): Map<string, FakeRow> | null {
    switch (name) {
      case "workItems":
        return workItems;
      case "planningWeeks":
        return planningWeeks;
      case "productionPedidos":
        return productionPedidos;
      case "operationalOrders":
        return operationalOrders;
      case "orderTemplates":
        return orderTemplates;
      default:
        return null;
    }
  }

  const tx = {
    select() {
      let target: Record<string, unknown>[] = [];
      let cond: unknown = null;
      const api = {
        from(t: { __name: string }) {
          const m = tableMap(t.__name);
          target = m
            ? [...m.values()]
            : t.__name === "orderVersions"
              ? orderVersions
              : t.__name === "orderAuditEvents"
                ? orderAuditEvents
                : t.__name === "orderNumberSequences"
                  ? [...orderNumberSequences.values()]
                  : [];
          return api;
        },
        where(c: unknown) {
          cond = c;
          return api;
        },
        limit(n: number) {
          return Promise.resolve(
            target
              .filter((r) => matchCond(r, cond))
              .slice(0, n)
              .map((r) => ({ ...r }))
          );
        },
      };
      return api;
    },
    insert(table: { __name: string }) {
      return {
        values(row: Record<string, unknown>) {
          if (table.__name === "workItems") {
            const id = (row.id as string) ?? nextId("wi");
            const stored: FakeRow = {
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
            const stored: FakeRow = {
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
          if (table.__name === "orderTemplates") {
            const id = row.id as string;
            orderTemplates.set(id, { ...row, id });
            return Promise.resolve();
          }
          if (table.__name === "operationalOrders") {
            const id = row.id as string;
            const orderNumber = row.orderNumber as string;
            const dupe = [...operationalOrders.values()].find(
              (o) => o.orderNumber === orderNumber
            );
            if (dupe) {
              // Simula la unique index real (operational_orders_number_uidx)
              // — mismo mensaje que ensureOeForAssignment/ensureOaForAssignment
              // reconocen para convertirlo en PlanningConflictError.
              throw new Error(
                'duplicate key value violates unique constraint "operational_orders_number_uidx"'
              );
            }
            operationalOrders.set(id, { ...row, id, orderNumber } as FakeRow & {
              orderNumber: string;
            });
            return Promise.resolve();
          }
          if (table.__name === "orderVersions") {
            orderVersions.push(row);
            return Promise.resolve();
          }
          if (table.__name === "orderAuditEvents") {
            orderAuditEvents.push(row);
            return Promise.resolve();
          }
          if (table.__name === "orderNumberSequences") {
            const key = `${row.type}:${row.year}`;
            return {
              onConflictDoNothing() {
                if (!orderNumberSequences.has(key)) {
                  orderNumberSequences.set(key, { ...row });
                }
                return Promise.resolve();
              },
            };
          }
          return Promise.resolve();
        },
      };
    },
    update(table: { __name: string }) {
      return {
        set(patch: Record<string, unknown>) {
          const applyAndCollect = (target: Map<string, FakeRow>) => {
            const updated: FakeRow[] = [];
            for (const row of target.values()) {
              // sql`col + 1` / sql`GREATEST(...)` no son evaluables en el
              // fake — se omiten del patch aplicado (nunca se leen en los
              // asserts de estos tests), el resto de campos sí se aplica.
              const safePatch = Object.fromEntries(
                Object.entries(patch).filter(([, v]) => typeof v !== "object" || v === null)
              );
              Object.assign(row, safePatch);
              updated.push({ ...row });
            }
            return updated;
          };
          return {
            where(cond: unknown) {
              let matched: FakeRow[] = [];
              if (table.__name === "productionPedidos") {
                matched = applyAndCollect(productionPedidos).filter((r) => matchCond(r, cond));
              } else if (table.__name === "planningWeeks") {
                matched = applyAndCollect(planningWeeks).filter((r) => matchCond(r, cond));
              } else if (table.__name === "operationalOrders") {
                const target = new Map(
                  [...operationalOrders.entries()].filter(([, r]) => matchCond(r, cond))
                );
                matched = applyAndCollect(target);
              }
              return {
                returning: () => Promise.resolve(matched),
                then: (resolve: (v: FakeRow[]) => unknown) => Promise.resolve(resolve(matched)),
              };
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
    operationalOrders,
    orderTemplates,
    orderVersions,
    orderAuditEvents,
    orderNumberSequences,
  };
}

let fakeDbHandle: ReturnType<typeof createFakeDb>;

vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual<typeof import("drizzle-orm")>("drizzle-orm");
  return {
    ...actual,
    eq: (col: { name?: string } | string, val: unknown) => ({
      __eq: [typeof col === "string" ? col : ((col as { name?: string }).name ?? "id"), val],
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
      "orderId",
    ]),
    planningWeeks: table("planningWeeks", ["id", "weekStart", "status"]),
    productionPedidos: table("productionPedidos", ["id", "estado", "deletedAt"]),
    productionPedidoStatusEvents: table("productionPedidoStatusEvents", []),
    operationalEvents: table("operationalEvents", []),
    operationalOrders: table("operationalOrders", [
      "id",
      "orderNumber",
      "type",
      "product",
      "client",
      "lot",
      "code",
      "formData",
      "status",
      "version",
      "assignedSector",
      "linkedWorkItemId",
    ]),
    orderTemplates: table("orderTemplates", ["id"]),
    orderVersions: table("orderVersions", ["id"]),
    orderAuditEvents: table("orderAuditEvents", ["id"]),
    orderNumberSequences: table("orderNumberSequences", ["id", "type", "year", "lastValue"]),
  };
});

describe("assignWorkItemDurable — Elaboración con ensureOeForAssignment (fake tx)", () => {
  let assignWorkItemDurable: typeof import("./work-assignment-service").assignWorkItemDurable;

  const actor = {
    email: "produccion@laboratoriogenus.com.ar",
    sector: "PRODUCCION",
    displayName: "Producción",
  };

  beforeEach(async () => {
    vi.resetModules();
    fakeDbHandle = createFakeDb();
    ({ assignWorkItemDurable } = await import("./work-assignment-service"));
  });

  it("1) Pedido + Elaboración: OE autogenerada inexistente (OE-2026-000200) → se crea y se asigna, ya no falla", async () => {
    const result = await assignWorkItemDurable(
      {
        sector: "ELABORACION",
        client: "Cliente Elab",
        product: "Base Crema",
        plannedQuantity: "120.5",
        unit: "kg",
        plannedDate: "2026-08-24",
        branchOwner: "Cristian",
        orderNumber: "OE-2026-000200",
        idempotencyKey: "idem-oe-000001",
      },
      actor
    );
    expect(result.order?.orderNumber).toBe("OE-2026-000200");
    expect(result.order?.created).toBe(true);
    // Segunda lectura real — directo contra el fake tx, no solo el retorno.
    const orders = [...fakeDbHandle.operationalOrders.values()];
    expect(orders).toHaveLength(1);
    expect(orders[0]!.type).toBe("OE");
    expect(orders[0]!.orderNumber).toBe("OE-2026-000200");
  });

  it("2) OE ya existente y compatible (mismo producto/cliente) → se reutiliza, no se crea una segunda", async () => {
    fakeDbHandle.operationalOrders.set("oe-existing", {
      id: "oe-existing",
      orderNumber: "OE-2026-000201",
      type: "OE",
      product: "Base Crema",
      client: "Cliente Elab",
      lot: "",
      code: "",
      formData: { kind: "OE", header: {} },
      status: "BORRADOR",
      version: 1,
      assignedSector: "ELABORACION",
      linkedWorkItemId: null,
    });

    const result = await assignWorkItemDurable(
      {
        sector: "ELABORACION",
        client: "Cliente Elab",
        product: "Base Crema",
        plannedQuantity: "80",
        unit: "kg",
        plannedDate: "2026-08-24",
        branchOwner: "Nicolás",
        orderNumber: "OE-2026-000201",
        idempotencyKey: "idem-oe-000002",
      },
      actor
    );
    expect(result.order?.orderNumber).toBe("OE-2026-000201");
    expect(result.order?.created).toBe(false);
    expect(result.order?.linked).toBe(true);
    expect(fakeDbHandle.operationalOrders.size).toBe(1);
  });

  it("3) OE existente ya vinculada a OTRO trabajo → rechazo (1 trabajo = 1 OE)", async () => {
    fakeDbHandle.operationalOrders.set("oe-taken", {
      id: "oe-taken",
      orderNumber: "OE-2026-000202",
      type: "OE",
      product: "Base Crema",
      client: "Cliente Elab",
      lot: "",
      code: "",
      formData: { kind: "OE", header: {} },
      status: "BORRADOR",
      version: 1,
      assignedSector: "ELABORACION",
      linkedWorkItemId: "otro-work-item-id",
    });

    await expect(
      assignWorkItemDurable(
        {
          sector: "ELABORACION",
          client: "Cliente Elab",
          product: "Base Crema",
          plannedQuantity: "80",
          unit: "kg",
          plannedDate: "2026-08-24",
          branchOwner: "Nicolás",
          orderNumber: "OE-2026-000202",
          idempotencyKey: "idem-oe-000003",
        },
        actor
      )
    ).rejects.toMatchObject({ name: "PlanningConflictError" });
    // Sin cambios — no se creó un segundo trabajo ni se tocó la OE existente.
    expect(fakeDbHandle.workItems.size).toBe(0);
    expect(fakeDbHandle.operationalOrders.get("oe-taken")!.linkedWorkItemId).toBe(
      "otro-work-item-id"
    );
  });

  it("4) reintento con la misma idempotencyKey no duplica la OE ni el trabajo", async () => {
    const input = {
      sector: "ELABORACION" as const,
      client: "Cliente Elab",
      product: "Base Crema",
      plannedQuantity: "120.5",
      unit: "kg",
      plannedDate: "2026-08-24",
      branchOwner: "Cristian",
      orderNumber: "OE-2026-000203",
      idempotencyKey: "idem-oe-000004",
    };
    const first = await assignWorkItemDurable(input, actor);
    const second = await assignWorkItemDurable(input, actor);
    expect(second.replayed).toBe(true);
    expect(second.item.id).toBe(first.item.id);
    expect(fakeDbHandle.workItems.size).toBe(1);
    expect(fakeDbHandle.operationalOrders.size).toBe(1);
  });

  it("5) persistencia real del vínculo: linkedWorkItemId en operational_orders queda igual al id del work item creado", async () => {
    const result = await assignWorkItemDurable(
      {
        sector: "ELABORACION",
        client: "Cliente Elab",
        product: "Base Crema",
        plannedQuantity: "50",
        unit: "kg",
        plannedDate: "2026-08-24",
        branchOwner: "Cristian",
        orderNumber: "OE-2026-000204",
        idempotencyKey: "idem-oe-000005",
      },
      actor
    );
    const persistedOrder = [...fakeDbHandle.operationalOrders.values()].find(
      (o) => o.orderNumber === "OE-2026-000204"
    );
    expect(persistedOrder).toBeTruthy();
    expect(persistedOrder!.linkedWorkItemId).toBe(result.item.id);
    // El work item persistido también apunta a la misma orden.
    const persistedItem = fakeDbHandle.workItems.get(result.item.id)!;
    expect(persistedItem.orderId).toBe(persistedOrder!.id);
    expect(persistedItem.orderNumber).toBe("OE-2026-000204");
  });

  it("6) Envasado/Codificado siguen usando OA sin regresión (no se cuela una OE)", async () => {
    const result = await assignWorkItemDurable(
      {
        sector: "ENVASADO_MASIVO",
        client: "Cliente Envasado",
        product: "Shampoo",
        plannedQuantity: "500",
        plannedDate: "2026-08-24",
        line: "Línea 1",
        orderNumber: "OA-2026-000300",
        idempotencyKey: "idem-oa-000001",
      },
      actor
    );
    expect(result.order?.orderNumber).toBe("OA-2026-000300");
    expect(result.order?.created).toBe(true);
    const orders = [...fakeDbHandle.operationalOrders.values()];
    expect(orders).toHaveLength(1);
    expect(orders[0]!.type).toBe("OA");
  });
});
