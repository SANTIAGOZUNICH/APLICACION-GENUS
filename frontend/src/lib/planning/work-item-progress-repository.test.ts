import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests de updateWorkItemPlanningDurable con un fake tx (mismo patrón que
 * ensure-oa-on-assign.test.ts / work-assignment-service.test.ts). Cubren
 * la extensión de "Fecha de producción" (plannedDate) — validación de
 * rango dentro de la semana ya publicada — y reconfirman que el patch
 * parcial estricto (undefined = no tocar) sigue intacto tras el cambio.
 */

type FakeWorkItem = Record<string, unknown> & { id: string };

function createFakeDb() {
  const workItems = new Map<string, FakeWorkItem>();
  const operationalEvents: Record<string, unknown>[] = [];

  function matchCond(row: Record<string, unknown>, cond: unknown): boolean {
    if (!cond) return true;
    if (Array.isArray(cond)) return cond.every((c) => matchCond(row, c));
    const c = cond as { __eq?: [string, unknown] };
    if (c.__eq) return row[c.__eq[0]] === c.__eq[1];
    return true;
  }

  const tx = {
    select() {
      let cond: unknown = null;
      const api = {
        from() {
          return api;
        },
        where(c: unknown) {
          cond = c;
          return api;
        },
        limit(n: number) {
          return Promise.resolve(
            [...workItems.values()]
              .filter((r) => matchCond(r, cond))
              .slice(0, n)
              .map((r) => ({ ...r }))
          );
        },
      };
      return api;
    },
    update() {
      return {
        set(patch: Record<string, unknown>) {
          return {
            where(cond: unknown) {
              return {
                returning() {
                  const updated: FakeWorkItem[] = [];
                  for (const row of workItems.values()) {
                    if (matchCond(row, cond)) {
                      Object.assign(row, patch);
                      updated.push({ ...row });
                    }
                  }
                  return Promise.resolve(updated);
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

  return { tx, workItems, operationalEvents };
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
  };
});

vi.mock("@/lib/db/client", () => ({
  getDb: () => ({ transaction: (fn: (tx: unknown) => unknown) => fn(fakeDbHandle.tx) }),
}));

vi.mock("@/lib/db/schema", () => {
  const cols = [
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
  ];
  const table = (name: string) => {
    const t: Record<string, unknown> = { __name: name };
    for (const c of cols) t[c] = { name: c };
    return t;
  };
  return {
    workItems: table("workItems"),
    workItemDeliveries: table("workItemDeliveries"),
    operationalEvents: table("operationalEvents"),
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
