import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * DECISIÓN_FUNCIONAL (PR #81, segunda vuelta) — Envasado/Codificado pueden
 * completar Lote/VTO cuando Producción los dejó vacíos, pero NUNCA
 * sobreescribir un valor ya cargado. El punto de entrada principal es
 * "Guardar avance" (saveWorkProgressDurable, ver work-item-progress-
 * repository.test.ts), pero handoffToCodificadoDurable/
 * deliverFromCodificadoDurable también aceptan packagingLote/packagingVto
 * como defensa en profundidad para el caso "Codificado tipea el dato y
 * entrega sin pasar por 'Guardar avance' antes" — este archivo prueba esa
 * lógica de "fill-once" específicamente, con un fake tx (mismo patrón que
 * work-assignment-service.test.ts: productionPedidoId queda en null en
 * todas las filas, así que touchPedidoEnEnvasado/touchPedidoListoParaEntregar
 * hacen return temprano y no hace falta simular production_pedidos).
 */

type FakeRow = Record<string, unknown> & { id: string };

function createFakeDb() {
  const workItems = new Map<string, FakeRow>();
  const workItemDeliveries = new Map<string, FakeRow>();
  const workItemDeliveryLines = new Map<string, FakeRow>();
  const productionPedidos = new Map<string, FakeRow>();
  const operationalEvents: Record<string, unknown>[] = [];

  function matchCond(row: Record<string, unknown>, cond: unknown): boolean {
    if (!cond) return true;
    if (Array.isArray(cond)) return cond.every((c) => matchCond(row, c));
    const c = cond as { __eq?: [string, unknown] };
    if (c.__eq) return row[c.__eq[0]] === c.__eq[1];
    // Predicado SQL crudo (ej. deleted_at IS NULL) — no introspectable en el
    // fake; ninguna fila de estos tests depende de esa rama.
    return true;
  }

  function tableFor(name: string): Map<string, FakeRow> | null {
    if (name === "workItems") return workItems;
    if (name === "workItemDeliveries") return workItemDeliveries;
    if (name === "workItemDeliveryLines") return workItemDeliveryLines;
    if (name === "productionPedidos") return productionPedidos;
    return null;
  }

  const tx = {
    select() {
      let target: Record<string, unknown>[] = [];
      let cond: unknown = null;
      const api = {
        from(t: { __name: string }) {
          target =
            t.__name === "operationalEvents"
              ? [...operationalEvents]
              : tableFor(t.__name)
                ? [...tableFor(t.__name)!.values()]
                : [];
          return api;
        },
        where(c: unknown) {
          cond = c;
          return api;
        },
        for() {
          return api;
        },
        orderBy() {
          return api;
        },
        then(resolve: (v: Record<string, unknown>[]) => unknown) {
          return Promise.resolve(resolve(target.filter((r) => matchCond(r, cond)).map((r) => ({ ...r }))));
        },
        limit(n: number) {
          return Promise.resolve(
            target
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
              if (target) {
                for (const row of target.values()) {
                  if (matchCond(row, cond)) {
                    Object.assign(row, patch);
                    updated.push({ ...row });
                  }
                }
              }
              return { returning: () => Promise.resolve(updated) };
            },
          };
        },
      };
    },
    insert(t: { __name: string }) {
      return {
        values(row: Record<string, unknown>) {
          if (t.__name === "operationalEvents" || t.__name === "productionPedidoStatusEvents") {
            operationalEvents.push(row);
            return Promise.resolve();
          }
          const target = tableFor(t.__name);
          if (!target) return Promise.resolve();
          const id = (row.id as string | undefined) ?? `${t.__name}-${target.size + 1}`;
          const stored = { ...row, id };
          target.set(id, stored);
          return {
            returning: () => Promise.resolve([{ ...stored }]),
            then: (resolve: (v: undefined) => unknown) => Promise.resolve(resolve(undefined)),
          };
        },
      };
    },
    transaction(fn: (tx: unknown) => unknown) {
      return fn(tx);
    },
  };

  return { tx, workItems, workItemDeliveries, workItemDeliveryLines, productionPedidos, operationalEvents };
}

let fakeDbHandle: ReturnType<typeof createFakeDb>;

vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual<typeof import("drizzle-orm")>("drizzle-orm");
  return {
    ...actual,
    eq: (col: { name?: string } | string, val: unknown) => ({
      __eq: [typeof col === "string" ? col : ((col as { name?: string }).name ?? "id"), val],
    }),
    and: (...args: unknown[]) => args,
    or: (...args: unknown[]) => args,
    sql: actual.sql,
  };
});

vi.mock("@/lib/db/client", () => ({
  getDb: () => ({ transaction: (fn: (tx: unknown) => unknown) => fn(fakeDbHandle.tx) }),
}));

vi.mock("@/lib/db/schema", () => {
  const workItemCols = [
    "id",
    "status",
    "sector",
    "line",
    "branchOwner",
    "homeLine",
    "homeBranchOwner",
    "viaCodificado",
    "codificadoOriginSector",
    "sentToCodificadoAt",
    "sentToCodificadoBy",
    "codificadoCancelledAt",
    "codificadoCancelledBy",
    "codificadoCancelReason",
    "codificadoRevision",
    "codificadoObservation",
    "deliveredFromCodificadoAt",
    "deliveredFromCodificadoBy",
    "packagingLote",
    "packagingVto",
    "packagingTotalUnits",
    "packingGroups",
    "packingMismatchObservation",
    "sampleUnits",
    "deliverableUnits",
    "packagingClosedAt",
    "packagingClosedBy",
    "bulkRemainderKg",
    "bulkRemainderObservation",
    "bulkRemainderId",
    "operationalStatus",
    "finishedQty",
    "operationalObservation",
    "reworkRequestedAt",
    "reworkRequestedBy",
    "reworkRequestedBySector",
    "reworkReason",
    "completedAt",
    "completedBy",
    "productionPedidoId",
    "scheduleRootId",
    "orderId",
    "planningWeekId",
    "version",
    "deletedAt",
  ];
  const eventCols = ["workItemId", "type", "note", "actorEmail", "actorSector"];
  const table = (name: string, cols: string[]) => {
    const t: Record<string, unknown> = { __name: name };
    for (const c of cols) t[c] = { name: c };
    return t;
  };
  return {
    workItems: table("workItems", workItemCols),
    operationalEvents: table("operationalEvents", eventCols),
    productionPedidos: table("productionPedidos", ["id", "estado", "deletedAt", "op"]),
    productionPedidoStatusEvents: table("productionPedidoStatusEvents", []),
    workItemDeliveries: table("workItemDeliveries", ["id", "workItemId", "status", "archived", "deliveryComplete"]),
    workItemDeliveryLines: table("workItemDeliveryLines", ["id", "workItemId", "deliveryId", "idempotencyKey", "status", "quantity"]),
  };
});

describe("handoffToCodificadoDurable — Lote/VTO fill-once", () => {
  let handoffToCodificadoDurable: typeof import("./codificado-handoff-service").handoffToCodificadoDurable;

  const actor = { email: "envasado@laboratoriogenus.com.ar", displayName: "Envasado", sector: "ENVASADO_MASIVO" };

  beforeEach(async () => {
    vi.resetModules();
    vi.doMock("@/lib/planning/circuit/circuit-notifications", () => ({ emitCircuitNotification: vi.fn() }));
    fakeDbHandle = createFakeDb();
    ({ handoffToCodificadoDurable } = await import("./codificado-handoff-service"));
    fakeDbHandle.workItems.set("wi-handoff", {
      id: "wi-handoff",
      status: "PUBLICADO",
      sector: "ENVASADO_MASIVO",
      plannedDate: "2026-08-03",
      plannedDateTo: null,
      client: "Cliente Test",
      product: "Producto Test",
      plannedQuantity: "100",
      unit: "un.",
      priority: "NORMAL",
      notes: null,
      publishedAt: new Date("2026-08-03T12:00:00.000Z"),
      createdBy: "produccion@laboratoriogenus.com.ar",
      source: "native",
      originRef: null,
      orderId: null,
      orderNumber: null,
      deliveryDate: null,
      createdAt: new Date("2026-08-03T12:00:00.000Z"),
      updatedAt: new Date("2026-08-03T12:00:00.000Z"),
      line: "Línea 1",
      branchOwner: null,
      homeLine: null,
      homeBranchOwner: null,
      viaCodificado: false,
      codificadoOriginSector: null,
      sentToCodificadoAt: null,
      codificadoCancelledAt: null,
      codificadoRevision: 0,
      codificadoObservation: null,
      deliveredFromCodificadoAt: null,
      packagingLote: null,
      packagingVto: null,
      packagingTotalUnits: null,
      packingGroups: [{ cajas: 1, unidadesPorCaja: 100 }],
      packingMismatchObservation: null,
      sampleUnits: null,
      deliverableUnits: null,
      packagingClosedAt: null,
      packagingClosedBy: null,
      bulkRemainderKg: null,
      bulkRemainderObservation: null,
      bulkRemainderId: null,
      productionPedidoId: null,
      planningWeekId: "week-1",
      version: 1,
    });
  });

  it("B) Producción dejó Lote/VTO vacíos — Envasado los completa al enviar a Codificado, y quedan persistidos en el MISMO work item", async () => {
    const result = await handoffToCodificadoDurable(
      {
        workItemId: "wi-handoff",
        totalUnits: 100,
        packagingLote: "L26099",
        packagingVto: "2028-08",
        idempotencyKey: "test-handoff-b-001",
      },
      actor
    );
    expect(result.item.packagingLote).toBe("L26099");
    expect(result.item.packagingVto).toBe("2028-08");

    // Segunda lectura real — independiente del valor de retorno de la transacción.
    const persisted = fakeDbHandle.workItems.get("wi-handoff")!;
    expect(persisted.packagingLote).toBe("L26099");
    expect(persisted.packagingVto).toBe("2028-08");

    const filledEvent = fakeDbHandle.operationalEvents.find((e) => e.type === "LOTE_VTO_FILLED");
    expect(filledEvent).toBeTruthy();
    expect(JSON.parse(filledEvent!.toStatus as string)).toMatchObject({
      lote: "L26099",
      vto: "2028-08",
    });
  });

  it("A) Producción ya cargó Lote/VTO — el handoff NUNCA los sobreescribe, aunque el cliente mande otro valor", async () => {
    fakeDbHandle.workItems.get("wi-handoff")!.packagingLote = "L26099";
    fakeDbHandle.workItems.get("wi-handoff")!.packagingVto = "2028-08";

    const result = await handoffToCodificadoDurable(
      {
        workItemId: "wi-handoff",
        totalUnits: 100,
        packagingLote: "L-OTRO-VALOR",
        packagingVto: "2030-01",
        idempotencyKey: "test-handoff-a-001",
      },
      actor
    );
    expect(result.item.packagingLote).toBe("L26099");
    expect(result.item.packagingVto).toBe("2028-08");
    expect(fakeDbHandle.workItems.get("wi-handoff")!.packagingLote).toBe("L26099");
    expect(fakeDbHandle.operationalEvents.some((e) => e.type === "LOTE_VTO_FILLED")).toBe(false);
  });

  it("2b) rechaza enviar a Codificado un trabajo ya ENTREGADO (no pisa el estado con el viejo)", async () => {
    fakeDbHandle.workItems.get("wi-handoff")!.operationalStatus = "entregado";
    await expect(
      handoffToCodificadoDurable({ workItemId: "wi-handoff", totalUnits: 100, idempotencyKey: "test-handoff-edge-2b-001" }, actor)
    ).rejects.toMatchObject({ name: "PlanningValidationError", message: expect.stringMatching(/ya está entregado/) });
    expect(fakeDbHandle.workItems.get("wi-handoff")!.sector).toBe("ENVASADO_MASIVO");
  });

  it("2b') rechaza enviar si ya hay una entrega activa COMPLETA", async () => {
    fakeDbHandle.workItemDeliveries.set("dlv-1", {
      id: "dlv-1",
      workItemId: "wi-handoff",
      status: "ENTREGADO",
      archived: false,
      deliveryComplete: true,
    });
    await expect(
      handoffToCodificadoDurable({ workItemId: "wi-handoff", totalUnits: 100, idempotencyKey: "test-handoff-edge-2b2-001" }, actor)
    ).rejects.toMatchObject({ name: "PlanningValidationError", message: expect.stringMatching(/entrega completa/) });
  });

  it("2c) con una parcial ya entregada (30 de 100): un total menor a lo entregado se rechaza; uno igual o mayor se acepta", async () => {
    fakeDbHandle.workItemDeliveries.set("dlv-p", {
      id: "dlv-p",
      workItemId: "wi-handoff",
      status: "ENTREGADO",
      archived: false,
      deliveryComplete: false,
    });
    fakeDbHandle.workItemDeliveryLines.set("l-1", {
      id: "l-1",
      workItemId: "wi-handoff",
      deliveryId: "dlv-p",
      status: "ACTIVA",
      quantity: 30,
    });
    await expect(
      handoffToCodificadoDurable({ workItemId: "wi-handoff", totalUnits: 20, idempotencyKey: "test-handoff-edge-2c-a1" }, actor)
    ).rejects.toMatchObject({ name: "PlanningValidationError", message: expect.stringMatching(/menor a lo ya entregado/) });
    expect(fakeDbHandle.workItems.get("wi-handoff")!.sector).toBe("ENVASADO_MASIVO");

    const ok = await handoffToCodificadoDurable(
      { workItemId: "wi-handoff", totalUnits: 100, idempotencyKey: "test-handoff-edge-2c-b1" },
      actor
    );
    expect(ok.item.sector).toBe("CODIFICADO");
    expect(fakeDbHandle.workItems.get("wi-handoff")!.packagingTotalUnits).toBe(100);
  });

  it("F) cambio de estado sin mandar Lote/VTO — no los clobberea (quedan en null, no se inventan)", async () => {
    const result = await handoffToCodificadoDurable(
      { workItemId: "wi-handoff", totalUnits: 100, idempotencyKey: "test-handoff-f-001" },
      actor
    );
    expect(result.item.packagingLote).toBeNull();
    expect(result.item.packagingVto).toBeNull();
    expect(fakeDbHandle.operationalEvents.some((e) => e.type === "LOTE_VTO_FILLED")).toBe(false);
  });
});

describe("deliverFromCodificadoDurable — Lote/VTO fill-once", () => {
  let deliverFromCodificadoDurable: typeof import("./codificado-handoff-service").deliverFromCodificadoDurable;

  const actor = { email: "codificado@laboratoriogenus.com.ar", displayName: "Codificado", sector: "CODIFICADO" };

  beforeEach(async () => {
    vi.resetModules();
    vi.doMock("@/lib/planning/circuit/circuit-notifications", () => ({ emitCircuitNotification: vi.fn() }));
    fakeDbHandle = createFakeDb();
    ({ deliverFromCodificadoDurable } = await import("./codificado-handoff-service"));
    fakeDbHandle.workItems.set("wi-deliver", {
      id: "wi-deliver",
      status: "PUBLICADO",
      sector: "CODIFICADO",
      plannedDate: "2026-08-03",
      plannedDateTo: null,
      client: "Cliente Test",
      product: "Producto Test",
      plannedQuantity: "100",
      unit: "un.",
      priority: "NORMAL",
      notes: null,
      publishedAt: new Date("2026-08-03T12:00:00.000Z"),
      createdBy: "produccion@laboratoriogenus.com.ar",
      source: "native",
      originRef: null,
      orderId: null,
      orderNumber: null,
      deliveryDate: null,
      createdAt: new Date("2026-08-03T12:00:00.000Z"),
      updatedAt: new Date("2026-08-03T12:00:00.000Z"),
      line: null,
      branchOwner: null,
      homeLine: "Línea 2",
      homeBranchOwner: null,
      viaCodificado: true,
      codificadoOriginSector: "ENVASADO_PREMIUM",
      sentToCodificadoAt: new Date("2026-08-03T15:00:00.000Z"),
      codificadoCancelledAt: null,
      codificadoRevision: 1,
      codificadoObservation: null,
      deliveredFromCodificadoAt: null,
      packagingLote: null,
      packagingVto: null,
      packagingTotalUnits: 100,
      packingGroups: [{ cajas: 1, unidadesPorCaja: 100 }],
      packingMismatchObservation: null,
      sampleUnits: null,
      deliverableUnits: null,
      packagingClosedAt: null,
      packagingClosedBy: null,
      operationalStatus: "en_curso",
      finishedQty: "100",
      operationalObservation: null,
      reworkRequestedAt: null,
      reworkRequestedBy: null,
      reworkRequestedBySector: null,
      reworkReason: null,
      completedAt: null,
      completedBy: null,
      productionPedidoId: null,
      planningWeekId: "week-1",
      version: 1,
    });
  });

  it("C) Producción dejó Lote/VTO vacíos — Codificado los completa al entregar, y quedan persistidos en el MISMO work item", async () => {
    const result = await deliverFromCodificadoDurable(
      {
        workItemId: "wi-deliver",
        packagingLote: "L26099",
        packagingVto: "2028-08",
        idempotencyKey: "test-deliver-c-001",
      },
      actor
    );
    expect(result.item.packagingLote).toBe("L26099");
    expect(result.item.packagingVto).toBe("2028-08");

    const persisted = fakeDbHandle.workItems.get("wi-deliver")!;
    expect(persisted.packagingLote).toBe("L26099");
    expect(persisted.packagingVto).toBe("2028-08");

    const filledEvent = fakeDbHandle.operationalEvents.find((e) => e.type === "LOTE_VTO_FILLED");
    expect(filledEvent).toBeTruthy();
  });

  it("A) Producción ya cargó Lote/VTO — la entrega NUNCA los sobreescribe", async () => {
    fakeDbHandle.workItems.get("wi-deliver")!.packagingLote = "L26099";
    fakeDbHandle.workItems.get("wi-deliver")!.packagingVto = "2028-08";

    const result = await deliverFromCodificadoDurable(
      {
        workItemId: "wi-deliver",
        packagingLote: "L-OTRO-VALOR",
        packagingVto: "2030-01",
        idempotencyKey: "test-deliver-a-001",
      },
      actor
    );
    expect(result.item.packagingLote).toBe("L26099");
    expect(result.item.packagingVto).toBe("2028-08");
    expect(fakeDbHandle.operationalEvents.some((e) => e.type === "LOTE_VTO_FILLED")).toBe(false);
  });

  it("D) actualizar packingGroups en la entrega no borra un Lote/VTO ya cargado", async () => {
    fakeDbHandle.workItems.get("wi-deliver")!.packagingLote = "L26099";
    fakeDbHandle.workItems.get("wi-deliver")!.packagingVto = "2028-08";

    const result = await deliverFromCodificadoDurable(
      {
        workItemId: "wi-deliver",
        packingGroups: [{ cajas: 2, unidadesPorCaja: 50 }],
        idempotencyKey: "test-deliver-d-001",
      },
      actor
    );
    expect(result.item.packagingLote).toBe("L26099");
    expect(result.item.packagingVto).toBe("2028-08");
    expect(result.item.packingGroups).toEqual([{ cajas: 2, unidadesPorCaja: 50 }]);
  });
});
