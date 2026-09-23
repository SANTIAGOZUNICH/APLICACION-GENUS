import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests de updateWorkItemPlanningDurable con un fake tx (mismo patrón que
 * ensure-oa-on-assign.test.ts / work-assignment-service.test.ts). Cubren
 * la extensión de "Fecha de producción" (plannedDate) — validación de
 * rango dentro de la semana ya publicada — y reconfirman que el patch
 * parcial estricto (undefined = no tocar) sigue intacto tras el cambio.
 */

type FakeRow = Record<string, unknown> & { id: string };

function createFakeDb() {
  const workItems = new Map<string, FakeRow>();
  const operationalOrders = new Map<string, FakeRow>();
  const workItemDeliveries = new Map<string, FakeRow>();
  const operationalEvents: Record<string, unknown>[] = [];

  function matchCond(row: Record<string, unknown>, cond: unknown): boolean {
    if (!cond) return true;
    if (Array.isArray(cond)) return cond.every((c) => matchCond(row, c));
    const c = cond as {
      __eq?: [string, unknown];
      __ne?: [string, unknown];
      __isNotNull?: string;
      __isNull?: string;
    };
    if (c.__eq) return row[c.__eq[0]] === c.__eq[1];
    if (c.__ne) return row[c.__ne[0]] !== c.__ne[1];
    if (c.__isNotNull) return row[c.__isNotNull] != null;
    if (c.__isNull) return row[c.__isNull] == null;
    // Predicado SQL crudo (ej. version + 1, IS NULL OR = id) — no
    // introspectable en el fake; se trata como cierto (mismo criterio que
    // work-assignment-service.test.ts).
    return true;
  }

  const productionPedidos = new Map<string, FakeRow>();

  function tableFor(name: string): Map<string, FakeRow> {
    if (name === "operationalOrders") return operationalOrders;
    if (name === "workItemDeliveries") return workItemDeliveries;
    if (name === "productionPedidos") return productionPedidos;
    return workItems;
  }

  const tx = {
    select() {
      let target = workItems;
      let cond: unknown = null;
      const api = {
        from(t: { __name: string }) {
          target = tableFor(t.__name);
          return api;
        },
        where(c: unknown) {
          cond = c;
          return api;
        },
        limit(n: number) {
          return Promise.resolve(
            [...target.values()]
              .filter((r) => matchCond(r, cond))
              .slice(0, n)
              .map((r) => ({ ...r }))
          );
        },
        // Drizzle real es awaitable en .where() sin necesitar .limit() —
        // algunas consultas de solo lectura (ej. listDeletedWorkItemsDurable)
        // no acotan resultados. Sin esto, `await tx.select()...where(...)`
        // resuelve al objeto `api` en vez de las filas.
        then(resolve: (v: FakeRow[]) => unknown) {
          return Promise.resolve(
            resolve([...target.values()].filter((r) => matchCond(r, cond)).map((r) => ({ ...r })))
          );
        },
      };
      return api;
    },
    update(t: { __name: string }) {
      const target = tableFor(t.__name);
      return {
        set(patch: Record<string, unknown>) {
          return {
            where(cond: unknown) {
              const updated: FakeRow[] = [];
              for (const row of target.values()) {
                if (matchCond(row, cond)) {
                  Object.assign(row, patch);
                  updated.push({ ...row });
                }
              }
              return {
                returning() {
                  return Promise.resolve(updated);
                },
                then(resolve: (v: FakeRow[]) => unknown) {
                  return Promise.resolve(resolve(updated));
                },
              };
            },
          };
        },
      };
    },
    insert(table: { __name: string }) {
      return {
        values(row: Record<string, unknown>) {
          if (table.__name === "operationalEvents") {
            operationalEvents.push(row);
            return Promise.resolve();
          }
          const target = tableFor(table.__name);
          const id = (row.id as string | undefined) ?? `${table.__name}-${target.size + 1}`;
          const stored = { ...row, id };
          target.set(id, stored);
          return {
            returning() {
              return Promise.resolve([{ ...stored }]);
            },
            then(resolve: (v: undefined) => unknown) {
              return Promise.resolve(resolve(undefined));
            },
          };
        },
      };
    },
    transaction(fn: (tx: unknown) => unknown) {
      return fn(tx);
    },
  };

  return { tx, workItems, operationalOrders, workItemDeliveries, operationalEvents, productionPedidos };
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
    ne: (col: { name?: string } | string, val: unknown) => ({
      __ne: [typeof col === "string" ? col : (col as { name?: string }).name ?? "id", val],
    }),
    isNotNull: (col: { name?: string } | string) => ({
      __isNotNull: typeof col === "string" ? col : (col as { name?: string }).name ?? "id",
    }),
    isNull: (col: { name?: string } | string) => ({
      __isNull: typeof col === "string" ? col : (col as { name?: string }).name ?? "id",
    }),
    or: (...args: unknown[]) => args,
    desc: (col: unknown) => col,
    sql: actual.sql,
  };
});

vi.mock("@/lib/db/client", () => ({
  getDb: () => ({ transaction: (fn: (tx: unknown) => unknown) => fn(fakeDbHandle.tx) }),
}));

vi.mock("@/lib/db/schema", () => {
  const workItemCols = [
    "id",
    "client",
    "product",
    "plannedQuantity",
    "unit",
    "deliveryDate",
    "notes",
    "planningWeekId",
    "plannedDate",
    "plannedDateTo",
    "sector",
    "orderId",
    "orderNumber",
    "line",
    "operationalStatus",
    "deletedAt",
    "deletedBy",
    "deleteReason",
    "packagingLote",
    "packagingVto",
    "packagingTotalUnits",
    "packingGroups",
    "packingMismatchObservation",
    "sampleUnits",
    "deliverableUnits",
    "bulkRemainderKg",
    "bulkRemainderObservation",
    "productionPedidoId",
    "finishedQty",
    "version",
  ];
  const orderCols = [
    "id",
    "orderNumber",
    "type",
    "linkedWorkItemId",
    "version",
    "pedidoId",
    "productIdentityKey",
    "loteIdentityKey",
    "status",
    "product",
    "client",
    "lot",
    "deletedAt",
    "updatedBy",
    "updatedAt",
  ];
  const deliveryCols = [
    "id",
    "workItemId",
    "status",
    "archived",
    "qualityItemId",
    "product",
    "codigo",
    "client",
    "lote",
    "vto",
    "orderNumber",
    "packingGroups",
    "plannedQuantity",
    "finishedQty",
    "sampleUnits",
    "deliverableUnits",
    "bulkRemainderKg",
    "bulkRemainderObservation",
    "productionPedidoId",
    "pedidoOp",
    "sourceSector",
    "quantity",
    "unit",
    "plannedDeliveryDate",
    "actualDeliveredAt",
    "remito",
    "receivedBy",
    "observations",
    "deliveredBy",
    "deliveredBySector",
  ];
  const pedidoCols = ["id", "op"];
  const table = (name: string, cols: string[]) => {
    const t: Record<string, unknown> = { __name: name };
    for (const c of cols) t[c] = { name: c };
    return t;
  };
  return {
    workItems: table("workItems", workItemCols),
    workItemDeliveries: table("workItemDeliveries", deliveryCols),
    operationalEvents: table("operationalEvents", []),
    operationalOrders: table("operationalOrders", orderCols),
    productionPedidos: table("productionPedidos", pedidoCols),
  };
});

describe("updateWorkItemPlanningDurable — Fecha de producción y patch parcial (fake tx)", () => {
  let updateWorkItemPlanningDurable: typeof import("./work-item-progress-repository").updateWorkItemPlanningDurable;

  beforeEach(async () => {
    vi.resetModules();
    fakeDbHandle = createFakeDb();
    ({ updateWorkItemPlanningDurable } = await import("./work-item-progress-repository"));
    fakeDbHandle.workItems.set("wi-1", {
      id: "wi-1",
      client: "Cliente Original",
      product: "Producto Original",
      plannedQuantity: "100",
      unit: "kg",
      deliveryDate: "2026-08-28",
      notes: "Nota original",
      planningWeekId: "week-1",
      // Lunes 2026-08-24 → semana 24 (lun) a 30 (dom).
      plannedDate: "2026-08-25",
      plannedDateTo: null,
    });
  });

  const actorArgs = { updatedBy: "produccion@laboratoriogenus.com.ar", updatedBySector: "PRODUCCION" as const };

  it("9) edita plannedDate dentro de la semana ya planificada y audita el cambio", async () => {
    const row = await updateWorkItemPlanningDurable("wi-1", {
      plannedDate: "2026-08-27",
      reason: "Corrección de fecha de producción",
      ...actorArgs,
    });
    expect(row.plannedDate).toBe("2026-08-27");
    expect(row.plannedDateTo).toBeNull();
    const event = fakeDbHandle.operationalEvents[0] as { fromStatus: string; toStatus: string };
    expect(JSON.parse(event.fromStatus)).toMatchObject({ plannedDate: "2026-08-25" });
    expect(JSON.parse(event.toStatus)).toMatchObject({ plannedDate: "2026-08-27" });
  });

  it("10) rechaza plannedDate fuera de la semana ya planificada, sin mutar la fila", async () => {
    await expect(
      updateWorkItemPlanningDurable("wi-1", {
        plannedDate: "2026-09-02",
        reason: "Intento de mover a otra semana",
        ...actorArgs,
      })
    ).rejects.toMatchObject({ name: "PlanningValidationError" });
    expect(fakeDbHandle.workItems.get("wi-1")!.plannedDate).toBe("2026-08-25");
    expect(fakeDbHandle.operationalEvents).toHaveLength(0);
  });

  it("11) patch parcial: editar solo notes no toca client/product/cantidad/fecha de entrega ni plannedDate", async () => {
    const row = await updateWorkItemPlanningDurable("wi-1", {
      notes: "Observación nueva",
      reason: "Aclaración",
      ...actorArgs,
    });
    expect(row.notes).toBe("Observación nueva");
    expect(row.client).toBe("Cliente Original");
    expect(row.product).toBe("Producto Original");
    expect(row.plannedQuantity).toBe("100");
    expect(row.deliveryDate).toBe("2026-08-28");
    expect(row.plannedDate).toBe("2026-08-25");
    const event = fakeDbHandle.operationalEvents[0] as { fromStatus: string; toStatus: string };
    expect(Object.keys(JSON.parse(event.toStatus))).toEqual(["notes"]);
  });

  it("concurrencia: expectedVersion coincide -> guarda y sube la versión", async () => {
    fakeDbHandle.workItems.set("wi-1", { ...fakeDbHandle.workItems.get("wi-1")!, version: 1 });
    const row = await updateWorkItemPlanningDurable("wi-1", {
      notes: "Con control de versión",
      reason: "Test",
      expectedVersion: 1,
      ...actorArgs,
    });
    expect((row as { version: number }).version).toBe(2);
  });

  it("concurrencia: expectedVersion desactualizada -> rechaza SIN mutar, nunca pisa un cambio ajeno más reciente", async () => {
    fakeDbHandle.workItems.set("wi-1", { ...fakeDbHandle.workItems.get("wi-1")!, version: 3 });
    await expect(
      updateWorkItemPlanningDurable("wi-1", {
        notes: "Pantalla vieja",
        reason: "Test",
        expectedVersion: 1,
        ...actorArgs,
      })
    ).rejects.toMatchObject({ name: "PlanningValidationError" });
    expect(fakeDbHandle.workItems.get("wi-1")!.notes).toBe("Nota original");
    expect(fakeDbHandle.workItems.get("wi-1")!.version).toBe(3);
  });

  it("sin expectedVersion (callers existentes) -> se comporta igual que antes, no rechaza", async () => {
    fakeDbHandle.workItems.set("wi-1", { ...fakeDbHandle.workItems.get("wi-1")!, version: 5 });
    const row = await updateWorkItemPlanningDurable("wi-1", {
      notes: "Sin control de versión",
      reason: "Test",
      ...actorArgs,
    });
    expect(row.notes).toBe("Sin control de versión");
  });
});

describe("updateWorkItemLoteVtoDurable — corrección manual de Lote/VTO (fake tx)", () => {
  let updateWorkItemLoteVtoDurable: typeof import("./work-item-progress-repository").updateWorkItemLoteVtoDurable;

  const actorArgs = { updatedBy: "produccion@laboratoriogenus.com.ar", updatedBySector: "PRODUCCION" as const };

  beforeEach(async () => {
    vi.resetModules();
    fakeDbHandle = createFakeDb();
    ({ updateWorkItemLoteVtoDurable } = await import("./work-item-progress-repository"));
    fakeDbHandle.workItems.set("wi-lv", {
      id: "wi-lv",
      packagingLote: "G26043",
      packagingVto: "2028-10-31",
      planningWeekId: "week-1",
      version: 1,
    });
  });

  it("motivo obligatorio: sin motivo rechaza sin mutar", async () => {
    await expect(
      updateWorkItemLoteVtoDurable("wi-lv", { packagingLote: "G26044", reason: "", ...actorArgs })
    ).rejects.toThrow();
    expect(fakeDbHandle.workItems.get("wi-lv")!.packagingLote).toBe("G26043");
  });

  it("corrige lote y vto con motivo, audita before/after y sube versión", async () => {
    const row = await updateWorkItemLoteVtoDurable("wi-lv", {
      packagingLote: "G26044",
      packagingVto: "2028-11-30",
      reason: "Corrección informada por Producción",
      ...actorArgs,
    });
    expect(row.packagingLote).toBe("G26044");
    expect(row.packagingVto).toBe("2028-11-30");
    expect((row as { version: number }).version).toBe(2);
    const event = fakeDbHandle.operationalEvents[0] as { type: string; fromStatus: string; toStatus: string };
    expect(event.type).toBe("LOTE_VTO_CORRECTED");
    expect(JSON.parse(event.fromStatus)).toEqual({ lote: "G26043", vto: "2028-10-31" });
    expect(JSON.parse(event.toStatus)).toEqual({ lote: "G26044", vto: "2028-11-30" });
  });

  it("concurrencia: expectedVersion desactualizada -> rechaza, nunca pisa una corrección más reciente", async () => {
    fakeDbHandle.workItems.set("wi-lv", { ...fakeDbHandle.workItems.get("wi-lv")!, version: 4 });
    await expect(
      updateWorkItemLoteVtoDurable("wi-lv", {
        packagingLote: "G26099",
        reason: "Pantalla vieja",
        expectedVersion: 1,
        ...actorArgs,
      })
    ).rejects.toMatchObject({ name: "PlanningValidationError" });
    expect(fakeDbHandle.workItems.get("wi-lv")!.packagingLote).toBe("G26043");
  });

  it("sin Pedido vinculado (legacy) -> corrige el lote sin tocar ninguna OA/OE", async () => {
    const row = await updateWorkItemLoteVtoDurable("wi-lv", {
      packagingLote: "G26099",
      reason: "Corrección legacy",
      ...actorArgs,
    });
    expect(row.packagingLote).toBe("G26099");
    expect(fakeDbHandle.operationalOrders.size).toBe(0);
    expect(fakeDbHandle.operationalEvents.some((e) => (e as { type: string }).type === "ORDER_IDENTITY_RERESOLVED")).toBe(false);
  });
});

describe("updateWorkItemLoteVtoDurable / updateWorkItemPlanningDurable — re-resolución de OA/OE al editar lote/producto (fake tx)", () => {
  let updateWorkItemLoteVtoDurable: typeof import("./work-item-progress-repository").updateWorkItemLoteVtoDurable;
  let updateWorkItemPlanningDurable: typeof import("./work-item-progress-repository").updateWorkItemPlanningDurable;

  const actorArgs = { updatedBy: "produccion@laboratoriogenus.com.ar", updatedBySector: "PRODUCCION" as const };

  beforeEach(async () => {
    vi.resetModules();
    fakeDbHandle = createFakeDb();
    ({ updateWorkItemLoteVtoDurable, updateWorkItemPlanningDurable } = await import(
      "./work-item-progress-repository"
    ));
    fakeDbHandle.operationalOrders.set("oa-1", {
      id: "oa-1",
      orderNumber: "OA-2026-000123",
      type: "OA",
      linkedWorkItemId: "wi-edit",
      version: 1,
      pedidoId: "pedido-1",
      productIdentityKey: "serum niacinamida",
      loteIdentityKey: "TXT:s26018",
      status: "PENDIENTE",
      product: "SERUM NIACINAMIDA",
      client: "NIZA",
      lot: "S26018",
      deletedAt: null,
    });
    fakeDbHandle.workItems.set("wi-edit", {
      id: "wi-edit",
      sector: "ENVASADO_MASIVO",
      client: "NIZA",
      product: "SERUM NIACINAMIDA",
      plannedQuantity: "300",
      unit: "un.",
      packagingLote: "S26018",
      packagingVto: "2028-10-31",
      planningWeekId: "week-1",
      plannedDate: "2026-09-10",
      plannedDateTo: null,
      productionPedidoId: "pedido-1",
      orderId: "oa-1",
      orderNumber: "OA-2026-000123",
      deletedAt: null,
      version: 1,
    });
  });

  it("1) edita lote, OA exclusiva de este trabajo y sin otra OA con la identidad nueva -> renombra la MISMA OA en el lugar (no duplica)", async () => {
    const row = await updateWorkItemLoteVtoDurable("wi-edit", {
      packagingLote: "S26045",
      reason: "Cambio de lote confirmado por Producción",
      ...actorArgs,
    });
    expect(row.packagingLote).toBe("S26045");
    expect(row.orderId).toBe("oa-1");
    expect(row.orderNumber).toBe("OA-2026-000123");
    expect(fakeDbHandle.operationalOrders.size).toBe(1);
    const order = fakeDbHandle.operationalOrders.get("oa-1")!;
    expect(order.loteIdentityKey).toBe("TXT:s26045");
    expect(order.lot).toBe("S26045");
    const event = fakeDbHandle.operationalEvents.find(
      (e) => (e as { type: string }).type === "ORDER_IDENTITY_RERESOLVED"
    ) as { toStatus: string } | undefined;
    expect(event).toBeTruthy();
    expect(JSON.parse(event!.toStatus)).toMatchObject({ orderId: "oa-1", orderNumber: "OA-2026-000123" });
  });

  it("2) edita lote y YA existe otra OA para Pedido+Producto+lote nuevo -> reengancha a ESA, nunca duplica ni muta la vieja", async () => {
    fakeDbHandle.operationalOrders.set("oa-2", {
      id: "oa-2",
      orderNumber: "OA-2026-000200",
      type: "OA",
      linkedWorkItemId: null,
      version: 1,
      pedidoId: "pedido-1",
      productIdentityKey: "serum niacinamida",
      loteIdentityKey: "TXT:s26045",
      status: "PENDIENTE",
      product: "SERUM NIACINAMIDA",
      client: "NIZA",
      lot: "S26045",
      deletedAt: null,
    });
    const row = await updateWorkItemLoteVtoDurable("wi-edit", {
      packagingLote: "S26045",
      reason: "Cambio de lote — ya había otra tanda con ese lote",
      ...actorArgs,
    });
    expect(row.orderId).toBe("oa-2");
    expect(row.orderNumber).toBe("OA-2026-000200");
    expect(fakeDbHandle.operationalOrders.size).toBe(2);
    // La OA vieja queda intacta, no se toca su lote/identidad.
    expect(fakeDbHandle.operationalOrders.get("oa-1")!.lot).toBe("S26018");
    expect(fakeDbHandle.operationalOrders.get("oa-2")!.linkedWorkItemId).toBe("wi-edit");
  });

  it("3) edita lote, OA compartida con OTRO trabajo activo y sin match para la identidad nueva -> rechaza, no resuelve en silencio", async () => {
    fakeDbHandle.workItems.set("wi-sibling", {
      id: "wi-sibling",
      sector: "ENVASADO_MASIVO",
      orderId: "oa-1",
      deletedAt: null,
    });
    await expect(
      updateWorkItemLoteVtoDurable("wi-edit", {
        packagingLote: "S26045",
        reason: "Cambio de lote",
        ...actorArgs,
      })
    ).rejects.toMatchObject({ name: "PlanningValidationError" });
    expect(fakeDbHandle.workItems.get("wi-edit")!.packagingLote).toBe("S26018");
    expect(fakeDbHandle.operationalOrders.get("oa-1")!.lot).toBe("S26018");
    expect(fakeDbHandle.operationalOrders.size).toBe(1);
  });

  it("4) edita lote, OA exclusiva pero ya está COMPLETA -> rechaza, nunca muta una OA completa", async () => {
    fakeDbHandle.operationalOrders.set("oa-1", {
      ...fakeDbHandle.operationalOrders.get("oa-1")!,
      status: "COMPLETA",
    });
    await expect(
      updateWorkItemLoteVtoDurable("wi-edit", {
        packagingLote: "S26045",
        reason: "Cambio de lote",
        ...actorArgs,
      })
    ).rejects.toMatchObject({ name: "PlanningValidationError" });
    expect(fakeDbHandle.operationalOrders.get("oa-1")!.lot).toBe("S26018");
  });

  it("5) edita PRODUCTO (updateWorkItemPlanningDurable), OA exclusiva -> re-resuelve la identidad también por cambio de producto", async () => {
    const row = await updateWorkItemPlanningDurable("wi-edit", {
      product: "SERUM VITAMINA C",
      reason: "Corrección de producto",
      ...actorArgs,
    });
    expect(row.product).toBe("SERUM VITAMINA C");
    expect(row.orderId).toBe("oa-1");
    expect(fakeDbHandle.operationalOrders.size).toBe(1);
    expect(fakeDbHandle.operationalOrders.get("oa-1")!.productIdentityKey).toBe("serum vitamina c");
  });

  it("6) edita cantidad (sin tocar lote/producto) -> NUNCA re-resuelve ni toca la OA", async () => {
    const row = await updateWorkItemPlanningDurable("wi-edit", {
      plannedQuantity: "500",
      reason: "Ajuste de cantidad",
      ...actorArgs,
    });
    expect(row.plannedQuantity).toBe("500");
    expect(row.orderId).toBe("oa-1");
    expect(
      fakeDbHandle.operationalEvents.some((e) => (e as { type: string }).type === "ORDER_IDENTITY_RERESOLVED")
    ).toBe(false);
    expect(fakeDbHandle.operationalOrders.get("oa-1")!.loteIdentityKey).toBe("TXT:s26018");
  });

  it("7) edita lote a un valor que normaliza igual (mismo lote, distinto casing/espacios) -> no re-resuelve (sin cambio real de identidad)", async () => {
    const row = await updateWorkItemLoteVtoDurable("wi-edit", {
      packagingLote: "  s26018 ",
      reason: "Solo prolijidad de formato",
      ...actorArgs,
    });
    expect(row.packagingLote).toBe("s26018");
    expect(row.orderId).toBe("oa-1");
    expect(
      fakeDbHandle.operationalEvents.some((e) => (e as { type: string }).type === "ORDER_IDENTITY_RERESOLVED")
    ).toBe(false);
  });
});

describe("getOrderQuantityTotalDurable — total real de una OA/OE compartida (fake tx)", () => {
  let getOrderQuantityTotalDurable: typeof import("./work-item-progress-repository").getOrderQuantityTotalDurable;

  beforeEach(async () => {
    vi.resetModules();
    fakeDbHandle = createFakeDb();
    ({ getOrderQuantityTotalDurable } = await import("./work-item-progress-repository"));
  });

  it("suma plannedQuantity de todos los WorkItems activos vinculados a la misma OA (sin doble conteo)", async () => {
    fakeDbHandle.workItems.set("wi-mon", {
      id: "wi-mon",
      orderId: "oa-1",
      plannedQuantity: "300",
      unit: "un.",
      deletedAt: null,
    });
    fakeDbHandle.workItems.set("wi-tue", {
      id: "wi-tue",
      orderId: "oa-1",
      plannedQuantity: "200",
      unit: "un.",
      deletedAt: null,
    });
    const result = await getOrderQuantityTotalDurable("oa-1");
    expect(result.total).toBe(500);
    expect(result.workItemCount).toBe(2);
    expect(result.unit).toBe("un.");
  });

  it("ignora WorkItems eliminados (tombstone) y los de otra OA", async () => {
    fakeDbHandle.workItems.set("wi-a", { id: "wi-a", orderId: "oa-1", plannedQuantity: "100", unit: "kg", deletedAt: null });
    fakeDbHandle.workItems.set("wi-b", {
      id: "wi-b",
      orderId: "oa-1",
      plannedQuantity: "999",
      unit: "kg",
      deletedAt: new Date(),
    });
    fakeDbHandle.workItems.set("wi-c", { id: "wi-c", orderId: "oa-2", plannedQuantity: "50", unit: "kg", deletedAt: null });
    const result = await getOrderQuantityTotalDurable("oa-1");
    expect(result.total).toBe(100);
    expect(result.workItemCount).toBe(1);
  });

  it("reproduce el mismo total en llamadas repetidas — no hay ningún contador que se incremente en cada lectura", async () => {
    fakeDbHandle.workItems.set("wi-1", { id: "wi-1", orderId: "oa-1", plannedQuantity: "150", unit: "un.", deletedAt: null });
    const first = await getOrderQuantityTotalDurable("oa-1");
    const second = await getOrderQuantityTotalDurable("oa-1");
    expect(first.total).toBe(150);
    expect(second.total).toBe(150);
  });
});

describe("deleteWorkItemDurable — soft delete/tombstone de Producción (fake tx)", () => {
  let deleteWorkItemDurable: typeof import("./work-item-progress-repository").deleteWorkItemDurable;

  beforeEach(async () => {
    vi.resetModules();
    fakeDbHandle = createFakeDb();
    ({ deleteWorkItemDurable } = await import("./work-item-progress-repository"));
    fakeDbHandle.workItems.set("wi-del", {
      id: "wi-del",
      sector: "ENVASADO_MASIVO",
      product: "SERUM",
      client: "NIZA",
      operationalStatus: "pendiente",
      planningWeekId: "week-1",
      deletedAt: null,
      version: 1,
    });
  });

  it("motivo obligatorio: sin motivo rechaza, nunca borra sin auditoría", async () => {
    await expect(
      deleteWorkItemDurable("wi-del", { reason: "", deletedBy: "produccion@x.com" })
    ).rejects.toThrow();
    expect(fakeDbHandle.workItems.get("wi-del")!.deletedAt).toBeNull();
  });

  it("soft delete con motivo: setea deletedAt/deletedBy/deleteReason, nunca borra la fila, sube versión", async () => {
    const row = await deleteWorkItemDurable("wi-del", {
      reason: "Pedido duplicado",
      deletedBy: "produccion@x.com",
    });
    expect(row.deletedAt).not.toBeNull();
    expect(row.deletedBy).toBe("produccion@x.com");
    expect(row.deleteReason).toBe("Pedido duplicado");
    expect((row as { version: number }).version).toBe(2);
    expect(fakeDbHandle.workItems.has("wi-del")).toBe(true); // nunca DELETE físico
  });

  it("idempotente: borrar dos veces no duplica el evento de auditoría", async () => {
    await deleteWorkItemDurable("wi-del", { reason: "Motivo", deletedBy: "produccion@x.com" });
    await deleteWorkItemDurable("wi-del", { reason: "Motivo otra vez", deletedBy: "produccion@x.com" });
    expect(fakeDbHandle.operationalEvents).toHaveLength(1);
  });

  it("concurrencia: expectedVersion desactualizada -> rechaza sin eliminar", async () => {
    fakeDbHandle.workItems.set("wi-del", { ...fakeDbHandle.workItems.get("wi-del")!, version: 4 });
    await expect(
      deleteWorkItemDurable("wi-del", {
        reason: "Pantalla vieja",
        deletedBy: "produccion@x.com",
        expectedVersion: 1,
      })
    ).rejects.toMatchObject({ name: "PlanningValidationError" });
    expect(fakeDbHandle.workItems.get("wi-del")!.deletedAt).toBeNull();
  });
});

describe("listDeletedWorkItemsDurable / restoreDeletedWorkItemDurable — Ver eliminados (fake tx)", () => {
  let listDeletedWorkItemsDurable: typeof import("./work-item-progress-repository").listDeletedWorkItemsDurable;
  let restoreDeletedWorkItemDurable: typeof import("./work-item-progress-repository").restoreDeletedWorkItemDurable;
  let deleteWorkItemDurable: typeof import("./work-item-progress-repository").deleteWorkItemDurable;

  beforeEach(async () => {
    vi.resetModules();
    fakeDbHandle = createFakeDb();
    ({ listDeletedWorkItemsDurable, restoreDeletedWorkItemDurable, deleteWorkItemDurable } = await import(
      "./work-item-progress-repository"
    ));
    fakeDbHandle.workItems.set("wi-active", {
      id: "wi-active",
      sector: "ENVASADO_MASIVO",
      product: "CREMA",
      client: "NIZA",
      operationalStatus: "pendiente",
      planningWeekId: "week-1",
      deletedAt: null,
      version: 1,
    });
    fakeDbHandle.workItems.set("wi-deleted", {
      id: "wi-deleted",
      sector: "ENVASADO_MASIVO",
      product: "SERUM",
      client: "ECODERM",
      operationalStatus: "pendiente",
      planningWeekId: "week-1",
      deletedAt: null,
      version: 1,
    });
  });

  it("solo lista trabajos con deletedAt informado — nunca los activos", async () => {
    await deleteWorkItemDurable("wi-deleted", { reason: "Pedido duplicado", deletedBy: "produccion@x.com" });
    const deleted = await listDeletedWorkItemsDurable();
    expect(deleted.map((r) => r.id)).toEqual(["wi-deleted"]);
  });

  it("restaura un trabajo eliminado: limpia deletedAt/deletedBy/deleteReason y sube versión", async () => {
    await deleteWorkItemDurable("wi-deleted", { reason: "Pedido duplicado", deletedBy: "produccion@x.com" });
    const restored = await restoreDeletedWorkItemDurable("wi-deleted", { restoredBy: "produccion@x.com" });
    expect(restored.deletedAt).toBeNull();
    expect(restored.deletedBy).toBeNull();
    expect(restored.deleteReason).toBeNull();
    expect((restored as { version: number }).version).toBe(3); // delete(2) + restore(3)
    const deleted = await listDeletedWorkItemsDurable();
    expect(deleted).toHaveLength(0);
  });

  it("restaurar un trabajo que NO está eliminado rechaza — no confunde con restoreCancelledWorkDurable", async () => {
    await expect(
      restoreDeletedWorkItemDurable("wi-active", { restoredBy: "produccion@x.com" })
    ).rejects.toThrow("no está eliminado");
  });

  it("restaurar nunca borra OA/entregas/remitos/historial — solo toca las 3 columnas de borrado + version", async () => {
    await deleteWorkItemDurable("wi-deleted", { reason: "Motivo", deletedBy: "produccion@x.com" });
    const before = { ...fakeDbHandle.workItems.get("wi-deleted")! };
    const restored = await restoreDeletedWorkItemDurable("wi-deleted", { restoredBy: "produccion@x.com" });
    expect(restored.sector).toBe(before.sector);
    expect(restored.product).toBe(before.product);
    expect(restored.client).toBe(before.client);
    expect(fakeDbHandle.operationalEvents.some((e) => (e as { type: string }).type === "WORK_ITEM_RESTORED_BY_PRODUCCION")).toBe(true);
  });
});

describe("updateWorkItemOrderRefDurable — corrección de OA/OE post-asignación (fake tx)", () => {
  let updateWorkItemOrderRefDurable: typeof import("./work-item-progress-repository").updateWorkItemOrderRefDurable;

  const actorArgs = {
    updatedBy: "produccion@laboratoriogenus.com.ar",
    updatedBySector: "PRODUCCION" as const,
  };

  beforeEach(async () => {
    vi.resetModules();
    fakeDbHandle = createFakeDb();
    ({ updateWorkItemOrderRefDurable } = await import("./work-item-progress-repository"));
    fakeDbHandle.workItems.set("wi-oa", {
      id: "wi-oa",
      sector: "ENVASADO_MASIVO",
      orderId: "oa-old",
      orderNumber: "OA-2026-000100",
      planningWeekId: "week-1",
    });
    fakeDbHandle.operationalOrders.set("oa-old", {
      id: "oa-old",
      orderNumber: "OA-2026-000100",
      type: "OA",
      linkedWorkItemId: "wi-oa",
      version: 1,
    });
    fakeDbHandle.operationalOrders.set("oa-new", {
      id: "oa-new",
      orderNumber: "OA-2026-000200",
      type: "OA",
      linkedWorkItemId: null,
      version: 1,
    });
  });

  it("6) corrige la OA vinculada: desvincula la anterior, vincula la nueva, y la segunda lectura conserva el cambio", async () => {
    const row = await updateWorkItemOrderRefDurable("wi-oa", {
      orderNumberRaw: "OA-2026-000200",
      reason: "Se asignó a la OA equivocada",
      ...actorArgs,
    });
    expect(row.orderNumber).toBe("OA-2026-000200");
    expect(row.orderId).toBe("oa-new");
    // Segunda lectura (independiente del valor de retorno) — el estado persistido es el mismo.
    expect(fakeDbHandle.workItems.get("wi-oa")!.orderNumber).toBe("OA-2026-000200");
    expect(fakeDbHandle.operationalOrders.get("oa-old")!.linkedWorkItemId).toBeNull();
    expect(fakeDbHandle.operationalOrders.get("oa-new")!.linkedWorkItemId).toBe("wi-oa");
    const event = fakeDbHandle.operationalEvents[0] as { type: string; fromStatus: string; toStatus: string };
    expect(event.type).toBe("ORDER_REF_CORRECTED");
    expect(JSON.parse(event.fromStatus)).toMatchObject({ orderNumber: "OA-2026-000100" });
    expect(JSON.parse(event.toStatus)).toMatchObject({ orderNumber: "OA-2026-000200" });
  });

  it("rechaza vincular una OA que ya tiene otro trabajo asignado (1 trabajo = 1 OA)", async () => {
    fakeDbHandle.operationalOrders.set("oa-taken", {
      id: "oa-taken",
      orderNumber: "OA-2026-000300",
      type: "OA",
      linkedWorkItemId: "otro-work-item",
      version: 1,
    });
    await expect(
      updateWorkItemOrderRefDurable("wi-oa", {
        orderNumberRaw: "OA-2026-000300",
        reason: "Intento de reasignar",
        ...actorArgs,
      })
    ).rejects.toThrow(/ya tiene un trabajo asignado/);
    // Sin cambios — el work item sigue apuntando a la OA original.
    expect(fakeDbHandle.workItems.get("wi-oa")!.orderNumber).toBe("OA-2026-000100");
  });

  it("rechaza una OA inexistente — nunca crea una orden nueva desde acá", async () => {
    await expect(
      updateWorkItemOrderRefDurable("wi-oa", {
        orderNumberRaw: "OA-2026-999999",
        reason: "OA que no existe",
        ...actorArgs,
      })
    ).rejects.toMatchObject({ name: "PlanningValidationError" });
    expect(fakeDbHandle.operationalOrders.has("oa-2026-999999")).toBe(false);
  });

  it("exige motivo no vacío", async () => {
    await expect(
      updateWorkItemOrderRefDurable("wi-oa", {
        orderNumberRaw: "OA-2026-000200",
        reason: "  ",
        ...actorArgs,
      })
    ).rejects.toMatchObject({ name: "PlanningValidationError" });
  });
});

describe("rescheduleWorkItemDurable — drag & drop de planificación (fake tx)", () => {
  let rescheduleWorkItemDurable: typeof import("./work-item-progress-repository").rescheduleWorkItemDurable;

  const actorArgs = { updatedBy: "produccion@laboratoriogenus.com.ar", updatedBySector: "PRODUCCION" as const };

  beforeEach(async () => {
    vi.resetModules();
    fakeDbHandle = createFakeDb();
    ({ rescheduleWorkItemDurable } = await import("./work-item-progress-repository"));
    fakeDbHandle.workItems.set("wi-drag", {
      id: "wi-drag",
      client: "Cliente Envasado",
      product: "Shampoo TCL",
      plannedQuantity: "500",
      unit: "un.",
      plannedDate: "2026-08-24",
      plannedDateTo: null,
      line: "Línea 1",
      sector: "ENVASADO_MASIVO",
      operationalStatus: "pendiente",
      deletedAt: null,
      planningWeekId: "week-1",
      packagingLote: "L-900",
      packagingVto: "2027-06-01",
      orderNumber: "OA-2026-000145",
    });
  });

  it("5) drag entre días: actualiza solo plannedDate", async () => {
    const row = await rescheduleWorkItemDurable("wi-drag", { plannedDate: "2026-08-26", ...actorArgs });
    expect(row.plannedDate).toBe("2026-08-26");
    expect(row.plannedDateTo).toBeNull();
    expect(row.line).toBe("Línea 1");
  });

  it("6) drag entre líneas: actualiza solo line, misma fecha", async () => {
    const row = await rescheduleWorkItemDurable("wi-drag", {
      plannedDate: "2026-08-24",
      line: "Línea 2",
      ...actorArgs,
    });
    expect(row.line).toBe("Línea 2");
    expect(row.plannedDate).toBe("2026-08-24");
  });

  it("7) drag día + línea: actualiza ambos atómicamente", async () => {
    const row = await rescheduleWorkItemDurable("wi-drag", {
      plannedDate: "2026-08-27",
      line: "Línea 3",
      ...actorArgs,
    });
    expect(row.plannedDate).toBe("2026-08-27");
    expect(row.line).toBe("Línea 3");
  });

  it("11) partial patch: mover no modifica lote/VTO/OA/cantidad/producto/cliente", async () => {
    const row = await rescheduleWorkItemDurable("wi-drag", { plannedDate: "2026-08-28", ...actorArgs });
    expect(row.packagingLote).toBe("L-900");
    expect(row.packagingVto).toBe("2027-06-01");
    expect(row.orderNumber).toBe("OA-2026-000145");
    expect(row.plannedQuantity).toBe("500");
    expect(row.product).toBe("Shampoo TCL");
    expect(row.client).toBe("Cliente Envasado");
  });

  it("12) genera evento WORK_ITEM_RESCHEDULED con before/after correctos", async () => {
    await rescheduleWorkItemDurable("wi-drag", {
      plannedDate: "2026-08-26",
      line: "Línea 2",
      ...actorArgs,
    });
    const event = fakeDbHandle.operationalEvents[0] as {
      type: string;
      fromStatus: string;
      toStatus: string;
      actorSector: string;
    };
    expect(event.type).toBe("WORK_ITEM_RESCHEDULED");
    expect(JSON.parse(event.fromStatus)).toMatchObject({ plannedDate: "2026-08-24", line: "Línea 1" });
    expect(JSON.parse(event.toStatus)).toMatchObject({ plannedDate: "2026-08-26", line: "Línea 2" });
    expect(event.actorSector).toBe("PRODUCCION");
  });

  it("10) estado terminal — entregado no se puede mover", async () => {
    fakeDbHandle.workItems.get("wi-drag")!.operationalStatus = "entregado";
    await expect(
      rescheduleWorkItemDurable("wi-drag", { plannedDate: "2026-08-26", ...actorArgs })
    ).rejects.toMatchObject({ name: "PlanningValidationError" });
    expect(fakeDbHandle.workItems.get("wi-drag")!.plannedDate).toBe("2026-08-24");
    expect(fakeDbHandle.operationalEvents).toHaveLength(0);
  });

  it("10b) estado terminal — enviado a Codificado (en_codificado) no se puede mover", async () => {
    fakeDbHandle.workItems.get("wi-drag")!.operationalStatus = "en_codificado";
    await expect(
      rescheduleWorkItemDurable("wi-drag", { plannedDate: "2026-08-26", ...actorArgs })
    ).rejects.toMatchObject({ name: "PlanningValidationError" });
  });

  it("10c) cancelado no se puede mover", async () => {
    fakeDbHandle.workItems.get("wi-drag")!.operationalStatus = "cancelado";
    await expect(
      rescheduleWorkItemDurable("wi-drag", { plannedDate: "2026-08-26", ...actorArgs })
    ).rejects.toMatchObject({ name: "PlanningValidationError" });
  });

  it("borrado (soft delete) no se puede mover", async () => {
    fakeDbHandle.workItems.get("wi-drag")!.deletedAt = "2026-08-20T10:00:00.000Z";
    await expect(
      rescheduleWorkItemDurable("wi-drag", { plannedDate: "2026-08-26", ...actorArgs })
    ).rejects.toMatchObject({ name: "PlanningValidationError" });
  });

  it("pendiente/en_curso/bloqueado sí se pueden mover", async () => {
    for (const status of ["pendiente", "en_curso", "bloqueado"]) {
      fakeDbHandle.workItems.get("wi-drag")!.operationalStatus = status;
      fakeDbHandle.workItems.get("wi-drag")!.plannedDate = "2026-08-24";
      const row = await rescheduleWorkItemDurable("wi-drag", { plannedDate: "2026-08-26", ...actorArgs });
      expect(row.plannedDate).toBe("2026-08-26");
    }
  });

  it("Elaboración/Codificado: line=null limpia la línea (no aplica línea)", async () => {
    fakeDbHandle.workItems.set("wi-elab", {
      id: "wi-elab",
      plannedDate: "2026-08-24",
      plannedDateTo: null,
      line: null,
      sector: "ELABORACION",
      operationalStatus: "pendiente",
      deletedAt: null,
      planningWeekId: "week-1",
    });
    const row = await rescheduleWorkItemDurable("wi-elab", { plannedDate: "2026-08-25", ...actorArgs });
    expect(row.plannedDate).toBe("2026-08-25");
    expect(row.line).toBeNull();
  });

  it("sin cambios reales — rechaza (mismo día, misma línea)", async () => {
    await expect(
      rescheduleWorkItemDurable("wi-drag", { plannedDate: "2026-08-24", line: "Línea 1", ...actorArgs })
    ).rejects.toThrow(/No hay cambios/);
  });
});

/**
 * AUDIT_TRAZABILIDAD_PROPAGACION — Caso 6 obligatorio: Rehacer (Calidad →
 * sector origen) nunca debe resetear lote/VTO/packingGroups/cantidad/OA ni
 * muestras/sobrante — solo cambia status y registra el motivo. Esto ya
 * estaba implementado correctamente (reworkWorkItemDurable solo escribe las
 * columnas de estado operativo, completado, rework y progreso), pero no
 * tenía cobertura de test — este bloque prueba el round-trip escritura
 * seguida de lectura independiente ("segunda lectura real") contra el fake
 * tx, no solo el valor de retorno de la propia transacción.
 */
describe("reworkWorkItemDurable — Rehacer preserva lote/VTO/packing/cantidad/OA (fake tx)", () => {
  let reworkWorkItemDurable: typeof import("./work-item-progress-repository").reworkWorkItemDurable;

  const actorArgs = { requestedBy: "calidad@laboratoriogenus.com.ar", requestedBySector: "CALIDAD" as const };

  beforeEach(async () => {
    vi.resetModules();
    fakeDbHandle = createFakeDb();
    ({ reworkWorkItemDurable } = await import("./work-item-progress-repository"));
    fakeDbHandle.workItems.set("wi-rehacer", {
      id: "wi-rehacer",
      sector: "CODIFICADO",
      planningWeekId: "week-1",
      operationalStatus: "completado",
      completedAt: new Date("2026-08-03T18:00:00.000Z"),
      completedBy: "Codificador",
      qualityStatus: "pendiente",
      deliveredFromCodificadoAt: new Date("2026-08-03T18:05:00.000Z"),
      deliveredFromCodificadoBy: "Codificador",
      deletedAt: null,
      packagingLote: "L-900",
      packagingVto: "2027-06-01",
      orderNumber: "OA-2026-000145",
      plannedQuantity: "1200",
      product: "Producto Test",
      client: "Cliente Test",
      packingGroups: [
        { cajas: 10, unidadesPorCaja: 100 },
        { cajas: 2, unidadesPorCaja: 50 },
      ],
      sampleUnits: 3,
      bulkRemainderKg: 3.2,
    });
  });

  it("6) Rehacer reabre el trabajo (limpia completedAt/entrega) sin tocar lote/VTO/OA/packing/cantidad — confirmado con una segunda lectura independiente", async () => {
    const returned = await reworkWorkItemDurable("wi-rehacer", {
      reason: "Faltó ajustar el precinto",
      ...actorArgs,
    });
    expect(returned.operationalStatus).toBe("en_curso");
    expect(returned.completedAt).toBeNull();
    expect(returned.deliveredFromCodificadoAt).toBeNull();
    expect(returned.reworkReason).toBe("Faltó ajustar el precinto");

    // Segunda lectura real — independiente del valor de retorno de la propia
    // transacción, contra el estado persistido en la fila.
    const persisted = fakeDbHandle.workItems.get("wi-rehacer")!;
    expect(persisted.packagingLote).toBe("L-900");
    expect(persisted.packagingVto).toBe("2027-06-01");
    expect(persisted.orderNumber).toBe("OA-2026-000145");
    expect(persisted.plannedQuantity).toBe("1200");
    expect(persisted.packingGroups).toEqual([
      { cajas: 10, unidadesPorCaja: 100 },
      { cajas: 2, unidadesPorCaja: 50 },
    ]);
    expect(persisted.sampleUnits).toBe(3);
    expect(persisted.bulkRemainderKg).toBe(3.2);
  });

  it("rechaza Rehacer si el trabajo no está completado (nada que rehacer)", async () => {
    fakeDbHandle.workItems.get("wi-rehacer")!.completedAt = null;
    fakeDbHandle.workItems.get("wi-rehacer")!.operationalStatus = "en_curso";
    await expect(
      reworkWorkItemDurable("wi-rehacer", { reason: "Motivo", ...actorArgs })
    ).rejects.toMatchObject({ name: "PlanningValidationError" });
    // Sin cambios — la fila sigue como estaba.
    expect(fakeDbHandle.workItems.get("wi-rehacer")!.packagingLote).toBe("L-900");
  });

  it("rechaza Rehacer si hay una entrega activa al cliente (ENTREGADO, no archivada)", async () => {
    fakeDbHandle.workItemDeliveries.set("dlv-1", {
      id: "dlv-1",
      workItemId: "wi-rehacer",
      status: "ENTREGADO",
      archived: false,
    });
    await expect(
      reworkWorkItemDurable("wi-rehacer", { reason: "Motivo", ...actorArgs })
    ).rejects.toMatchObject({ name: "PlanningValidationError" });
  });

  it("E) Rehacer preserva un Lote/VTO que Envasado/Codificado completó (no solo el que cargó Producción)", async () => {
    // A diferencia del resto de estos tests, acá el lote NO lo cargó
    // Producción al asignar — lo completó Envasado/Codificado después, vía
    // "Guardar avance" (saveWorkProgressDurable, ver el describe de más
    // abajo). Rehacer debe preservarlo exactamente igual.
    fakeDbHandle.workItems.get("wi-rehacer")!.packagingLote = "L26099";
    fakeDbHandle.workItems.get("wi-rehacer")!.packagingVto = "2028-08";
    await reworkWorkItemDurable("wi-rehacer", { reason: "Motivo", ...actorArgs });
    const persisted = fakeDbHandle.workItems.get("wi-rehacer")!;
    expect(persisted.packagingLote).toBe("L26099");
    expect(persisted.packagingVto).toBe("2028-08");
  });
});

/**
 * DECISIÓN_FUNCIONAL (PR #81, segunda vuelta) — Envasado/Codificado pueden
 * completar Lote/VTO cuando Producción los dejó vacíos ("fill-once"), pero
 * nunca sobreescribir un valor ya cargado. Este es el punto de entrada
 * PRINCIPAL: "Guardar avance" (PackagingQuantitiesBlock → saveWorkPackaging
 * → save_progress → saveWorkProgressDurable), disponible tanto en el drawer
 * compartido de Envasado como en la vista dedicada de Codificado.
 */
describe("saveWorkProgressDurable — Lote/VTO fill-once (fake tx)", () => {
  let saveWorkProgressDurable: typeof import("./work-item-progress-repository").saveWorkProgressDurable;

  beforeEach(async () => {
    vi.resetModules();
    fakeDbHandle = createFakeDb();
    ({ saveWorkProgressDurable } = await import("./work-item-progress-repository"));
    fakeDbHandle.workItems.set("wi-progress", {
      id: "wi-progress",
      sector: "ENVASADO_MASIVO",
      operationalStatus: "en_curso",
      planningWeekId: "week-1",
      packagingLote: null,
      packagingVto: null,
      packingGroups: null,
    });
  });

  it("B) Producción dejó Lote/VTO vacíos — Envasado los completa al Guardar avance, y quedan persistidos en el MISMO work item", async () => {
    const row = await saveWorkProgressDurable(
      "wi-progress",
      {
        finishedQty: "500",
        observation: "",
        updatedBy: "envasado@laboratoriogenus.com.ar",
        packagingLote: "L26099",
        packagingVto: "2028-08",
      },
      "ENVASADO_MASIVO"
    );
    expect(row!.packagingLote).toBe("L26099");
    expect(row!.packagingVto).toBe("2028-08");

    // Segunda lectura real — independiente del valor de retorno de la transacción.
    const persisted = fakeDbHandle.workItems.get("wi-progress")!;
    expect(persisted.packagingLote).toBe("L26099");
    expect(persisted.packagingVto).toBe("2028-08");

    const event = fakeDbHandle.operationalEvents.find(
      (e) => (e as { type?: string }).type === "LOTE_VTO_FILLED"
    );
    expect(event).toBeTruthy();
  });

  it("A) Producción ya cargó Lote/VTO — Guardar avance NUNCA los sobreescribe, aunque el cliente mande otro valor", async () => {
    fakeDbHandle.workItems.get("wi-progress")!.packagingLote = "L26099";
    fakeDbHandle.workItems.get("wi-progress")!.packagingVto = "2028-08";

    const row = await saveWorkProgressDurable(
      "wi-progress",
      {
        finishedQty: "500",
        observation: "",
        updatedBy: "envasado@laboratoriogenus.com.ar",
        packagingLote: "L-OTRO-VALOR",
        packagingVto: "2030-01",
      },
      "ENVASADO_MASIVO"
    );
    expect(row!.packagingLote).toBe("L26099");
    expect(row!.packagingVto).toBe("2028-08");
    expect(fakeDbHandle.workItems.get("wi-progress")!.packagingLote).toBe("L26099");
    expect(
      fakeDbHandle.operationalEvents.some((e) => (e as { type?: string }).type === "LOTE_VTO_FILLED")
    ).toBe(false);
  });

  it("C) Codificado también puede completarlos vía Guardar avance", async () => {
    fakeDbHandle.workItems.get("wi-progress")!.sector = "CODIFICADO";
    const row = await saveWorkProgressDurable(
      "wi-progress",
      {
        finishedQty: "500",
        observation: "",
        updatedBy: "codificado@laboratoriogenus.com.ar",
        packagingLote: "L26099",
        packagingVto: "2028-08",
      },
      "CODIFICADO"
    );
    expect(row!.packagingLote).toBe("L26099");
    expect(row!.packagingVto).toBe("2028-08");
  });

  it("D) actualizar packingGroups no borra un Lote/VTO ya cargado", async () => {
    fakeDbHandle.workItems.get("wi-progress")!.packagingLote = "L26099";
    fakeDbHandle.workItems.get("wi-progress")!.packagingVto = "2028-08";

    const row = await saveWorkProgressDurable(
      "wi-progress",
      {
        finishedQty: "500",
        observation: "",
        updatedBy: "envasado@laboratoriogenus.com.ar",
        packingGroups: [{ cajas: 2, unidadesPorCaja: 250 }],
      },
      "ENVASADO_MASIVO"
    );
    expect(row!.packagingLote).toBe("L26099");
    expect(row!.packagingVto).toBe("2028-08");
    expect(row!.packingGroups).toEqual([{ cajas: 2, unidadesPorCaja: 250 }]);
  });

  it("F) cambio de estado sin mandar Lote/VTO — no los clobberea (quedan en null, no se inventan)", async () => {
    const row = await saveWorkProgressDurable(
      "wi-progress",
      { finishedQty: "500", observation: "avance", updatedBy: "envasado@laboratoriogenus.com.ar" },
      "ENVASADO_MASIVO"
    );
    expect(row!.packagingLote).toBeNull();
    expect(row!.packagingVto).toBeNull();
  });

  it("RBAC: un sector ajeno al work item no puede completar Lote/VTO (mismo gate que el resto del avance)", async () => {
    await expect(
      saveWorkProgressDurable(
        "wi-progress",
        {
          finishedQty: "500",
          observation: "",
          updatedBy: "codificado@laboratoriogenus.com.ar",
          packagingLote: "L26099",
        },
        "CODIFICADO"
      )
    ).rejects.toThrow();
    expect(fakeDbHandle.workItems.get("wi-progress")!.packagingLote).toBeNull();
  });
});

/**
 * AUDITORÍA DE INTEGRIDAD END-TO-END DEL WORK ITEM — deliverWorkDurable era
 * el punto de fuga real confirmado: vto/orderNumber/packingGroups ya se
 * releían frescos de work_items (0028), pero lote/product/client/quantity/
 * unit/cantidades/muestras/sobrante/Pedido se tomaban tal cual del body del
 * cliente. Si el navegador de Depósito/Expedición tenía una pantalla vieja
 * abierta (ej. Codificado completó el lote recién, y el poll de 20s todavía
 * no llegó), la entrega quedaba grabada con el valor viejo — y esa fila es
 * la fuente del Remito. REGLA NUEVA: el servidor SIEMPRE relee todo dato
 * canónico del work_item actual en Neon al momento de entregar, nunca del
 * body — ver loadWorkItemOperationalData().
 */
describe("deliverWorkDurable — el servidor relee TODO dato canónico de Neon, nunca confía en el body (fake tx)", () => {
  let deliverWorkDurable: typeof import("./work-item-progress-repository").deliverWorkDurable;

  const baseInput = {
    workItemId: "wi-deliver",
    qualityItemId: "qc-1",
    codigo: "COD-1",
    sourceSector: "CODIFICADO" as const,
    plannedDeliveryDate: "2026-09-15",
    actualDeliveredAt: "2026-09-12T12:00:00.000Z",
    remito: null,
    receivedBy: "Juan Pérez",
    observations: "Entrega de prueba",
    deliveredBy: "deposito@laboratoriogenus.com.ar",
    deliveredBySector: "DEPOSITO" as const,
  };

  beforeEach(async () => {
    vi.resetModules();
    fakeDbHandle = createFakeDb();
    ({ deliverWorkDurable } = await import("./work-item-progress-repository"));
    fakeDbHandle.workItems.set("wi-deliver", {
      id: "wi-deliver",
      client: "Cliente Real",
      product: "Producto Real",
      unit: "u",
      orderNumber: "OA-2026-000150",
      productionPedidoId: "pedido-1",
      packagingLote: "L26099",
      packagingVto: "2028-10",
      plannedQuantity: "1250",
      finishedQty: "1250",
      packagingTotalUnits: 1250,
      packingGroups: [
        { cajas: 10, unidadesPorCaja: 100 },
        { cajas: 2, unidadesPorCaja: 50 },
      ],
      packingMismatchObservation: null,
      sampleUnits: 3,
      deliverableUnits: 1200,
      bulkRemainderKg: null,
      bulkRemainderObservation: null,
    });
    fakeDbHandle.productionPedidos.set("pedido-1", { id: "pedido-1", op: "OP-4521" });
  });

  it("TEST CRÍTICO — el frontend manda lote/vto/packingGroups viejos o vacíos; el resultado conserva lo que está en Neon (test obligatorio #8)", async () => {
    const row = await deliverWorkDurable({
      ...baseInput,
      // Frontend "stale": manda valores viejos/vacíos para datos que YA
      // pertenecen al work item — el servidor debe ignorarlos por completo.
      product: "Producto Viejo (stale)",
      client: "Cliente Viejo (stale)",
      lote: null,
      quantity: "1",
      unit: "kg",
    } as never);

    expect(row.lote).toBe("L26099");
    expect(row.vto).toBe("2028-10");
    expect(row.product).toBe("Producto Real");
    expect(row.client).toBe("Cliente Real");
    expect(row.packingGroups).toEqual([
      { cajas: 10, unidadesPorCaja: 100 },
      { cajas: 2, unidadesPorCaja: 50 },
    ]);
    expect(row.orderNumber).toBe("OA-2026-000150");
    expect(row.pedidoOp).toBe("OP-4521");
    expect(row.plannedQuantity).toBe("1250");
    expect(row.finishedQty).toBe("1250");
    expect(row.sampleUnits).toBe(3);
    expect(row.deliverableUnits).toBe(1200);
    // Cantidad "oficial" de la entrega = lo físicamente embalado (1200), no
    // el "1" que mandó el frontend ni la cantidad producida cruda (1250).
    expect(row.quantity).toBe("1200");

    // Segunda lectura independiente — contra la fila realmente persistida,
    // no contra el valor de retorno de la propia llamada.
    const persisted = fakeDbHandle.workItemDeliveries.get(row.id as string)!;
    expect(persisted.lote).toBe("L26099");
    expect(persisted.vto).toBe("2028-10");
    expect(persisted.packingGroups).toEqual([
      { cajas: 10, unidadesPorCaja: 100 },
      { cajas: 2, unidadesPorCaja: 50 },
    ]);
  });

  it("preserva muestras y sobrante de granel (ELABORACION) en el snapshot de entrega", async () => {
    fakeDbHandle.workItems.get("wi-deliver")!.bulkRemainderKg = 4.5;
    fakeDbHandle.workItems.get("wi-deliver")!.bulkRemainderObservation = "Sobrante de mezcla";
    const row = await deliverWorkDurable(baseInput as never);
    expect(row.sampleUnits).toBe(3);
    expect(row.bulkRemainderKg).toBe(4.5);
    expect(row.bulkRemainderObservation).toBe("Sobrante de mezcla");
  });

  it("no reconstruye packingGroups desde un total — preserva el array de grupos EXACTO (10×100, 2×50, nunca 1200 plano)", async () => {
    const row = await deliverWorkDurable(baseInput as never);
    expect(row.packingGroups).toEqual([
      { cajas: 10, unidadesPorCaja: 100 },
      { cajas: 2, unidadesPorCaja: 50 },
    ]);
    expect(Array.isArray(row.packingGroups)).toBe(true);
    expect((row.packingGroups as unknown[]).length).toBe(2);
  });

  it("idempotente: si ya hay una entrega activa, la devuelve sin crear una segunda ni volver a leer el work item", async () => {
    fakeDbHandle.workItemDeliveries.set("dlv-existing", {
      id: "dlv-existing",
      workItemId: "wi-deliver",
      status: "ENTREGADO",
      archived: false,
      lote: "L26099",
    });
    const row = await deliverWorkDurable(baseInput as never);
    expect(row.id).toBe("dlv-existing");
    expect(fakeDbHandle.workItemDeliveries.size).toBe(1);
  });

  it("rechaza si el work item no existe", async () => {
    await expect(
      deliverWorkDurable({ ...baseInput, workItemId: "wi-inexistente" } as never)
    ).rejects.toThrow("Work item no encontrado.");
  });
});
