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
  const operationalEvents: Record<string, unknown>[] = [];

  function matchCond(row: Record<string, unknown>, cond: unknown): boolean {
    if (!cond) return true;
    if (Array.isArray(cond)) return cond.every((c) => matchCond(row, c));
    const c = cond as { __eq?: [string, unknown] };
    if (c.__eq) return row[c.__eq[0]] === c.__eq[1];
    // Predicado SQL crudo (ej. version + 1, IS NULL OR = id) — no
    // introspectable en el fake; se trata como cierto (mismo criterio que
    // work-assignment-service.test.ts).
    return true;
  }

  function tableFor(name: string): Map<string, FakeRow> {
    return name === "operationalOrders" ? operationalOrders : workItems;
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
          if (table.__name === "operationalEvents") operationalEvents.push(row);
          return Promise.resolve();
        },
      };
    },
    transaction(fn: (tx: unknown) => unknown) {
      return fn(tx);
    },
  };

  return { tx, workItems, operationalOrders, operationalEvents };
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
  ];
  const orderCols = ["id", "orderNumber", "type", "linkedWorkItemId", "version"];
  const table = (name: string, cols: string[]) => {
    const t: Record<string, unknown> = { __name: name };
    for (const c of cols) t[c] = { name: c };
    return t;
  };
  return {
    workItems: table("workItems", workItemCols),
    workItemDeliveries: table("workItemDeliveries", []),
    operationalEvents: table("operationalEvents", []),
    operationalOrders: table("operationalOrders", orderCols),
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
