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
    const c = cond as { __eq?: [string, unknown]; __isNotNull?: string };
    if (c.__eq) return row[c.__eq[0]] === c.__eq[1];
    if (c.__isNotNull) return row[c.__isNotNull] != null;
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
    "qualityStatus",
    "qualityDecidedAt",
    "qualityDecidedBy",
    "qualityDecidedBySector",
    "qualityObservation",
    "qualityChangeReason",
  ];
  const orderCols = ["id", "orderNumber", "type", "linkedWorkItemId", "version"];
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

describe("decideQualityBatchDurable — aprobación masiva de Calidad (fake tx)", () => {
  let decideQualityBatchDurable: typeof import("./work-item-progress-repository").decideQualityBatchDurable;

  const actorArgs = {
    decidedBy: "calidad@laboratoriogenus.com.ar",
    decidedBySector: "CALIDAD" as const,
    batchId: "batch-1",
  };

  beforeEach(async () => {
    vi.resetModules();
    fakeDbHandle = createFakeDb();
    ({ decideQualityBatchDurable } = await import("./work-item-progress-repository"));
    fakeDbHandle.workItems.set("wi-1", {
      id: "wi-1",
      qualityStatus: "pendiente",
      deletedAt: null,
      planningWeekId: "week-1",
      product: "SHAVING GEL",
      client: "NOCE CANA",
      plannedDate: "2026-09-10",
      plannedDateTo: null,
      packagingLote: "G26043",
      packagingVto: "2028-10",
      packingGroups: [{ cajas: 10, unidadesPorCaja: 100 }],
      finishedQty: "1000",
      plannedQuantity: "1000",
    });
    fakeDbHandle.workItems.set("wi-2", {
      id: "wi-2",
      qualityStatus: "pendiente",
      deletedAt: null,
      planningWeekId: "week-1",
      product: "SERUM NIACINAMIDA",
      client: "NIZA",
      plannedDate: "2026-09-11",
      plannedDateTo: null,
      packagingLote: "A26042",
      packagingVto: "2028-11",
      packingGroups: [{ cajas: 5, unidadesPorCaja: 50 }],
      finishedQty: "500",
      plannedQuantity: "500",
    });
  });

  it("aprueba varios ids pendientes — un resultado 'ok' y un evento de auditoría independiente por cada uno", async () => {
    const results = await decideQualityBatchDurable(["wi-1", "wi-2"], "aprobado", actorArgs);
    expect(results).toEqual([
      {
        id: "wi-1",
        status: "ok",
        snapshot: {
          product: "SHAVING GEL",
          client: "NOCE CANA",
          plannedDate: "2026-09-10",
          plannedDateTo: null,
          lote: "G26043",
          quantity: "1000",
        },
      },
      {
        id: "wi-2",
        status: "ok",
        snapshot: {
          product: "SERUM NIACINAMIDA",
          client: "NIZA",
          plannedDate: "2026-09-11",
          plannedDateTo: null,
          lote: "A26042",
          quantity: "500",
        },
      },
    ]);
    expect(fakeDbHandle.workItems.get("wi-1")!.qualityStatus).toBe("aprobado");
    expect(fakeDbHandle.workItems.get("wi-1")!.qualityDecidedBy).toBe(actorArgs.decidedBy);
    expect(fakeDbHandle.workItems.get("wi-1")!.qualityDecidedBySector).toBe("CALIDAD");
    expect(fakeDbHandle.operationalEvents).toHaveLength(2);
    const [event1, event2] = fakeDbHandle.operationalEvents as Array<Record<string, unknown>>;
    expect(event1).toMatchObject({
      workItemId: "wi-1",
      type: "QUALITY_APPROVED",
      fromStatus: "pendiente",
      toStatus: "aprobado",
      actorEmail: actorArgs.decidedBy,
      actorSector: "CALIDAD",
      note: "batchId=batch-1·lote=G26043",
    });
    expect(event2).toMatchObject({ workItemId: "wi-2", note: "batchId=batch-1·lote=A26042" });
  });

  it("idempotente frente a doble click/retry: reintentar sobre ids ya aprobados devuelve 'already', sin duplicar auditoría", async () => {
    await decideQualityBatchDurable(["wi-1"], "aprobado", actorArgs);
    expect(fakeDbHandle.operationalEvents).toHaveLength(1);
    const retry = await decideQualityBatchDurable(["wi-1"], "aprobado", actorArgs);
    expect(retry).toEqual([{ id: "wi-1", status: "already", currentStatus: "aprobado" }]);
    // Ningún evento nuevo — la segunda llamada no vuelve a decidir ni a auditar.
    expect(fakeDbHandle.operationalEvents).toHaveLength(1);
  });

  it("nunca pisa una decisión distinta ya tomada (rechazado) — la reporta como error, no la sobreescribe", async () => {
    fakeDbHandle.workItems.get("wi-1")!.qualityStatus = "rechazado";
    const results = await decideQualityBatchDurable(["wi-1"], "aprobado", actorArgs);
    expect(results).toEqual([
      { id: "wi-1", status: "error", message: "Ya tiene una decisión distinta (rechazado)." },
    ]);
    expect(fakeDbHandle.workItems.get("wi-1")!.qualityStatus).toBe("rechazado");
    expect(fakeDbHandle.operationalEvents).toHaveLength(0);
  });

  it("id inexistente → error individual, no interrumpe el resto del lote", async () => {
    const results = await decideQualityBatchDurable(["wi-inexistente", "wi-1"], "aprobado", actorArgs);
    expect(results[0]).toEqual({ id: "wi-inexistente", status: "error", message: "Trabajo no encontrado." });
    expect(results[1]).toMatchObject({ id: "wi-1", status: "ok" });
  });

  it("un trabajo eliminado por Producción no puede aprobarse", async () => {
    fakeDbHandle.workItems.get("wi-1")!.deletedAt = new Date("2026-09-01T00:00:00Z");
    const results = await decideQualityBatchDurable(["wi-1"], "aprobado", actorArgs);
    expect(results).toEqual([
      { id: "wi-1", status: "error", message: "Este trabajo fue eliminado por Producción." },
    ]);
    expect(fakeDbHandle.workItems.get("wi-1")!.qualityStatus).toBe("pendiente");
  });

  it("resultado parcial: ok + error conviven en el mismo lote sin abortarse entre sí", async () => {
    const results = await decideQualityBatchDurable(
      ["wi-1", "wi-inexistente", "wi-2"],
      "aprobado",
      actorArgs
    );
    expect(results.map((r) => r.status)).toEqual(["ok", "error", "ok"]);
  });

  it("nunca toca lote/VTO/packing/cantidades — solo las columnas quality_*", async () => {
    await decideQualityBatchDurable(["wi-1"], "aprobado", actorArgs);
    const row = fakeDbHandle.workItems.get("wi-1")!;
    expect(row.packagingLote).toBe("G26043");
    expect(row.packagingVto).toBe("2028-10");
    expect(row.packingGroups).toEqual([{ cajas: 10, unidadesPorCaja: 100 }]);
    expect(row.finishedQty).toBe("1000");
  });

  it("concurrencia: si otro proceso decide el mismo trabajo entre la lectura y la escritura, relee en vez de pisarlo", async () => {
    const realUpdate = fakeDbHandle.tx.update.bind(fakeDbHandle.tx);
    let intercepted = false;
    fakeDbHandle.tx.update = ((table: { __name: string }) => {
      if (!intercepted) {
        intercepted = true;
        // Simula que otra decisión (rechazado) ganó la carrera justo antes del UPDATE guardado.
        fakeDbHandle.workItems.get("wi-1")!.qualityStatus = "rechazado";
      }
      return realUpdate(table);
    }) as typeof fakeDbHandle.tx.update;

    const results = await decideQualityBatchDurable(["wi-1"], "aprobado", actorArgs);
    expect(results).toEqual([
      { id: "wi-1", status: "error", message: "El trabajo cambió de estado mientras se procesaba." },
    ]);
    expect(fakeDbHandle.workItems.get("wi-1")!.qualityStatus).toBe("rechazado");
    expect(fakeDbHandle.operationalEvents).toHaveLength(0);
  });
});
