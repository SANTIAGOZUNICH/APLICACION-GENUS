import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests del flujo ensure-OE con un fake tx que simula Neon — mismo patrón
 * que ensure-oa-on-assign.test.ts (OE comparte exactamente la misma
 * semántica de identidad/reuso que OA, ver ensure-oe-on-assign.ts).
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
  pedidoId: string | null;
  productIdentityKey: string | null;
  loteIdentityKey: string | null;
  deletedAt: Date | null;
};

function matchCond(row: Record<string, unknown>, cond: unknown): boolean {
  if (!cond) return true;
  if (Array.isArray(cond)) return cond.every((c) => matchCond(row, c));
  const c = cond as { __eq?: [string, unknown]; __isNull?: string };
  if (c.__eq) return row[c.__eq[0]] === c.__eq[1];
  if (c.__isNull) return row[c.__isNull] == null;
  return true;
}

function createFakeDb() {
  const orders = new Map<string, FakeOrder>();
  const templates: unknown[] = [];
  const audits: unknown[] = [];
  const versions: unknown[] = [];
  const sequences = new Map<string, number>();

  const tx = {
    _orders: orders,
    select(_cols?: unknown) {
      let cond: unknown = null;
      const api = {
        from(_table: unknown) {
          return api;
        },
        where(c: unknown) {
          cond = c;
          return api;
        },
        limit(n: number) {
          return [...orders.values()].filter((o) => matchCond(o, cond)).slice(0, n);
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
            return { onConflictDoNothing: () => Promise.resolve() };
          }
          if (table.__name === "operationalOrders") {
            const num = String(row.orderNumber);
            const pedidoId = (row.pedidoId as string | null) ?? null;
            const productIdentityKey = (row.productIdentityKey as string | null) ?? null;
            const loteIdentityKey = (row.loteIdentityKey as string | null) ?? null;
            const type = row.type as "OA" | "OE";
            const numberTaken = [...orders.values()].some((o) => o.orderNumber === num);
            const identityTaken =
              pedidoId != null &&
              productIdentityKey != null &&
              [...orders.values()].some(
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
            const o: FakeOrder = {
              id: String(row.id),
              orderNumber: num,
              type,
              assignedSector: String(row.assignedSector),
              linkedWorkItemId: (row.linkedWorkItemId as string | null) ?? null,
              product: String(row.product ?? ""),
              client: String(row.client ?? ""),
              lot: String(row.lot ?? ""),
              code: String(row.code ?? ""),
              formData: row.formData,
              status: String(row.status),
              version: Number(row.version ?? 1),
              pedidoId,
              productIdentityKey,
              loteIdentityKey,
              deletedAt: null,
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
            where(cond: unknown) {
              if (table.__name === "operationalOrders") {
                for (const o of orders.values()) {
                  if (!matchCond(o, cond)) continue;
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
      __eq: [typeof col === "string" ? col : (col as { name?: string }).name ?? "orderNumber", val],
    }),
    isNull: (col: { name?: string } | string) => ({
      __isNull: typeof col === "string" ? col : (col as { name?: string }).name ?? "",
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
    pedidoId: { name: "pedidoId" },
    productIdentityKey: { name: "productIdentityKey" },
    loteIdentityKey: { name: "loteIdentityKey" },
    deletedAt: { name: "deletedAt" },
  });
  return {
    operationalOrders: table("operationalOrders"),
    orderTemplates: table("orderTemplates"),
    orderVersions: table("orderVersions"),
    orderAuditEvents: table("orderAuditEvents"),
    orderNumberSequences: table("orderNumberSequences"),
  };
});

describe("ensureOeForAssignment — identidad PEDIDO+PRODUCTO+LOTE (18: misma semántica que OA)", () => {
  let ensureOeForAssignment: typeof import("@/lib/planning/ensure-oe-on-assign").ensureOeForAssignment;

  beforeEach(async () => {
    vi.resetModules();
    ({ ensureOeForAssignment } = await import("@/lib/planning/ensure-oe-on-assign"));
  });

  const identityInput = {
    orderNumberRaw: "OE-2026-004521",
    sector: "ELABORACION" as const,
    product: "GRANEL SERUM VITAMINA C",
    client: "ECODERM",
    lot: "S26018",
    code: "",
    quantity: "50",
    notes: null,
    assignmentDate: "2026-09-14",
    forceLink: false,
    actorEmail: "produccion@laboratoriogenus.com.ar",
    actorSector: "PRODUCCION",
    pedidoId: "pedido-P-123",
    productIdentityKey: "granel serum vitamina c",
    loteIdentityKey: "AL:al-s26018",
  };

  it("crea OE inexistente con la identidad guardada", async () => {
    const { tx, orders } = createFakeDb();
    const result = await ensureOeForAssignment(tx, identityInput);
    expect(result.created).toBe(true);
    expect(orders.get(result.id)!.pedidoId).toBe("pedido-P-123");
  });

  it("mismo Pedido+Producto+Lote en WorkItems distintos reutiliza la MISMA OE, ya vinculada a otro trabajo", async () => {
    const { tx, orders } = createFakeDb();
    const first = await ensureOeForAssignment(tx, identityInput);
    orders.get(first.id)!.linkedWorkItemId = "wi-lunes";
    const second = await ensureOeForAssignment(tx, {
      ...identityInput,
      orderNumberRaw: "OE-2026-999999",
    });
    expect(second.id).toBe(first.id);
    expect(second.reusedByIdentity).toBe(true);
    expect(orders.size).toBe(1);
  });

  it("otro lote -> nueva OE (no reutiliza)", async () => {
    const { tx, orders } = createFakeDb();
    const first = await ensureOeForAssignment(tx, identityInput);
    const second = await ensureOeForAssignment(tx, {
      ...identityInput,
      orderNumberRaw: "OE-2026-004522",
      lot: "S26045",
      loteIdentityKey: "AL:al-s26045",
    });
    expect(second.id).not.toBe(first.id);
    expect(orders.size).toBe(2);
  });

  it("sin lote (SIN_LOTE) reutiliza una única OE provisional", async () => {
    const { tx, orders } = createFakeDb();
    const first = await ensureOeForAssignment(tx, { ...identityInput, lot: "", loteIdentityKey: null });
    orders.get(first.id)!.linkedWorkItemId = "wi-1";
    const second = await ensureOeForAssignment(tx, {
      ...identityInput,
      orderNumberRaw: "OE-2026-888888",
      lot: "",
      loteIdentityKey: null,
    });
    expect(second.id).toBe(first.id);
    expect(orders.size).toBe(1);
  });

  it("carrera concurrente: se recupera por identidad en vez de fallar", async () => {
    const { tx, orders } = createFakeDb();
    const race = await ensureOeForAssignment(tx, identityInput);
    const second = await ensureOeForAssignment(tx, {
      ...identityInput,
      orderNumberRaw: "OE-2026-111111",
    });
    expect(second.id).toBe(race.id);
    expect(orders.size).toBe(1);
  });

  it("sin identidad (legacy) mantiene 1 trabajo = 1 OE", async () => {
    const { tx, orders } = createFakeDb();
    const legacy = { ...identityInput, pedidoId: null, productIdentityKey: null, loteIdentityKey: null };
    const first = await ensureOeForAssignment(tx, legacy);
    orders.get(first.id)!.linkedWorkItemId = "wi-1";
    await expect(ensureOeForAssignment(tx, legacy)).rejects.toMatchObject({
      name: "PlanningConflictError",
    });
  });
});
