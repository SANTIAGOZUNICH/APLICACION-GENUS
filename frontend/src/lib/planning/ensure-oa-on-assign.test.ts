import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests del flujo ensure-OA con un fake tx que simula Neon.
 * Cubren create/link/compat/force sin depender de DATABASE_URL, y la regla
 * de negocio 1 trabajo = 1 OA (rechazo de reutilización + no interferencia
 * entre números de OA distintos).
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

/** Condición del fake — `and(...)` produce un array; `eq`/`isNull` producen un marcador introspectable. */
function matchCond(row: Record<string, unknown>, cond: unknown): boolean {
  if (!cond) return true;
  if (Array.isArray(cond)) return cond.every((c) => matchCond(row, c));
  const c = cond as { __eq?: [string, unknown]; __isNull?: string };
  if (c.__eq) return row[c.__eq[0]] === c.__eq[1];
  if (c.__isNull) return row[c.__isNull] == null;
  // Predicado SQL crudo no introspectable en el fake — se trata como cierto
  // (permisivo, nunca filtra de más).
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
    _templates: templates,
    _audits: audits,
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
            return {
              onConflictDoNothing: () => Promise.resolve(),
            };
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

// Drizzle eq/isNull stubs used by ensure module — we intercept by monkey-patching modules.
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
      pedidoId: { name: "pedidoId" },
      productIdentityKey: { name: "productIdentityKey" },
      loteIdentityKey: { name: "loteIdentityKey" },
      deletedAt: { name: "deletedAt" },
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

describe("ensureOaForAssignment — 1 trabajo = 1 OA (fake tx)", () => {
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

  it("6) vincula OA existente sin duplicarla (misma asignación)", async () => {
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

  it("rechaza reutilizar OA ya vinculada a otro trabajo (1 trabajo = 1 OA)", async () => {
    const { tx, orders } = createFakeDb();
    await ensureOaForAssignment(tx, baseInput);
    const oa = [...orders.values()][0]!;
    oa.linkedWorkItemId = "work-other-already-linked";
    await expect(ensureOaForAssignment(tx, baseInput)).rejects.toMatchObject({
      name: "PlanningConflictError",
      code: "VERSION_CONFLICT",
    });
  });

  it("otra asignación con otro número de OA crea su propia OA (no interfiere)", async () => {
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

/**
 * Identidad funcional PEDIDO + PRODUCTO + LOTE — GENUS OS "corregir
 * duplicación de OA/OE al asignar trabajo". Reuso SIEMPRE (aunque la OA ya
 * tenga otro trabajo vinculado) cuando pedidoId+productIdentityKey+
 * loteIdentityKey coinciden — nunca por número visible.
 */
describe("ensureOaForAssignment — identidad PEDIDO+PRODUCTO+LOTE (reuso entre WorkItems)", () => {
  let ensureOaForAssignment: typeof import("@/lib/planning/ensure-oa-on-assign").ensureOaForAssignment;

  beforeEach(async () => {
    vi.resetModules();
    ({ ensureOaForAssignment } = await import("@/lib/planning/ensure-oa-on-assign"));
  });

  const identityInput = {
    orderNumberRaw: "OA-2026-004521",
    sector: "ENVASADO_MASIVO" as const,
    product: "SERUM VITAMINA C ROSEHIP",
    client: "ECODERM",
    lot: "S26018",
    vto: "2028-12-31",
    code: "",
    quantity: "300",
    notes: null,
    assignmentDate: "2026-09-14",
    forceLink: false,
    actorEmail: "produccion@laboratoriogenus.com.ar",
    actorSector: "PRODUCCION",
    pedidoId: "pedido-P-123",
    productIdentityKey: "serum vitamina c rosehip",
    loteIdentityKey: "AL:al-s26018",
  };

  it("1/2) mismo Pedido+Producto+Lote en días distintos (WorkItems distintos) reutiliza la MISMA OA, ya vinculada", async () => {
    const { tx, orders } = createFakeDb();
    const monday = await ensureOaForAssignment(tx, identityInput);
    expect(monday.created).toBe(true);
    // Simula que Lunes ya quedó vinculada a un WorkItem real (lo hace
    // work-assignment-service.ts después del insert; acá se simula directo).
    orders.get(monday.id)!.linkedWorkItemId = "wi-lunes";

    const tuesday = await ensureOaForAssignment(tx, {
      ...identityInput,
      orderNumberRaw: "OA-2026-999999", // número distinto: la identidad manda, no el número escrito
    });
    expect(tuesday.created).toBe(false);
    expect(tuesday.reusedByIdentity).toBe(true);
    expect(tuesday.id).toBe(monday.id);
    expect(tuesday.orderNumber).toBe("OA-2026-004521"); // conserva el número real, nunca crea OA-2026-999999
    expect(orders.size).toBe(1);

    // Tercer WorkItem (miércoles) — sigue siendo la misma OA.
    const wednesday = await ensureOaForAssignment(tx, identityInput);
    expect(wednesday.id).toBe(monday.id);
    expect(orders.size).toBe(1);
  });

  it("3) distinta cantidad en cada asignación -> sigue siendo la MISMA OA (cantidad no es parte de la identidad)", async () => {
    const { tx, orders } = createFakeDb();
    const first = await ensureOaForAssignment(tx, { ...identityInput, quantity: "300" });
    orders.get(first.id)!.linkedWorkItemId = "wi-1";
    const second = await ensureOaForAssignment(tx, { ...identityInput, quantity: "200" });
    expect(second.id).toBe(first.id);
    expect(orders.size).toBe(1);
  });

  it("4) asignación 'concurrente' (otra transacción ya insertó la identidad) no duplica ni falla — se reusa", async () => {
    const { tx, orders } = createFakeDb();
    // Simula que otra transacción ganó la carrera: inserta la OA con la
    // misma identidad ANTES de que este ensure intente crear la suya.
    const race = await ensureOaForAssignment(tx, identityInput);
    expect(orders.size).toBe(1);
    // Este segundo llamado, con un número DISTINTO, debe recuperar la
    // misma OA por identidad en vez de fallar por unique violation.
    const second = await ensureOaForAssignment(tx, {
      ...identityInput,
      orderNumberRaw: "OA-2026-111111",
    });
    expect(second.id).toBe(race.id);
    expect(second.reusedByIdentity).toBe(true);
    expect(orders.size).toBe(1);
  });

  it("5) reintento con los mismos datos exactos no duplica (idempotencia)", async () => {
    const { tx, orders } = createFakeDb();
    const a = await ensureOaForAssignment(tx, identityInput);
    const b = await ensureOaForAssignment(tx, identityInput);
    expect(a.id).toBe(b.id);
    expect(orders.size).toBe(1);
  });

  it("6) mismo Pedido+Producto pero OTRO lote -> crea una OA NUEVA (no reutiliza)", async () => {
    const { tx, orders } = createFakeDb();
    const first = await ensureOaForAssignment(tx, identityInput);
    const second = await ensureOaForAssignment(tx, {
      ...identityInput,
      orderNumberRaw: "OA-2026-004522",
      lot: "S26045",
      loteIdentityKey: "AL:al-s26045",
    });
    expect(second.id).not.toBe(first.id);
    expect(orders.size).toBe(2);
  });

  it("7) mismo Producto+Lote pero OTRO Pedido -> crea una OA NUEVA (la identidad exige pedido)", async () => {
    const { tx, orders } = createFakeDb();
    const first = await ensureOaForAssignment(tx, identityInput);
    const second = await ensureOaForAssignment(tx, {
      ...identityInput,
      orderNumberRaw: "OA-2026-004523",
      pedidoId: "pedido-P-999",
    });
    expect(second.id).not.toBe(first.id);
    expect(orders.size).toBe(2);
  });

  it("8) producto con texto levemente distinto pero misma clave canónica (código) -> no duplica", async () => {
    const { tx, orders } = createFakeDb();
    const first = await ensureOaForAssignment(tx, {
      ...identityInput,
      product: "SERUM VITAMINA C ROSEHIP",
      productIdentityKey: "CODE:vit-c",
    });
    orders.get(first.id)!.linkedWorkItemId = "wi-1";
    const second = await ensureOaForAssignment(tx, {
      ...identityInput,
      orderNumberRaw: "OA-2026-777777",
      product: "SERUM / VITAMINA C / ROSEHIP", // texto distinto, MISMO código canónico
      productIdentityKey: "CODE:vit-c",
    });
    expect(second.id).toBe(first.id);
    expect(orders.size).toBe(1);
  });

  it("9) sin lote (SIN_LOTE) -> una única OA provisional reutilizable, no una por WorkItem", async () => {
    const { tx, orders } = createFakeDb();
    const first = await ensureOaForAssignment(tx, { ...identityInput, lot: "", loteIdentityKey: null });
    orders.get(first.id)!.linkedWorkItemId = "wi-1";
    const second = await ensureOaForAssignment(tx, {
      ...identityInput,
      orderNumberRaw: "OA-2026-888888",
      lot: "",
      loteIdentityKey: null,
    });
    expect(second.id).toBe(first.id);
    expect(second.reusedByIdentity).toBe(true);
    expect(orders.size).toBe(1);
  });

  it("10) lote agregado en una asignación posterior del mismo Pedido+Producto: NUNCA fusiona en silencio la OA sin lote — crea una nueva por identidad", async () => {
    const { tx, orders } = createFakeDb();
    const sinLote = await ensureOaForAssignment(tx, {
      ...identityInput,
      orderNumberRaw: "OA-2026-004520",
      lot: "",
      loteIdentityKey: null,
    });
    orders.get(sinLote.id)!.linkedWorkItemId = "wi-1";
    const conLote = await ensureOaForAssignment(tx, {
      ...identityInput,
      orderNumberRaw: "OA-2026-004521",
    });
    expect(conLote.id).not.toBe(sinLote.id);
    expect(orders.size).toBe(2);
    // La OA sin lote sigue existiendo intacta (nunca se borra/reemplaza).
    expect(orders.get(sinLote.id)!.loteIdentityKey).toBeNull();
  });

  it("17) reusar por identidad nunca borra ni reemplaza la OA existente — mismo id, misma OA física", async () => {
    const { tx, orders } = createFakeDb();
    const first = await ensureOaForAssignment(tx, identityInput);
    orders.get(first.id)!.linkedWorkItemId = "wi-1";
    const before = orders.size;
    await ensureOaForAssignment(tx, { ...identityInput, orderNumberRaw: "OA-2026-333333" });
    expect(orders.size).toBe(before);
    expect(orders.has(first.id)).toBe(true);
  });

  it("sin identidad (legacy, sin Pedido vinculado) mantiene la regla estricta 1 trabajo = 1 OA", async () => {
    const { tx, orders } = createFakeDb();
    const legacyInput = {
      ...identityInput,
      pedidoId: null,
      productIdentityKey: null,
      loteIdentityKey: null,
    };
    const first = await ensureOaForAssignment(tx, legacyInput);
    orders.get(first.id)!.linkedWorkItemId = "wi-1";
    await expect(ensureOaForAssignment(tx, legacyInput)).rejects.toMatchObject({
      name: "PlanningConflictError",
    });
  });
});
