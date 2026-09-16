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
  const asignacionLotes = new Map<string, Record<string, unknown> & { id: string }>();
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
                  : t.__name === "asignacionLotes"
                    ? asignacionLotes
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
    asignacionLotes,
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
