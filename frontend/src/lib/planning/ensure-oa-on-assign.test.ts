import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests del flujo ensure-OA con fake tx (sin DATABASE_URL).
 * Cubre: create exact number, link without duplicate, 1:1 conflict, force fill, idempotency.
 */

type FakeOrder = {
  id: string;
  orderNumber: string;
  type: "OA" | "OE";
  assignedSector: string;
  linkedWorkItemId: string | null;
  product: string;
  client: string;
  lot: string;
  code: string;
  formData: unknown;
  status: string;
  version: number;
};

function createFakeDb() {
  const orders = new Map<string, FakeOrder>();
  const templates: unknown[] = [];
  const audits: unknown[] = [];
  const versions: unknown[] = [];
  const sequences = new Map<string, number>();

  const tx = {
    select(_cols?: unknown) {
      const state: { whereEq?: { col: string; val: string } } = {};
      const api = {
        from(_table: unknown) {
          return api;
        },
        where(cond: { __eq?: [string, string] }) {
          if (cond?.__eq) state.whereEq = { col: cond.__eq[0], val: cond.__eq[1] };
          return api;
        },
        limit(_n: number) {
          if (state.whereEq?.col === "orderNumber") {
            for (const o of orders.values()) {
              if (o.orderNumber === state.whereEq.val) return Promise.resolve([o]);
            }
          }
          if (state.whereEq?.col === "id") {
            const o = orders.get(state.whereEq.val);
            return Promise.resolve(o ? [o] : []);
          }
          return Promise.resolve([]);
        },
      };
      return api;
    },
    insert(table: { __name: string }) {
      return {
        values(row: Record<string, unknown>) {
          if (table.__name === "orderTemplates") {
            templates.push(row);
            return { onConflictDoNothing: () => Promise.resolve() };
          }
          if (table.__name === "operationalOrders") {
            const num = String(row.orderNumber);
            if ([...orders.values()].some((o) => o.orderNumber === num)) {
              return Promise.reject(
                new Error(
                  'duplicate key value violates unique constraint "operational_orders_number_uidx"'
                )
              );
            }
            const o: FakeOrder = {
              id: String(row.id),
              orderNumber: num,
              type: row.type as "OA",
              assignedSector: String(row.assignedSector),
              linkedWorkItemId: (row.linkedWorkItemId as string | null) ?? null,
              product: String(row.product ?? ""),
              client: String(row.client ?? ""),
              lot: String(row.lot ?? ""),
              code: String(row.code ?? ""),
              formData: row.formData,
              status: String(row.status),
              version: Number(row.version ?? 1),
            };
            orders.set(o.id, o);
            return Promise.resolve();
          }
          if (table.__name === "orderVersions") {
            versions.push(row);
            return Promise.resolve();
          }
          if (table.__name === "orderAuditEvents") {
            audits.push(row);
            return Promise.resolve();
          }
          if (table.__name === "orderNumberSequences") {
            const key = `${row.type}-${row.year}`;
            if (!sequences.has(key)) sequences.set(key, Number(row.lastValue ?? 0));
            return { onConflictDoNothing: () => Promise.resolve() };
          }
          return Promise.resolve();
        },
      };
    },
    update(table: { __name: string }) {
      return {
        set(patch: Record<string, unknown>) {
          return {
            where(_cond: unknown) {
              if (table.__name === "operationalOrders") {
                for (const o of orders.values()) {
                  if (!o.linkedWorkItemId) {
                    Object.assign(o, {
                      product: patch.product ?? o.product,
                      client: patch.client ?? o.client,
                      lot: patch.lot ?? o.lot,
                      code: patch.code ?? o.code,
                      formData: patch.formData ?? o.formData,
                      version: o.version + 1,
                    });
                  }
                }
              }
              return Promise.resolve();
            },
          };
        },
      };
    },
  };

  return { tx, orders, templates, audits, versions, sequences };
}

vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual<typeof import("drizzle-orm")>("drizzle-orm");
  return {
    ...actual,
    eq: (col: { name?: string } | string, val: string) => ({
      __eq: [
        typeof col === "string" ? col : ((col as { name?: string }).name ?? "orderNumber"),
        val,
      ],
    }),
    and: (...args: unknown[]) => args,
    sql: actual.sql,
  };
});

vi.mock("@/lib/db/schema", () => {
  const table = (name: string) => ({
    __name: name,
    id: { name: "id" },
    orderNumber: { name: "orderNumber" },
    assignedSector: { name: "assignedSector" },
    linkedWorkItemId: { name: "linkedWorkItemId" },
    type: { name: "type" },
    product: { name: "product" },
    client: { name: "client" },
    lot: { name: "lot" },
    code: { name: "code" },
    formData: { name: "formData" },
    status: { name: "status" },
    version: { name: "version" },
    lastValue: { name: "lastValue" },
    year: { name: "year" },
  });
  return {
    operationalOrders: table("operationalOrders"),
    orderTemplates: table("orderTemplates"),
    orderVersions: table("orderVersions"),
    orderAuditEvents: table("orderAuditEvents"),
    orderNumberSequences: table("orderNumberSequences"),
  };
});

describe("ensureOaForAssignment — 1 trabajo = 1 OA", () => {
  let ensureOaForAssignment: typeof import("@/lib/planning/ensure-oa-on-assign").ensureOaForAssignment;

  beforeEach(async () => {
    vi.resetModules();
    ({ ensureOaForAssignment } = await import("@/lib/planning/ensure-oa-on-assign"));
  });

  const baseInput = {
    orderNumberRaw: " oa-2026-000145 ",
    sector: "ENVASADO_MASIVO" as const,
    product: "Crema facial",
    client: "Cliente Genus",
    lot: "L-900",
    vto: "2027-06-01",
    code: "CF-01",
    quantity: "1200",
    notes: "Asignado desde producción",
    assignmentDate: "2026-08-06",
    forceLink: false,
    actorEmail: "produccion@laboratoriogenus.com.ar",
    actorSector: "PRODUCCION",
  };

  it("crea OA inexistente con número exacto y precarga datos", async () => {
    const { tx, orders } = createFakeDb();
    const result = await ensureOaForAssignment(tx, baseInput);
    expect(result.created).toBe(true);
    expect(result.orderNumber).toBe("OA-2026-000145");
    const oa = [...orders.values()][0]!;
    expect(oa.product).toBe("Crema facial");
    expect(oa.client).toBe("Cliente Genus");
    expect(oa.lot).toBe("L-900");
    expect(oa.status).toBe("BORRADOR");
    const fd = oa.formData as { header: { vto: string; productCode: string } };
    expect(fd.header.vto).toBe("2027-06-01");
    expect(fd.header.productCode).toBe("CF-01");
  });

  it("crea OA para Premium y Codificado", async () => {
    const a = createFakeDb();
    const r1 = await ensureOaForAssignment(a.tx, {
      ...baseInput,
      sector: "ENVASADO_PREMIUM",
      orderNumberRaw: "OA-2026-000200",
    });
    expect(r1.assignedSector).toBe("ENVASADO_PREMIUM");

    const b = createFakeDb();
    const r2 = await ensureOaForAssignment(b.tx, {
      ...baseInput,
      sector: "CODIFICADO",
      orderNumberRaw: "OA-2026-000300",
    });
    expect(r2.assignedSector).toBe("CODIFICADO");
  });

  it("vincula OA existente sin duplicar (misma asignación)", async () => {
    const { tx, orders } = createFakeDb();
    await ensureOaForAssignment(tx, baseInput);
    const second = await ensureOaForAssignment(tx, baseInput);
    expect(second.created).toBe(false);
    expect(second.linked).toBe(true);
    expect(orders.size).toBe(1);
  });

  it("rechaza reutilizar OA ya vinculada a otro trabajo", async () => {
    const { tx, orders } = createFakeDb();
    await ensureOaForAssignment(tx, baseInput);
    const oa = [...orders.values()][0]!;
    oa.linkedWorkItemId = "work-other-already-linked";
    await expect(ensureOaForAssignment(tx, baseInput)).rejects.toMatchObject({
      name: "PlanningConflictError",
      code: "VERSION_CONFLICT",
    });
  });

  it("otra asignación con otro número crea su propia OA", async () => {
    const { tx, orders } = createFakeDb();
    await ensureOaForAssignment(tx, baseInput);
    await ensureOaForAssignment(tx, {
      ...baseInput,
      orderNumberRaw: "OA-2026-000146",
      lot: "L-901",
    });
    expect(orders.size).toBe(2);
    expect([...orders.values()].map((o) => o.orderNumber).sort()).toEqual([
      "OA-2026-000145",
      "OA-2026-000146",
    ]);
  });

  it("conflicto de datos + force solo rellena vacíos", async () => {
    const { tx, orders } = createFakeDb();
    await ensureOaForAssignment(tx, baseInput);
    await expect(
      ensureOaForAssignment(tx, { ...baseInput, lot: "L-OTRO" })
    ).rejects.toMatchObject({ code: "OA_DATA_MISMATCH" });

    const oa = [...orders.values()][0]!;
    oa.client = "";
    oa.formData = {
      kind: "OA",
      header: {
        productName: oa.product,
        client: "",
        lot: oa.lot,
        vto: "2027-06-01",
        productCode: oa.code,
        analisis: "",
        aprobo: "",
        fechaEmision: "",
      },
    };

    const forced = await ensureOaForAssignment(tx, {
      ...baseInput,
      lot: "L-OTRO",
      client: "Cliente Nuevo",
      forceLink: true,
    });
    expect(forced.filledEmptyFields).toContain("client");
    expect([...orders.values()][0]!.lot).toBe("L-900");
    expect([...orders.values()][0]!.client).toBe("Cliente Nuevo");
  });

  it("doble ensure del mismo número no duplica (idempotencia de fila OA)", async () => {
    const { tx, orders } = createFakeDb();
    const a = await ensureOaForAssignment(tx, baseInput);
    const b = await ensureOaForAssignment(tx, baseInput);
    expect(a.id).toBe(b.id);
    expect(orders.size).toBe(1);
  });
});
