import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests de fillBareWorkItemsFromAsignacionLote con un fake db (mismo patrón
 * que work-item-progress-repository.test.ts). Cubre el Test 12 pedido:
 * lote/VTO cargados DESPUÉS en Asignación de Lotes completan únicamente
 * campos faltantes si la coincidencia es inequívoca, y nunca reemplazan un
 * valor ya existente.
 */

type FakeRow = Record<string, unknown> & { id: string };

function createFakeDb() {
  const workItems = new Map<string, FakeRow>();
  const operationalEvents: Record<string, unknown>[] = [];

  function matchCond(row: Record<string, unknown>, cond: unknown): boolean {
    if (!cond) return true;
    if (Array.isArray(cond)) return cond.every((c) => matchCond(row, c));
    const c = cond as { __eq?: [string, unknown]; __isNull?: string; __ne?: [string, unknown] };
    if (c.__eq) return row[c.__eq[0]] === c.__eq[1];
    if (c.__isNull) return row[c.__isNull] == null;
    if (c.__ne) return row[c.__ne[0]] !== c.__ne[1];
    return true;
  }

  const db = {
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
        then(resolve: (v: FakeRow[]) => unknown) {
          return Promise.resolve(resolve([...workItems.values()].filter((r) => matchCond(r, cond)).map((r) => ({ ...r }))));
        },
      };
      return api;
    },
    update() {
      return {
        set(patch: Record<string, unknown>) {
          return {
            where(cond: unknown) {
              const updated: FakeRow[] = [];
              for (const row of workItems.values()) {
                if (matchCond(row, cond)) {
                  Object.assign(row, patch);
                  updated.push({ ...row });
                }
              }
              return { returning: () => Promise.resolve(updated) };
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
          }
          return Promise.resolve();
        },
      };
    },
  };

  return { db, workItems, operationalEvents };
}

let fakeDbHandle: ReturnType<typeof createFakeDb>;

vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual<typeof import("drizzle-orm")>("drizzle-orm");
  return {
    ...actual,
    eq: (col: { name?: string } | string, val: unknown) => ({
      __eq: [typeof col === "string" ? col : (col as { name?: string }).name ?? "id", val],
    }),
    ne: (col: { name?: string } | string, val: unknown) => ({
      __ne: [typeof col === "string" ? col : (col as { name?: string }).name ?? "id", val],
    }),
    isNull: (col: { name?: string } | string) => ({
      __isNull: typeof col === "string" ? col : (col as { name?: string }).name ?? "id",
    }),
    and: (...args: unknown[]) => args,
  };
});

vi.mock("@/lib/db/client", () => ({
  getDb: () => fakeDbHandle.db,
}));

vi.mock("@/lib/db/schema", () => {
  const cols = ["id", "client", "product", "planningWeekId", "sector", "deletedAt", "packagingLote", "packagingVto"];
  const t: Record<string, unknown> = { __name: "workItems" };
  for (const c of cols) t[c] = { name: c };
  return {
    workItems: t,
    operationalEvents: { __name: "operationalEvents" },
  };
});

describe("fillBareWorkItemsFromAsignacionLote — sincronización retroactiva (Test 12)", () => {
  let fillBareWorkItemsFromAsignacionLote: typeof import("./sync-to-bare-workitems").fillBareWorkItemsFromAsignacionLote;

  beforeEach(async () => {
    vi.resetModules();
    fakeDbHandle = createFakeDb();
    ({ fillBareWorkItemsFromAsignacionLote } = await import("./sync-to-bare-workitems"));
  });

  const record = {
    id: "al-1",
    lote: "G26043",
    vto: "2028-10-31",
    producto: "SERUM NIACINAMIDA",
    marca: "NIZA",
    updatedBy: "calidad@laboratoriogenus.com.ar",
  };

  it("WorkItem sin lote/VTO (ambos null) y coincidencia única -> se completa", async () => {
    fakeDbHandle.workItems.set("wi-1", {
      id: "wi-1",
      client: "NIZA",
      product: "SERUM NIACINAMIDA",
      sector: "ENVASADO_MASIVO",
      planningWeekId: "week-1",
      deletedAt: null,
      packagingLote: null,
      packagingVto: null,
    });
    const result = await fillBareWorkItemsFromAsignacionLote(record, "CALIDAD");
    expect(result.filledWorkItemId).toBe("wi-1");
    expect(fakeDbHandle.workItems.get("wi-1")!.packagingLote).toBe("G26043");
    expect(fakeDbHandle.workItems.get("wi-1")!.packagingVto).toBe("2028-10-31");
    expect(fakeDbHandle.operationalEvents).toHaveLength(1);
    expect(fakeDbHandle.operationalEvents[0]).toMatchObject({ type: "LOTE_VTO_FILLED", workItemId: "wi-1" });
  });

  it("Test 9 (nunca clobber): WorkItem ya tiene un lote propio -> nunca se sobreescribe, aunque sea el único match de cliente+producto", async () => {
    fakeDbHandle.workItems.set("wi-1", {
      id: "wi-1",
      client: "NIZA",
      product: "SERUM NIACINAMIDA",
      sector: "ENVASADO_MASIVO",
      planningWeekId: "week-1",
      deletedAt: null,
      packagingLote: "YA-CARGADO",
      packagingVto: null,
    });
    const result = await fillBareWorkItemsFromAsignacionLote(record, "CALIDAD");
    expect(result.filledWorkItemId).toBeNull();
    expect(fakeDbHandle.workItems.get("wi-1")!.packagingLote).toBe("YA-CARGADO");
  });

  it("dos WorkItems en blanco para el mismo cliente+producto -> ambiguo, no completa ninguno", async () => {
    fakeDbHandle.workItems.set("wi-1", {
      id: "wi-1",
      client: "NIZA",
      product: "SERUM NIACINAMIDA",
      sector: "ENVASADO_MASIVO",
      planningWeekId: "week-1",
      deletedAt: null,
      packagingLote: null,
      packagingVto: null,
    });
    fakeDbHandle.workItems.set("wi-2", {
      id: "wi-2",
      client: "NIZA",
      product: "SERUM NIACINAMIDA",
      sector: "ENVASADO_PREMIUM",
      planningWeekId: "week-1",
      deletedAt: null,
      packagingLote: null,
      packagingVto: null,
    });
    const result = await fillBareWorkItemsFromAsignacionLote(record, "CALIDAD");
    expect(result.filledWorkItemId).toBeNull();
    expect(fakeDbHandle.workItems.get("wi-1")!.packagingLote).toBeNull();
    expect(fakeDbHandle.workItems.get("wi-2")!.packagingLote).toBeNull();
  });

  it("sin match de cliente+producto -> no-op", async () => {
    fakeDbHandle.workItems.set("wi-1", {
      id: "wi-1",
      client: "OTRO CLIENTE",
      product: "OTRO PRODUCTO",
      sector: "ENVASADO_MASIVO",
      planningWeekId: "week-1",
      deletedAt: null,
      packagingLote: null,
      packagingVto: null,
    });
    const result = await fillBareWorkItemsFromAsignacionLote(record, "CALIDAD");
    expect(result.filledWorkItemId).toBeNull();
  });

  it("AsignacionLote sin VTO (solo lote) -> no-op, nunca completa a medias", async () => {
    fakeDbHandle.workItems.set("wi-1", {
      id: "wi-1",
      client: "NIZA",
      product: "SERUM NIACINAMIDA",
      sector: "ENVASADO_MASIVO",
      planningWeekId: "week-1",
      deletedAt: null,
      packagingLote: null,
      packagingVto: null,
    });
    const result = await fillBareWorkItemsFromAsignacionLote(
      { ...record, vto: null },
      "CALIDAD"
    );
    expect(result.filledWorkItemId).toBeNull();
    expect(fakeDbHandle.workItems.get("wi-1")!.packagingLote).toBeNull();
  });
});
