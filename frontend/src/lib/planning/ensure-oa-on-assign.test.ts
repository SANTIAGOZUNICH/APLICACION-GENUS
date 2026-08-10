import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests del flujo ensure-OA con un fake tx que simula Neon.
 * Cubren create/link/compat/force sin depender de DATABASE_URL.
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
    _orders: orders,
    _templates: templates,
    _audits: audits,
    select(_cols?: unknown) {
      const state: {
        whereEq?: { col: string; val: string };
      } = {};
      const api = {
        from(_table: unknown) {
          return api;
        },
        where(cond: { __eq?: [string, string] }) {
          if (cond && cond.__eq) state.whereEq = { col: cond.__eq[0], val: cond.__eq[1] };
          return api;
        },
        limit(_n: number) {
          if (state.whereEq?.col === "orderNumber") {
            for (const o of orders.values()) {
              if (o.orderNumber === state.whereEq.val) return [o];
            }
          }
          if (state.whereEq?.col === "id") {
            const o = orders.get(state.whereEq.val);
            return o ? [o] : [];
          }
          return [];
        },
        then(resolve: (v: FakeOrder[]) => unknown) {
          return Promise.resolve(resolve(api.limit(1) as FakeOrder[]));
        },
      };
      return api;
    },
    insert(table: { __name: string }) {
      return {
        values(row: Record<string, unknown>) {
          if (table.__name === "orderTemplates") {
            templates.push(row);
            return {
              onConflictDoNothing: () => Promise.resolve(),
            };
          }
          if (table.__name === "operationalOrders") {
            const num = String(row.orderNumber);
            if ([...orders.values()].some((o) => o.orderNumber === num)) {
              return Promise.reject(new Error('duplicate key value violates unique constraint "operational_orders_number_uidx"'));
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
            return {
              onConflictDoNothing: () => Promise.resolve(),
            };
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
                // actualizar el único que no está linked en tests
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
              if (table.__name === "orderNumberSequences") {
                return Promise.resolve();
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

// Drizzle eq stub used by ensure module — we intercept by monkey-patching modules.
vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual<typeof import("drizzle-orm")>("drizzle-orm");
  return {
    ...actual,
    eq: (col: { name?: string } | string, val: string) => ({
      __eq: [typeof col === "string" ? col : (col as { name?: string }).name ?? "orderNumber", val],
    }),
    and: (...args: unknown[]) => args,
    sql: actual.sql,
  };
});

vi.mock("@/lib/db/schema", () => {
  const table = (name: string) => {
    const t = {
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
    };
    return t;
  };
  return {
    operationalOrders: table("operationalOrders"),
    orderTemplates: table("orderTemplates"),
    orderVersions: table("orderVersions"),
    orderAuditEvents: table("orderAuditEvents"),
    orderNumberSequences: table("orderNumberSequences"),
  };
});

describe("ensureOaForAssignment (fake tx)", () => {
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

  it("1) crea OA inexistente para Envasado Masivo con número exacto", async () => {
    const { tx, orders } = createFakeDb();
    const result = await ensureOaForAssignment(tx, baseInput);
    expect(result.created).toBe(true);
    expect(result.orderNumber).toBe("OA-2026-000145");
    expect(orders.size).toBe(1);
    const oa = [...orders.values()][0]!;
    expect(oa.product).toBe("Crema facial");
    expect(oa.client).toBe("Cliente Genus");
    expect(oa.lot).toBe("L-900");
    expect(oa.status).toBe("BORRADOR");
    expect(oa.assignedSector).toBe("ENVASADO_MASIVO");
  });

  it("2) crea OA para Envasado Premium", async () => {
    const { tx } = createFakeDb();
    const result = await ensureOaForAssignment(tx, {
      ...baseInput,
      sector: "ENVASADO_PREMIUM",
      orderNumberRaw: "OA-2026-000200",
    });
    expect(result.created).toBe(true);
    expect(result.orderNumber).toBe("OA-2026-000200");
    expect(result.assignedSector).toBe("ENVASADO_PREMIUM");
  });

  it("3) crea OA para Codificado", async () => {
    const { tx } = createFakeDb();
    const result = await ensureOaForAssignment(tx, {
      ...baseInput,
      sector: "CODIFICADO",
      orderNumberRaw: "OA-2026-000300",
    });
    expect(result.created).toBe(true);
    expect(result.assignedSector).toBe("CODIFICADO");
  });

  it("5) precarga producto, cliente, lote y VTO en formData", async () => {
    const { tx, orders } = createFakeDb();
    await ensureOaForAssignment(tx, baseInput);
    const oa = [...orders.values()][0]!;
    const fd = oa.formData as {
      kind: string;
      header: { productName: string; client: string; lot: string; vto: string; productCode: string };
    };
    expect(fd.kind).toBe("OA");
    expect(fd.header.productName).toBe("Crema facial");
    expect(fd.header.client).toBe("Cliente Genus");
    expect(fd.header.lot).toBe("L-900");
    expect(fd.header.vto).toBe("2027-06-01");
    expect(fd.header.productCode).toBe("CF-01");
  });

  it("6) vincula OA existente sin duplicarla", async () => {
    const { tx, orders } = createFakeDb();
    await ensureOaForAssignment(tx, baseInput);
    expect(orders.size).toBe(1);
    const second = await ensureOaForAssignment(tx, {
      ...baseInput,
      // mismos datos → link, sin create
      forceLink: false,
    });
    expect(second.created).toBe(false);
    expect(second.linked).toBe(true);
    expect(orders.size).toBe(1);
  });

  it("7/8) conflicto de lote incompatible; force rellena solo vacíos", async () => {
    const { tx, orders } = createFakeDb();
    await ensureOaForAssignment(tx, baseInput);
    await expect(
      ensureOaForAssignment(tx, {
        ...baseInput,
        lot: "L-OTRO",
        client: "Cliente Nuevo", // client ya estaba → no fill; lot mismatch
      })
    ).rejects.toMatchObject({ name: "PlanningOaCompatibilityError", code: "OA_DATA_MISMATCH" });

    // Vaciar client en OA existente y forzar con client nuevo + lote distinto
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

    await expect(
      ensureOaForAssignment(tx, {
        ...baseInput,
        lot: "L-OTRO",
        client: "Cliente Nuevo",
        forceLink: false,
      })
    ).rejects.toMatchObject({ name: "PlanningOaCompatibilityError", code: "OA_DATA_MISMATCH" });

    const forced = await ensureOaForAssignment(tx, {
      ...baseInput,
      lot: "L-OTRO",
      client: "Cliente Nuevo",
      forceLink: true,
    });
    expect(forced.created).toBe(false);
    expect(forced.filledEmptyFields).toContain("client");
    // lote existente no se sobrescribe
    expect([...orders.values()][0]!.lot).toBe("L-900");
    expect([...orders.values()][0]!.client).toBe("Cliente Nuevo");
  });

  it("rechaza número inválido", async () => {
    const { tx } = createFakeDb();
    await expect(
      ensureOaForAssignment(tx, { ...baseInput, orderNumberRaw: "NOPE" })
    ).rejects.toMatchObject({ name: "PlanningValidationError", code: "VALIDATION_ERROR" });
  });

  it("idempotencia lógica: segundo ensure del mismo número no duplica fila", async () => {
    const { tx, orders } = createFakeDb();
    const a = await ensureOaForAssignment(tx, baseInput);
    const b = await ensureOaForAssignment(tx, baseInput);
    expect(a.id).toBe(b.id);
    expect(orders.size).toBe(1);
  });
});
