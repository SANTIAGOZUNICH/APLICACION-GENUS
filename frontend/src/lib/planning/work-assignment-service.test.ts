import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests de assignWorkItemDurable con un fake tx que simula Neon (mismo
 * patrón que ensure-oa-on-assign.test.ts). Cubren la asignación
 * origen-Pedido: transición de estado del Pedido según sector, "nunca
 * retrocede", rechazo explícito de Pedido inexistente/borrado, y la
 * identidad funcional PEDIDO+PRODUCTO+LOTE de OA/OE de punta a punta (a
 * través del entrypoint real, no solo ensureOaForAssignment aislado).
 */

type FakeWorkItem = Record<string, unknown> & { id: string };
type FakePedido = Record<string, unknown> & { id: string; estado: string | null };
type FakeOrder = Record<string, unknown> & {
  id: string;
  orderNumber: string;
  type: string;
  linkedWorkItemId: string | null;
  pedidoId: string | null;
  productIdentityKey: string | null;
  loteIdentityKey: string | null;
  deletedAt: Date | null;
};

function matchCond(row: Record<string, unknown>, cond: unknown): boolean {
  if (!cond) return true;
  if (Array.isArray(cond)) return cond.every((c) => matchCond(row, c));
  const c = cond as { __eq?: [string, unknown]; __isNull?: string; __or?: unknown[] };
  if (c.__eq) return row[c.__eq[0]] === c.__eq[1];
  if (c.__isNull) return row[c.__isNull] == null;
  if (c.__or) return c.__or.some((sub) => matchCond(row, sub));
  // Predicado SQL crudo (ej. deleted_at IS NULL) — no introspectable en el
  // fake; los tests simulan "borrado"/"inexistente" simplemente no
  // insertando la fila, así que esto siempre puede tratarse como cierto.
  return true;
}

function createFakeDb() {
  const workItems = new Map<string, FakeWorkItem>();
  const planningWeeks = new Map<string, Record<string, unknown> & { id: string }>();
  const productionPedidos = new Map<string, FakePedido>();
  const asignacionLotes = new Map<string, Record<string, unknown> & { id: string }>();
  const productionPedidoStatusEvents: Record<string, unknown>[] = [];
  const operationalEvents: Record<string, unknown>[] = [];
  const operationalOrders = new Map<string, FakeOrder>();
  const orderTemplates: Record<string, unknown>[] = [];
  const orderVersions: Record<string, unknown>[] = [];
  const orderAuditEvents: Record<string, unknown>[] = [];
  const orderNumberSequences = new Map<string, number>();
  let seq = 0;
  const nextId = (p: string) => `${p}-${++seq}`;

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
    select(_cols?: unknown) {
      return {
        from(t: { __name: string }) {
          const target =
            t.__name === "workItems"
              ? workItems
              : t.__name === "planningWeeks"
                ? planningWeeks
                : t.__name === "productionPedidos"
                  ? productionPedidos
                  : t.__name === "asignacionLotes"
                    ? asignacionLotes
                    : t.__name === "operationalOrders"
                      ? operationalOrders
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
          if (table.__name === "orderTemplates") {
            orderTemplates.push(row);
            return { onConflictDoNothing: () => Promise.resolve() };
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
            const key = `${row.type}-${row.year}`;
            if (!orderNumberSequences.has(key)) orderNumberSequences.set(key, Number(row.lastValue ?? 0));
            return { onConflictDoNothing: () => Promise.resolve() };
          }
          if (table.__name === "operationalOrders") {
            const num = String(row.orderNumber);
            const pedidoId = (row.pedidoId as string | null) ?? null;
            const productIdentityKey = (row.productIdentityKey as string | null) ?? null;
            const loteIdentityKey = (row.loteIdentityKey as string | null) ?? null;
            const type = String(row.type);
            const numberTaken = [...operationalOrders.values()].some((o) => o.orderNumber === num);
            const identityTaken =
              pedidoId != null &&
              productIdentityKey != null &&
              [...operationalOrders.values()].some(
                (o) =>
                  o.type === type &&
                  o.pedidoId === pedidoId &&
                  o.productIdentityKey === productIdentityKey &&
                  o.loteIdentityKey === loteIdentityKey &&
                  o.deletedAt == null
              );
            if (numberTaken || identityTaken) {
              return Promise.reject(
                new Error(
                  `duplicate key value violates unique constraint "operational_orders_${numberTaken ? "number_uidx" : "identity_uidx"}"`
                )
              );
            }
            const id = String(row.id);
            const stored: FakeOrder = {
              linkedWorkItemId: null,
              ...row,
              id,
              orderNumber: num,
              type,
              pedidoId,
              productIdentityKey,
              loteIdentityKey,
              deletedAt: null,
            };
            operationalOrders.set(id, stored);
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
              if (table.__name === "operationalOrders") {
                const matched: FakeOrder[] = [];
                for (const row of operationalOrders.values()) {
                  if (matchCond(row, cond)) {
                    Object.assign(row, patch);
                    matched.push(row);
                  }
                }
                return { returning: () => Promise.resolve(matched.map((r) => ({ ...r }))) };
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
    asignacionLotes,
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
      __eq: [typeof col === "string" ? col : (col as { name?: string }).name ?? "id", val],
    }),
    isNull: (col: { name?: string } | string) => ({
      __isNull: typeof col === "string" ? col : (col as { name?: string }).name ?? "",
    }),
    or: (...args: unknown[]) => ({ __or: args }),
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
    operationalOrders: table("operationalOrders", [
      "id",
      "orderNumber",
      "linkedWorkItemId",
      "type",
      "product",
      "client",
      "lot",
      "code",
      "formData",
      "status",
      "version",
      "assignedSector",
      "pedidoId",
      "productIdentityKey",
      "loteIdentityKey",
      "deletedAt",
    ]),
    orderTemplates: table("orderTemplates", ["id"]),
    orderVersions: table("orderVersions", ["id"]),
    orderAuditEvents: table("orderAuditEvents", ["id"]),
    orderNumberSequences: table("orderNumberSequences", ["type", "year", "lastValue"]),
    asignacionLotes: table("asignacionLotes", [
      "id",
      "lote",
      "vto",
      "producto",
      "marca",
      "codigo",
      "cantidades",
      "fecha",
      "archived",
    ]),
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

  it("3) Codificado con Pedido → pedido pasa a EN_CODIFICADO (estado real y distinto, migración 0029)", async () => {
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
    expect(fakeDbHandle.productionPedidos.get("pedido-1")!.estado).toBe("EN_CODIFICADO");
  });

  it("3b) Codificado sobre un pedido ya EN_ENVASADO avanza a EN_CODIFICADO (no retrocede, no se queda igual)", async () => {
    seedPedido("EN_ENVASADO");
    await assignWorkItemDurable(
      {
        sector: "CODIFICADO",
        client: "Cliente C2",
        product: "Loción",
        plannedQuantity: "100",
        plannedDate: "2026-08-24",
        productionPedidoId: "pedido-1",
        idempotencyKey: "idem-codificado-000002",
      },
      actor
    );
    expect(fakeDbHandle.productionPedidos.get("pedido-1")!.estado).toBe("EN_CODIFICADO");
  });

  it("3c) Envasado sobre un pedido ya EN_CODIFICADO NO retrocede a EN_ENVASADO", async () => {
    seedPedido("EN_CODIFICADO");
    await assignWorkItemDurable(
      {
        sector: "ENVASADO_MASIVO",
        client: "Cliente C3",
        product: "Loción — reenvasado",
        plannedQuantity: "50",
        plannedDate: "2026-08-24",
        line: "Línea 1",
        productionPedidoId: "pedido-1",
        idempotencyKey: "idem-codificado-000003",
      },
      actor
    );
    expect(fakeDbHandle.productionPedidos.get("pedido-1")!.estado).toBe("EN_CODIFICADO");
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

describe("assignWorkItemDurable — vínculo Asignación de Lotes → WorkItem (fake tx)", () => {
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
    fakeDbHandle.asignacionLotes.set("al-1", {
      id: "al-1",
      lote: "G26043",
      vto: "2028-10-31",
      producto: "SERUM NIACINAMIDA",
      marca: "NIZA",
      codigo: "ABC123",
      cantidades: 1200,
      fecha: "2026-09-10",
      archived: false,
    });
  });

  it("Test 1: hay una asignación de lote única -> el WorkItem se crea con ese lote/VTO exactos", async () => {
    const result = await assignWorkItemDurable(
      {
        sector: "ENVASADO_MASIVO",
        client: "NIZA",
        product: "SERUM NIACINAMIDA",
        plannedQuantity: "1200",
        plannedDate: "2026-09-10",
        line: "Línea 1",
        asignacionLoteId: "al-1",
        idempotencyKey: "idem-lote-000001",
      },
      actor
    );
    expect(result.item.packagingLote).toBe("G26043");
    expect(result.item.packagingVto).toBe("2028-10-31");
    const event = fakeDbHandle.operationalEvents[0] as { note: string };
    expect(event.note).toContain("loteSource=ASIGNACION_LOTES");
    expect(event.note).toContain("asignacionLoteId=al-1");
  });

  it("Test 9: nunca clobber — sin asignacionLoteId, packagingLote/VTO manuales pasan tal cual (sin intentar resolver)", async () => {
    const result = await assignWorkItemDurable(
      {
        sector: "ENVASADO_MASIVO",
        client: "NIZA",
        product: "SERUM NIACINAMIDA",
        plannedQuantity: "1200",
        plannedDate: "2026-09-10",
        line: "Línea 1",
        packagingLote: "MANUAL-1",
        packagingVto: "2030-01-31",
        idempotencyKey: "idem-lote-000002",
      },
      actor
    );
    expect(result.item.packagingLote).toBe("MANUAL-1");
    expect(result.item.packagingVto).toBe("2030-01-31");
    const event = fakeDbHandle.operationalEvents[0] as { note: string };
    expect(event.note).not.toContain("loteSource=ASIGNACION_LOTES");
  });

  it("Test 8: el server relee Asignación de Lotes en el momento de confirmar — si cambió desde que el diálogo resolvió, usa el valor FRESCO", async () => {
    // Simula: el diálogo resolvió al-1 con G26043/2028-10-31, pero entre esa
    // resolución y la confirmación alguien editó la fila en Asignación de
    // Lotes. El cliente todavía manda asignacionLoteId="al-1" (y, en el
    // peor caso, seguiría mostrando el snapshot viejo en pantalla) — el
    // servidor debe usar el valor ACTUAL, nunca el que el diálogo mostró.
    fakeDbHandle.asignacionLotes.get("al-1")!.lote = "G26099";
    fakeDbHandle.asignacionLotes.get("al-1")!.vto = "2029-01-31";

    const result = await assignWorkItemDurable(
      {
        sector: "ENVASADO_MASIVO",
        client: "NIZA",
        product: "SERUM NIACINAMIDA",
        plannedQuantity: "1200",
        plannedDate: "2026-09-10",
        line: "Línea 1",
        asignacionLoteId: "al-1",
        // El cliente todavía manda el snapshot viejo por las dudas —
        // el servidor debe ignorarlo por completo cuando hay un id.
        packagingLote: "G26043",
        packagingVto: "2028-10-31",
        idempotencyKey: "idem-lote-000003",
      },
      actor
    );
    expect(result.item.packagingLote).toBe("G26099");
    expect(result.item.packagingVto).toBe("2029-01-31");
  });

  it("id de Asignación de Lotes ya no existe (se borró/archivó) -> no bloquea, cae a lo recibido manualmente", async () => {
    const result = await assignWorkItemDurable(
      {
        sector: "ENVASADO_MASIVO",
        client: "NIZA",
        product: "SERUM NIACINAMIDA",
        plannedQuantity: "1200",
        plannedDate: "2026-09-10",
        line: "Línea 1",
        asignacionLoteId: "al-inexistente",
        packagingLote: "MANUAL-2",
        packagingVto: null,
        idempotencyKey: "idem-lote-000004",
      },
      actor
    );
    expect(result.item.packagingLote).toBe("MANUAL-2");
    expect(result.item.packagingVto).toBeNull();
  });

  it("id de Asignación de Lotes ya no corresponde a cliente+producto (se editó a otro producto) -> no lo usa, no bloquea", async () => {
    fakeDbHandle.asignacionLotes.get("al-1")!.producto = "OTRO PRODUCTO DISTINTO";
    const result = await assignWorkItemDurable(
      {
        sector: "ENVASADO_MASIVO",
        client: "NIZA",
        product: "SERUM NIACINAMIDA",
        plannedQuantity: "1200",
        plannedDate: "2026-09-10",
        line: "Línea 1",
        asignacionLoteId: "al-1",
        idempotencyKey: "idem-lote-000005",
      },
      actor
    );
    expect(result.item.packagingLote).toBeNull();
    expect(result.item.packagingVto).toBeNull();
  });

  it("Elaboración nunca intenta resolver Asignación de Lotes (no tiene packaging)", async () => {
    const result = await assignWorkItemDurable(
      {
        sector: "ELABORACION",
        client: "NIZA",
        product: "SERUM NIACINAMIDA",
        plannedQuantity: "1200",
        unit: "kg",
        plannedDate: "2026-09-10",
        branchOwner: "Cristian",
        asignacionLoteId: "al-1",
        idempotencyKey: "idem-lote-000006",
      },
      actor
    );
    expect(result.item.packagingLote).toBeNull();
    expect(result.item.packagingVto).toBeNull();
  });

  it("Test 10: se asigna sin lote/VTO (ninguna asignación coincide) -> el WorkItem se crea igual, sin bloquear", async () => {
    const result = await assignWorkItemDurable(
      {
        sector: "ENVASADO_MASIVO",
        client: "OTRO CLIENTE",
        product: "OTRO PRODUCTO",
        plannedQuantity: "10",
        plannedDate: "2026-09-10",
        line: "Línea 1",
        idempotencyKey: "idem-lote-000007",
      },
      actor
    );
    expect(result.item.id).toBeTruthy();
    expect(result.item.packagingLote).toBeNull();
    expect(result.item.packagingVto).toBeNull();
  });
});

describe("assignWorkItemDurable — identidad PEDIDO+PRODUCTO+LOTE de punta a punta (fake tx)", () => {
  let assignWorkItemDurable: typeof import("./work-assignment-service").assignWorkItemDurable;

  const actor = {
    email: "produccion@laboratoriogenus.com.ar",
    sector: "PRODUCCION",
    displayName: "Producción",
  };

  function seedPedido(id: string, estado: string | null = "INGRESO") {
    fakeDbHandle.productionPedidos.set(id, { id, estado, deletedAt: null });
  }

  beforeEach(async () => {
    vi.resetModules();
    fakeDbHandle = createFakeDb();
    ({ assignWorkItemDurable } = await import("./work-assignment-service"));
    seedPedido("pedido-1");
  });

  it("1) mismo pedido+producto+lote, dos días distintos -> misma OA (no duplica)", async () => {
    const monday = await assignWorkItemDurable(
      {
        sector: "ENVASADO_MASIVO",
        client: "NIZA",
        product: "SERUM NIACINAMIDA",
        plannedQuantity: "300",
        plannedDate: "2026-09-14",
        line: "Línea 1",
        productionPedidoId: "pedido-1",
        packagingLote: "S26018",
        orderNumber: "OA-2026-000123",
        idempotencyKey: "idem-identity-000001",
      },
      actor
    );
    const tuesday = await assignWorkItemDurable(
      {
        sector: "ENVASADO_MASIVO",
        client: "NIZA",
        product: "SERUM NIACINAMIDA",
        plannedQuantity: "200",
        plannedDate: "2026-09-15",
        line: "Línea 1",
        productionPedidoId: "pedido-1",
        packagingLote: "S26018",
        // Número distinto: la reutilización debe venir de la identidad, no
        // de que el N° de OA haya coincidido por casualidad.
        orderNumber: "OA-2026-000124",
        idempotencyKey: "idem-identity-000002",
      },
      actor
    );

    expect(monday.order?.id).toBeTruthy();
    expect(tuesday.order?.id).toBe(monday.order!.id);
    expect(tuesday.item.orderId).toBe(monday.item.orderId);
    expect(fakeDbHandle.operationalOrders.size).toBe(1);
  });

  it("2) mismo pedido+producto+lote, tres WorkItems -> misma OA", async () => {
    const days = ["2026-09-14", "2026-09-15", "2026-09-16"];
    const results = [];
    for (let i = 0; i < days.length; i++) {
      results.push(
        await assignWorkItemDurable(
          {
            sector: "ENVASADO_MASIVO",
            client: "NIZA",
            product: "SERUM NIACINAMIDA",
            plannedQuantity: "100",
            plannedDate: days[i],
            line: "Línea 1",
            productionPedidoId: "pedido-1",
            packagingLote: "S26020",
            orderNumber: `OA-2026-00050${i}`,
            idempotencyKey: `idem-identity-0000${10 + i}`,
          },
          actor
        )
      );
    }
    const orderIds = new Set(results.map((r) => r.item.orderId));
    expect(orderIds.size).toBe(1);
    expect(fakeDbHandle.operationalOrders.size).toBe(1);
  });

  it("3) mismo pedido+producto pero OTRO lote -> nueva OA (no reutiliza)", async () => {
    const first = await assignWorkItemDurable(
      {
        sector: "ENVASADO_MASIVO",
        client: "NIZA",
        product: "SERUM NIACINAMIDA",
        plannedQuantity: "300",
        plannedDate: "2026-09-14",
        line: "Línea 1",
        productionPedidoId: "pedido-1",
        packagingLote: "S26018",
        orderNumber: "OA-2026-000200",
        idempotencyKey: "idem-identity-000020",
      },
      actor
    );
    const second = await assignWorkItemDurable(
      {
        sector: "ENVASADO_MASIVO",
        client: "NIZA",
        product: "SERUM NIACINAMIDA",
        plannedQuantity: "300",
        plannedDate: "2026-09-15",
        line: "Línea 1",
        productionPedidoId: "pedido-1",
        packagingLote: "S26045",
        orderNumber: "OA-2026-000201",
        idempotencyKey: "idem-identity-000021",
      },
      actor
    );
    expect(second.item.orderId).not.toBe(first.item.orderId);
    expect(fakeDbHandle.operationalOrders.size).toBe(2);
  });

  it("4) sin lote (SIN_LOTE) -> una única OA provisional reutilizada, no una por WorkItem", async () => {
    const first = await assignWorkItemDurable(
      {
        sector: "ENVASADO_MASIVO",
        client: "NIZA",
        product: "CREMA HIDRATANTE",
        plannedQuantity: "50",
        plannedDate: "2026-09-14",
        line: "Línea 1",
        productionPedidoId: "pedido-1",
        orderNumber: "OA-2026-000300",
        idempotencyKey: "idem-identity-000030",
      },
      actor
    );
    const second = await assignWorkItemDurable(
      {
        sector: "ENVASADO_MASIVO",
        client: "NIZA",
        product: "CREMA HIDRATANTE",
        plannedQuantity: "70",
        plannedDate: "2026-09-16",
        line: "Línea 1",
        productionPedidoId: "pedido-1",
        orderNumber: "OA-2026-000301",
        idempotencyKey: "idem-identity-000031",
      },
      actor
    );
    expect(second.item.orderId).toBe(first.item.orderId);
    expect(fakeDbHandle.operationalOrders.size).toBe(1);
    expect(first.item.packagingLote).toBeNull();
  });

  it("5) lote resuelto vía Asignación de Lotes (mismo asignacionLoteId) -> misma OA entre WorkItems", async () => {
    fakeDbHandle.asignacionLotes.set("al-e2e-1", {
      id: "al-e2e-1",
      lote: "G26050",
      vto: "2028-05-31",
      producto: "SERUM VITAMINA C",
      marca: "ECODERM",
      codigo: "",
      cantidades: 500,
      fecha: "2026-09-14",
      archived: false,
    });
    const first = await assignWorkItemDurable(
      {
        sector: "ENVASADO_MASIVO",
        client: "ECODERM",
        product: "SERUM VITAMINA C",
        plannedQuantity: "250",
        plannedDate: "2026-09-14",
        line: "Línea 1",
        productionPedidoId: "pedido-1",
        asignacionLoteId: "al-e2e-1",
        orderNumber: "OA-2026-000400",
        idempotencyKey: "idem-identity-000040",
      },
      actor
    );
    const second = await assignWorkItemDurable(
      {
        sector: "ENVASADO_MASIVO",
        client: "ECODERM",
        product: "SERUM VITAMINA C",
        plannedQuantity: "150",
        plannedDate: "2026-09-15",
        line: "Línea 1",
        productionPedidoId: "pedido-1",
        asignacionLoteId: "al-e2e-1",
        orderNumber: "OA-2026-000401",
        idempotencyKey: "idem-identity-000041",
      },
      actor
    );
    expect(second.item.orderId).toBe(first.item.orderId);
    expect(second.item.packagingLote).toBe("G26050");
    expect(fakeDbHandle.operationalOrders.size).toBe(1);
  });

  it("6) sin Pedido (legacy) -> se mantiene estricto 1 trabajo = 1 OA, incluso con mismo producto/lote", async () => {
    await assignWorkItemDurable(
      {
        sector: "ENVASADO_MASIVO",
        client: "NIZA",
        product: "SERUM NIACINAMIDA",
        plannedQuantity: "300",
        plannedDate: "2026-09-14",
        line: "Línea 1",
        packagingLote: "S26018",
        orderNumber: "OA-2026-000900",
        idempotencyKey: "idem-identity-legacy-000001",
      },
      actor
    );
    await expect(
      assignWorkItemDurable(
        {
          sector: "ENVASADO_MASIVO",
          client: "NIZA",
          product: "SERUM NIACINAMIDA",
          plannedQuantity: "200",
          plannedDate: "2026-09-15",
          line: "Línea 1",
          packagingLote: "S26018",
          orderNumber: "OA-2026-000900",
          idempotencyKey: "idem-identity-legacy-000002",
        },
        actor
      )
    ).rejects.toMatchObject({ name: "PlanningConflictError" });
  });

  it("7) OE (Elaboración): mismo pedido+producto+lote, dos WorkItems -> misma OE", async () => {
    const first = await assignWorkItemDurable(
      {
        sector: "ELABORACION",
        client: "ECODERM",
        product: "GRANEL SERUM VITAMINA C",
        plannedQuantity: "50",
        unit: "kg",
        plannedDate: "2026-09-14",
        branchOwner: "Cristian",
        productionPedidoId: "pedido-1",
        packagingLote: "S26018",
        orderNumber: "OE-2026-000500",
        idempotencyKey: "idem-identity-oe-000001",
      },
      actor
    );
    const second = await assignWorkItemDurable(
      {
        sector: "ELABORACION",
        client: "ECODERM",
        product: "GRANEL SERUM VITAMINA C",
        plannedQuantity: "30",
        unit: "kg",
        plannedDate: "2026-09-16",
        branchOwner: "Cristian",
        productionPedidoId: "pedido-1",
        packagingLote: "S26018",
        orderNumber: "OE-2026-000501",
        idempotencyKey: "idem-identity-oe-000002",
      },
      actor
    );
    expect(second.item.orderId).toBe(first.item.orderId);
    const sharedOrder = fakeDbHandle.operationalOrders.get(first.item.orderId!);
    expect(sharedOrder?.type).toBe("OE");
    expect(fakeDbHandle.operationalOrders.size).toBe(1);
  });

  it("8) reintento con la misma idempotencyKey -> no duplica OA (replay)", async () => {
    const payload = {
      sector: "ENVASADO_MASIVO" as const,
      client: "NIZA",
      product: "SERUM NIACINAMIDA",
      plannedQuantity: "300",
      plannedDate: "2026-09-14",
      line: "Línea 1",
      productionPedidoId: "pedido-1",
      packagingLote: "S26018",
      orderNumber: "OA-2026-000600",
      idempotencyKey: "idem-identity-000060",
    };
    const first = await assignWorkItemDurable(payload, actor);
    const retry = await assignWorkItemDurable(payload, actor);
    expect(retry.replayed).toBe(true);
    expect(retry.item.id).toBe(first.item.id);
    expect(fakeDbHandle.operationalOrders.size).toBe(1);
  });
});
