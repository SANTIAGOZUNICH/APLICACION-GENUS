import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * AUDITORÍA DE INTEGRIDAD END-TO-END DEL WORK ITEM (informe: causa raíz en
 * deliverWorkDurable, ya corregida en work-item-progress-repository.ts).
 *
 * Round-trip completo de un MISMO work item real a través de TODO el flujo
 * (Producción → Envasado → Codificado → Calidad → Producción → Expedición →
 * Remito), orquestando las funciones durables reales (no reimplementadas
 * acá) con un fake tx compartido entre codificado-handoff-service.ts y
 * work-item-progress-repository.ts. productionPedidoId queda null en todas
 * las filas (mismo criterio que codificado-handoff-service.lote-vto.test.ts)
 * para que touchPedidoEnEnvasado/touchPedidoListoParaEntregar hagan return
 * temprano sin necesitar simular production_pedidos con datos.
 */

type FakeRow = Record<string, unknown> & { id: string };

function createFakeDb() {
  const workItems = new Map<string, FakeRow>();
  const workItemDeliveries = new Map<string, FakeRow>();
  const productionPedidos = new Map<string, FakeRow>();
  const operationalEvents: Record<string, unknown>[] = [];

  function matchCond(row: Record<string, unknown>, cond: unknown): boolean {
    if (!cond) return true;
    if (Array.isArray(cond)) return cond.every((c) => matchCond(row, c));
    const c = cond as { __eq?: [string, unknown] };
    if (c.__eq) return row[c.__eq[0]] === c.__eq[1];
    return true;
  }

  function tableFor(name: string): Map<string, FakeRow> {
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
        orderBy() {
          return api;
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
    insert(t: { __name: string }) {
      return {
        values(row: Record<string, unknown>) {
          if (t.__name === "operationalEvents") {
            operationalEvents.push(row);
            return Promise.resolve();
          }
          const target = tableFor(t.__name);
          const id = (row.id as string | undefined) ?? `${t.__name}-${target.size + 1}`;
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

  return { tx, workItems, workItemDeliveries, productionPedidos, operationalEvents };
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
    ne: (col: { name?: string } | string, val: unknown) => ({
      __ne: [typeof col === "string" ? col : (col as { name?: string }).name ?? "id", val],
    }),
    or: (...args: unknown[]) => args,
    desc: (col: unknown) => col,
    sql: actual.sql,
  };
});

vi.mock("@/lib/db/client", () => ({
  getDb: () => ({
    transaction: (fn: (tx: unknown) => unknown) => fn(fakeDbHandle.tx),
    select: fakeDbHandle.tx.select,
    update: fakeDbHandle.tx.update,
    insert: fakeDbHandle.tx.insert,
  }),
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
    "qualityStatus",
    "qualityDecidedAt",
    "qualityDecidedBy",
    "qualityDecidedBySector",
    "qualityObservation",
    "qualityChangeReason",
    "productionPedidoId",
    "orderNumber",
    "client",
    "product",
    "unit",
    "plannedQuantity",
    "planningWeekId",
    "plannedDate",
    "plannedDateTo",
    "priority",
    "notes",
    "publishedAt",
    "createdBy",
    "source",
    "originRef",
    "orderId",
    "deliveryDate",
    "createdAt",
    "updatedAt",
    "version",
    "deletedAt",
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
  const eventCols = ["workItemId", "type", "note", "actorEmail", "actorSector"];
  const table = (name: string, cols: string[]) => {
    const t: Record<string, unknown> = { __name: name };
    for (const c of cols) t[c] = { name: c };
    return t;
  };
  return {
    workItems: table("workItems", workItemCols),
    workItemDeliveries: table("workItemDeliveries", deliveryCols),
    operationalEvents: table("operationalEvents", eventCols),
    operationalOrders: table("operationalOrders", ["id", "orderNumber", "type", "linkedWorkItemId", "version"]),
    productionPedidos: table("productionPedidos", ["id", "op", "estado", "deletedAt"]),
    productionPedidoStatusEvents: table("productionPedidoStatusEvents", []),
  };
});

function baseWorkItem(overrides: Partial<FakeRow> = {}): FakeRow {
  return {
    id: "wi-e2e",
    status: "PUBLICADO",
    sector: "ENVASADO_MASIVO",
    plannedDate: "2026-09-01",
    plannedDateTo: null,
    client: "SC Beauty",
    product: "Serum Capixyl",
    plannedQuantity: "1250",
    unit: "u.",
    priority: "NORMAL",
    notes: null,
    publishedAt: new Date("2026-09-01T12:00:00.000Z"),
    createdBy: "produccion@laboratoriogenus.com.ar",
    source: "native",
    originRef: null,
    orderId: null,
    orderNumber: "OA-2026-000150",
    deliveryDate: null,
    createdAt: new Date("2026-09-01T12:00:00.000Z"),
    updatedAt: new Date("2026-09-01T12:00:00.000Z"),
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
    packingGroups: null,
    packingMismatchObservation: null,
    sampleUnits: null,
    deliverableUnits: null,
    packagingClosedAt: null,
    packagingClosedBy: null,
    bulkRemainderKg: null,
    bulkRemainderObservation: null,
    bulkRemainderId: null,
    operationalStatus: "pendiente",
    finishedQty: null,
    operationalObservation: null,
    qualityStatus: "pendiente",
    qualityDecidedAt: null,
    qualityDecidedBy: null,
    qualityDecidedBySector: null,
    qualityObservation: null,
    qualityChangeReason: null,
    reworkRequestedAt: null,
    reworkRequestedBy: null,
    reworkRequestedBySector: null,
    reworkReason: null,
    completedAt: null,
    completedBy: null,
    productionPedidoId: null,
    planningWeekId: "week-1",
    version: 1,
    deletedAt: null,
    ...overrides,
  };
}

describe("ROUND TRIP 1 — Producción carga lote/VTO/cantidad; el mismo dato sobrevive hasta Remito", () => {
  let saveWorkProgressDurable: typeof import("./work-item-progress-repository").saveWorkProgressDurable;
  let handoffToCodificadoDurable: typeof import("./codificado-handoff-service").handoffToCodificadoDurable;
  let deliverFromCodificadoDurable: typeof import("./codificado-handoff-service").deliverFromCodificadoDurable;
  let decideQualityDurable: typeof import("./work-item-progress-repository").decideQualityDurable;
  let deliverWorkDurable: typeof import("./work-item-progress-repository").deliverWorkDurable;

  const masivo = { email: "envasado@laboratoriogenus.com.ar", displayName: "Envasado", sector: "ENVASADO_MASIVO" };
  const codificado = { email: "codificado@laboratoriogenus.com.ar", displayName: "Codificado", sector: "CODIFICADO" };
  const calidad = { email: "calidad@laboratoriogenus.com.ar", displayName: "Calidad", sector: "CALIDAD" as const };

  beforeEach(async () => {
    vi.resetModules();
    fakeDbHandle = createFakeDb();
    ({ saveWorkProgressDurable, decideQualityDurable, deliverWorkDurable } = await import(
      "./work-item-progress-repository"
    ));
    ({ handoffToCodificadoDurable, deliverFromCodificadoDurable } = await import(
      "./codificado-handoff-service"
    ));
    // Producción crea/asigna el trabajo YA con lote/VTO/cantidad teórica.
    fakeDbHandle.workItems.set(
      "wi-e2e",
      baseWorkItem({ packagingLote: "L26055", packagingVto: "09/2028" })
    );
  });

  it("Producción → Envasado → Codificado → Calidad → Expedición/Remito: todos los campos sobreviven íntegros", async () => {
    // ENVASADO agrega packing/muestras/sobrante/cantidad final.
    await saveWorkProgressDurable(
      "wi-e2e",
      {
        finishedQty: "1250",
        observation: "",
        updatedBy: masivo.email,
        packingGroups: [
          { cajas: 10, unidadesPorCaja: 100 },
          { cajas: 5, unidadesPorCaja: 50 },
        ],
        sampleUnits: 3,
      },
      "ENVASADO_MASIVO"
    );
    // SEGUNDA LECTURA — Envasado guardó, confirmar TODOS los datos.
    let persisted = fakeDbHandle.workItems.get("wi-e2e")!;
    expect(persisted.packagingLote).toBe("L26055");
    expect(persisted.packagingVto).toBe("09/2028");
    expect(persisted.packingGroups).toEqual([
      { cajas: 10, unidadesPorCaja: 100 },
      { cajas: 5, unidadesPorCaja: 50 },
    ]);
    expect(persisted.sampleUnits).toBe(3);
    expect(persisted.finishedQty).toBe("1250");

    // Envío a CODIFICADO (cambio de estado — no debe tocar ninguno de estos datos).
    await handoffToCodificadoDurable(
      { workItemId: "wi-e2e", totalUnits: 1250, idempotencyKey: "e2e-send-001" },
      masivo
    );
    // SEGUNDA LECTURA.
    persisted = fakeDbHandle.workItems.get("wi-e2e")!;
    expect(persisted.packagingLote).toBe("L26055");
    expect(persisted.packagingVto).toBe("09/2028");
    expect(persisted.packingGroups).toEqual([
      { cajas: 10, unidadesPorCaja: 100 },
      { cajas: 5, unidadesPorCaja: 50 },
    ]);
    expect(persisted.sampleUnits).toBe(3);

    // CODIFICADO no modifica el packing, entrega a CALIDAD.
    await deliverFromCodificadoDurable(
      { workItemId: "wi-e2e", idempotencyKey: "e2e-deliver-cod-001" },
      codificado
    );
    // SEGUNDA LECTURA.
    persisted = fakeDbHandle.workItems.get("wi-e2e")!;
    expect(persisted.packagingLote).toBe("L26055");
    expect(persisted.packagingVto).toBe("09/2028");
    expect(persisted.packingGroups).toEqual([
      { cajas: 10, unidadesPorCaja: 100 },
      { cajas: 5, unidadesPorCaja: 50 },
    ]);
    expect(persisted.sampleUnits).toBe(3);
    expect(persisted.deliverableUnits).not.toBeNull();

    // CALIDAD aprueba.
    await decideQualityDurable("wi-e2e", "aprobado", {
      decidedBy: calidad.email,
      decidedBySector: calidad.sector,
    });
    // SEGUNDA LECTURA desde "Producción" (misma fila canónica).
    persisted = fakeDbHandle.workItems.get("wi-e2e")!;
    expect(persisted.qualityStatus).toBe("aprobado");
    expect(persisted.packagingLote).toBe("L26055");
    expect(persisted.packagingVto).toBe("09/2028");
    expect(persisted.packingGroups).toEqual([
      { cajas: 10, unidadesPorCaja: 100 },
      { cajas: 5, unidadesPorCaja: 50 },
    ]);

    // EXPEDICIÓN entrega al cliente — con un body de frontend que NO manda
    // estos datos (simula un caller mínimo), el servidor los relee de Neon.
    const delivery = await deliverWorkDurable({
      workItemId: "wi-e2e",
      qualityItemId: "qc-1",
      codigo: null,
      sourceSector: "CALIDAD",
      plannedDeliveryDate: "2026-09-20",
      actualDeliveredAt: "2026-09-18T15:00:00.000Z",
      remito: null,
      receivedBy: "Cliente SC Beauty",
      observations: null,
      deliveredBy: "deposito@laboratoriogenus.com.ar",
      deliveredBySector: "DEPOSITO",
    } as never);

    // REMITO — confirmar lote + cantidades/packing correspondientes.
    expect(delivery.lote).toBe("L26055");
    expect(delivery.vto).toBe("09/2028");
    expect(delivery.orderNumber).toBe("OA-2026-000150");
    expect(delivery.packingGroups).toEqual([
      { cajas: 10, unidadesPorCaja: 100 },
      { cajas: 5, unidadesPorCaja: 50 },
    ]);
    expect(delivery.sampleUnits).toBe(3);
    expect(delivery.plannedQuantity).toBe("1250");
    expect(delivery.finishedQty).toBe("1250");
  });
});

describe("ROUND TRIP 2 — Lote/VTO cargados recién por Codificado sobreviven hasta Calidad/Producción/Expedición/Remito", () => {
  let saveWorkProgressDurable: typeof import("./work-item-progress-repository").saveWorkProgressDurable;
  let handoffToCodificadoDurable: typeof import("./codificado-handoff-service").handoffToCodificadoDurable;
  let deliverFromCodificadoDurable: typeof import("./codificado-handoff-service").deliverFromCodificadoDurable;
  let decideQualityDurable: typeof import("./work-item-progress-repository").decideQualityDurable;
  let deliverWorkDurable: typeof import("./work-item-progress-repository").deliverWorkDurable;

  const masivo = { email: "envasado@laboratoriogenus.com.ar", displayName: "Envasado", sector: "ENVASADO_MASIVO" };
  const codificado = { email: "codificado@laboratoriogenus.com.ar", displayName: "Codificado", sector: "CODIFICADO" };
  const calidad = { email: "calidad@laboratoriogenus.com.ar", displayName: "Calidad", sector: "CALIDAD" as const };

  beforeEach(async () => {
    vi.resetModules();
    fakeDbHandle = createFakeDb();
    ({ saveWorkProgressDurable, decideQualityDurable, deliverWorkDurable } = await import(
      "./work-item-progress-repository"
    ));
    ({ handoffToCodificadoDurable, deliverFromCodificadoDurable } = await import(
      "./codificado-handoff-service"
    ));
    // Producción y Envasado dejan lote/VTO VACÍOS.
    fakeDbHandle.workItems.set(
      "wi-e2e-2",
      baseWorkItem({ id: "wi-e2e-2", orderNumber: "OA-2026-000151", packagingLote: null, packagingVto: null })
    );
  });

  it("TEST CRÍTICO 2 — Codificado completa Lote/VTO al entregar; Calidad/Producción/Expedición/Remito lo reciben, packingGroups intacto", async () => {
    // Envasado solo carga packing, deja lote/VTO vacíos.
    await saveWorkProgressDurable(
      "wi-e2e-2",
      {
        finishedQty: "1250",
        observation: "",
        updatedBy: masivo.email,
        packingGroups: [
          { cajas: 10, unidadesPorCaja: 100 },
          { cajas: 5, unidadesPorCaja: 50 },
        ],
      },
      "ENVASADO_MASIVO"
    );
    expect(fakeDbHandle.workItems.get("wi-e2e-2")!.packagingLote).toBeNull();

    await handoffToCodificadoDurable(
      { workItemId: "wi-e2e-2", totalUnits: 1250, idempotencyKey: "e2e2-send-001" },
      masivo
    );
    expect(fakeDbHandle.workItems.get("wi-e2e-2")!.packagingLote).toBeNull();

    // CODIFICADO carga Lote/VTO recién ahora, al entregar a Calidad.
    await deliverFromCodificadoDurable(
      {
        workItemId: "wi-e2e-2",
        packagingLote: "L26099",
        packagingVto: "10/2028",
        idempotencyKey: "e2e2-deliver-cod-001",
      },
      codificado
    );

    // SEGUNDA LECTURA — Calidad debe recibirlos.
    let persisted = fakeDbHandle.workItems.get("wi-e2e-2")!;
    expect(persisted.packagingLote).toBe("L26099");
    expect(persisted.packagingVto).toBe("10/2028");
    expect(persisted.packingGroups).toEqual([
      { cajas: 10, unidadesPorCaja: 100 },
      { cajas: 5, unidadesPorCaja: 50 },
    ]);

    await decideQualityDurable("wi-e2e-2", "aprobado", {
      decidedBy: calidad.email,
      decidedBySector: calidad.sector,
    });

    // SEGUNDA LECTURA desde "Producción" — mismos valores.
    persisted = fakeDbHandle.workItems.get("wi-e2e-2")!;
    expect(persisted.packagingLote).toBe("L26099");
    expect(persisted.packagingVto).toBe("10/2028");
    expect(persisted.packingGroups).toEqual([
      { cajas: 10, unidadesPorCaja: 100 },
      { cajas: 5, unidadesPorCaja: 50 },
    ]);

    // EXPEDICIÓN → REMITO: el snapshot de entrega debe usar L26099/10-2028.
    const delivery = await deliverWorkDurable({
      workItemId: "wi-e2e-2",
      qualityItemId: "qc-2",
      codigo: null,
      sourceSector: "CALIDAD",
      plannedDeliveryDate: "2026-09-25",
      actualDeliveredAt: "2026-09-22T15:00:00.000Z",
      remito: null,
      receivedBy: "Cliente",
      observations: null,
      deliveredBy: "deposito@laboratoriogenus.com.ar",
      deliveredBySector: "DEPOSITO",
    } as never);

    expect(delivery.lote).toBe("L26099");
    expect(delivery.vto).toBe("10/2028");
    expect(delivery.packingGroups).toEqual([
      { cajas: 10, unidadesPorCaja: 100 },
      { cajas: 5, unidadesPorCaja: 50 },
    ]);
  });
});

describe("ROUND TRIP 3 — NO-CLOBBER: ninguna operación de lifecycle borra un campo no relacionado", () => {
  let saveWorkProgressDurable: typeof import("./work-item-progress-repository").saveWorkProgressDurable;
  let completeWorkDurable: typeof import("./work-item-progress-repository").completeWorkDurable;
  let decideQualityDurable: typeof import("./work-item-progress-repository").decideQualityDurable;
  let reworkWorkItemDurable: typeof import("./work-item-progress-repository").reworkWorkItemDurable;
  let deliverWorkDurable: typeof import("./work-item-progress-repository").deliverWorkDurable;
  let handoffToCodificadoDurable: typeof import("./codificado-handoff-service").handoffToCodificadoDurable;
  let deliverFromCodificadoDurable: typeof import("./codificado-handoff-service").deliverFromCodificadoDurable;

  const actorArgs = { updatedBy: "envasado@laboratoriogenus.com.ar", sector: "ENVASADO_MASIVO" as const };

  function assertCanonicalIntact(row: FakeRow) {
    expect(row.packagingLote).toBe("L26200");
    expect(row.packagingVto).toBe("11/2028");
    expect(row.orderNumber).toBe("OA-2026-000160");
    expect(row.packingGroups).toEqual([
      { cajas: 10, unidadesPorCaja: 100 },
      { cajas: 5, unidadesPorCaja: 50 },
    ]);
    expect(row.sampleUnits).toBe(3);
    expect(row.plannedQuantity).toBe("1250");
  }

  beforeEach(async () => {
    vi.resetModules();
    fakeDbHandle = createFakeDb();
    ({ saveWorkProgressDurable, completeWorkDurable, decideQualityDurable, reworkWorkItemDurable, deliverWorkDurable } =
      await import("./work-item-progress-repository"));
    ({ handoffToCodificadoDurable, deliverFromCodificadoDurable } = await import("./codificado-handoff-service"));
    fakeDbHandle.workItems.set(
      "wi-noclobber",
      baseWorkItem({
        id: "wi-noclobber",
        orderNumber: "OA-2026-000160",
        packagingLote: "L26200",
        packagingVto: "11/2028",
        packingGroups: [
          { cajas: 10, unidadesPorCaja: 100 },
          { cajas: 5, unidadesPorCaja: 50 },
        ],
        sampleUnits: 3,
        finishedQty: "1250",
      })
    );
  });

  it("guardar avance → completar → aprobar → rehacer: cada paso preserva lote/VTO/OA/packing/cantidad/muestras", async () => {
    await saveWorkProgressDurable(
      "wi-noclobber",
      { finishedQty: "1250", observation: "avance", updatedBy: actorArgs.updatedBy },
      actorArgs.sector
    );
    assertCanonicalIntact(fakeDbHandle.workItems.get("wi-noclobber")!);

    await completeWorkDurable(
      "wi-noclobber",
      { finishedQty: "1250", observation: "completo", completedBy: actorArgs.updatedBy },
      actorArgs.sector
    );
    assertCanonicalIntact(fakeDbHandle.workItems.get("wi-noclobber")!);

    // Rehacer requiere completedAt seteado y qualityStatus todavía "pendiente"
    // (canRequestRework) — va ANTES de que Calidad decida, no después.
    await reworkWorkItemDurable("wi-noclobber", {
      requestedBy: "calidad@laboratoriogenus.com.ar",
      requestedBySector: "CALIDAD",
      reason: "Ajuste de precinto",
    });
    assertCanonicalIntact(fakeDbHandle.workItems.get("wi-noclobber")!);

    // Reenviar el ciclo: completar de nuevo y entregar.
    await completeWorkDurable(
      "wi-noclobber",
      { finishedQty: "1250", observation: "completo de nuevo", completedBy: actorArgs.updatedBy },
      actorArgs.sector
    );
    assertCanonicalIntact(fakeDbHandle.workItems.get("wi-noclobber")!);

    await decideQualityDurable("wi-noclobber", "aprobado", {
      decidedBy: "calidad@laboratoriogenus.com.ar",
      decidedBySector: "CALIDAD",
    });
    assertCanonicalIntact(fakeDbHandle.workItems.get("wi-noclobber")!);

    const delivery = await deliverWorkDurable({
      workItemId: "wi-noclobber",
      qualityItemId: "qc-3",
      codigo: null,
      sourceSector: "CALIDAD",
      plannedDeliveryDate: "2026-09-30",
      actualDeliveredAt: "2026-09-28T15:00:00.000Z",
      remito: null,
      receivedBy: "Cliente",
      observations: null,
      deliveredBy: "deposito@laboratoriogenus.com.ar",
      deliveredBySector: "DEPOSITO",
    } as never);
    assertCanonicalIntact(fakeDbHandle.workItems.get("wi-noclobber")!);
    expect(delivery.lote).toBe("L26200");
    expect(delivery.vto).toBe("11/2028");
  });

  it("handoff a Codificado y entrega desde Codificado tampoco clobberean lote/VTO/OA/packing/cantidad ya cargados", async () => {
    await handoffToCodificadoDurable(
      { workItemId: "wi-noclobber", totalUnits: 1250, idempotencyKey: "e2e3-send-001" },
      { email: "envasado@laboratoriogenus.com.ar", displayName: "Envasado", sector: "ENVASADO_MASIVO" }
    );
    assertCanonicalIntact(fakeDbHandle.workItems.get("wi-noclobber")!);

    await deliverFromCodificadoDurable(
      { workItemId: "wi-noclobber", idempotencyKey: "e2e3-deliver-001" },
      { email: "codificado@laboratoriogenus.com.ar", displayName: "Codificado", sector: "CODIFICADO" }
    );
    assertCanonicalIntact(fakeDbHandle.workItems.get("wi-noclobber")!);
  });
});

/**
 * BLINDAJE DEFINITIVO LOTE/VTO (auditoría "GENUS OS no puede perder Lote/VTO
 * una vez cargados"). Las suites de arriba ya prueban que un body SIN el
 * campo (undefined) o con `null` nunca clobberea un lote/VTO existente. Acá
 * se prueba el caso que todavía faltaba explícito: un frontend viejo que
 * manda un valor NO VACÍO pero INCORRECTO (ej. quedó con una pantalla
 * abierta desde antes de que Producción cargara L26099 y todavía tiene
 * L25020 en su estado) — debe ser igual de inofensivo que null/undefined en
 * cualquier operación que no sea la corrección explícita.
 */
describe("BLINDAJE DEFINITIVO LOTE/VTO — un valor stale INCORRECTO (no solo vacío) nunca reemplaza el canónico", () => {
  let saveWorkProgressDurable: typeof import("./work-item-progress-repository").saveWorkProgressDurable;
  let handoffToCodificadoDurable: typeof import("./codificado-handoff-service").handoffToCodificadoDurable;
  let deliverFromCodificadoDurable: typeof import("./codificado-handoff-service").deliverFromCodificadoDurable;
  let decideQualityDurable: typeof import("./work-item-progress-repository").decideQualityDurable;
  let deliverWorkDurable: typeof import("./work-item-progress-repository").deliverWorkDurable;

  const masivo = { email: "envasado@laboratoriogenus.com.ar", displayName: "Envasado", sector: "ENVASADO_MASIVO" };
  const codificado = { email: "codificado@laboratoriogenus.com.ar", displayName: "Codificado", sector: "CODIFICADO" };

  beforeEach(async () => {
    vi.resetModules();
    fakeDbHandle = createFakeDb();
    ({ saveWorkProgressDurable, decideQualityDurable, deliverWorkDurable } = await import(
      "./work-item-progress-repository"
    ));
    ({ handoffToCodificadoDurable, deliverFromCodificadoDurable } = await import(
      "./codificado-handoff-service"
    ));
    fakeDbHandle.workItems.set(
      "wi-stale-wrong",
      baseWorkItem({
        id: "wi-stale-wrong",
        orderNumber: "OA-2026-000170",
        packagingLote: "L26099",
        packagingVto: "09/2028",
        packingGroups: [{ cajas: 25, unidadesPorCaja: 50 }],
      })
    );
  });

  it("saveWorkProgressDurable: un body con lote/vto DISTINTO al canónico no lo pisa", async () => {
    await saveWorkProgressDurable(
      "wi-stale-wrong",
      {
        finishedQty: "1250",
        observation: "",
        updatedBy: masivo.email,
        packagingLote: "L25020",
        packagingVto: "04/2027",
      },
      "ENVASADO_MASIVO"
    );
    const persisted = fakeDbHandle.workItems.get("wi-stale-wrong")!;
    expect(persisted.packagingLote).toBe("L26099");
    expect(persisted.packagingVto).toBe("09/2028");
  });

  it("handoffToCodificadoDurable: un body con lote/vto DISTINTO al canónico no lo pisa", async () => {
    await handoffToCodificadoDurable(
      {
        workItemId: "wi-stale-wrong",
        totalUnits: 1250,
        idempotencyKey: "stale-wrong-send-001",
        packagingLote: "L25020",
        packagingVto: "04/2027",
      },
      masivo
    );
    const persisted = fakeDbHandle.workItems.get("wi-stale-wrong")!;
    expect(persisted.packagingLote).toBe("L26099");
    expect(persisted.packagingVto).toBe("09/2028");
  });

  it("deliverFromCodificadoDurable: un body con lote/vto DISTINTO al canónico no lo pisa", async () => {
    await handoffToCodificadoDurable(
      { workItemId: "wi-stale-wrong", totalUnits: 1250, idempotencyKey: "stale-wrong-send-002" },
      masivo
    );
    await deliverFromCodificadoDurable(
      {
        workItemId: "wi-stale-wrong",
        idempotencyKey: "stale-wrong-deliver-001",
        packagingLote: "L25020",
        packagingVto: "04/2027",
      },
      codificado
    );
    const persisted = fakeDbHandle.workItems.get("wi-stale-wrong")!;
    expect(persisted.packagingLote).toBe("L26099");
    expect(persisted.packagingVto).toBe("09/2028");
  });

  it("deliverWorkDurable: ni siquiera lee lote/vto del body — el snapshot de entrega usa SIEMPRE el WorkItem actual", async () => {
    await handoffToCodificadoDurable(
      { workItemId: "wi-stale-wrong", totalUnits: 1250, idempotencyKey: "stale-wrong-send-003" },
      masivo
    );
    await deliverFromCodificadoDurable(
      { workItemId: "wi-stale-wrong", idempotencyKey: "stale-wrong-deliver-002" },
      codificado
    );
    await decideQualityDurable("wi-stale-wrong", "aprobado", {
      decidedBy: "calidad@laboratoriogenus.com.ar",
      decidedBySector: "CALIDAD",
    });

    const delivery = await deliverWorkDurable({
      workItemId: "wi-stale-wrong",
      qualityItemId: "qc-stale-wrong",
      codigo: null,
      sourceSector: "CALIDAD",
      plannedDeliveryDate: "2026-10-01",
      actualDeliveredAt: "2026-09-29T15:00:00.000Z",
      remito: null,
      receivedBy: "Cliente",
      observations: null,
      deliveredBy: "deposito@laboratoriogenus.com.ar",
      deliveredBySector: "DEPOSITO",
      // Body de un frontend viejo (Expedición con la pantalla abierta desde
      // antes de que existiera L26099) — el servidor debe ignorarlo por
      // completo, ni siquiera "casi" usarlo.
      lote: "L25020",
    } as never);

    expect(delivery.lote).toBe("L26099");
    expect(delivery.vto).toBe("09/2028");

    // SEGUNDA LECTURA independiente del snapshot recién insertado.
    const persistedDelivery = fakeDbHandle.workItemDeliveries.get(delivery.id as string)!;
    expect(persistedDelivery.lote).toBe("L26099");
    expect(persistedDelivery.vto).toBe("09/2028");

    // Y el WorkItem canónico sigue intacto — deliverWorkDurable nunca escribe de vuelta.
    const persisted = fakeDbHandle.workItems.get("wi-stale-wrong")!;
    expect(persisted.packagingLote).toBe("L26099");
    expect(persisted.packagingVto).toBe("09/2028");
  });
});

/**
 * Corrección explícita (updateWorkItemLoteVtoDurable) — el ÚNICO camino
 * autorizado para reemplazar un Lote/VTO ya cargado. Debe auditar el
 * cambio y, crucialmente, NUNCA reescribir retroactivamente una entrega ya
 * confirmada — ese snapshot es evidencia histórica del Remito emitido con
 * el valor vigente en ese momento.
 */
describe("BLINDAJE DEFINITIVO LOTE/VTO — corrección explícita audita el cambio y no toca snapshots históricos", () => {
  let updateWorkItemLoteVtoDurable: typeof import("./work-item-progress-repository").updateWorkItemLoteVtoDurable;
  let deliverWorkDurable: typeof import("./work-item-progress-repository").deliverWorkDurable;
  let decideQualityDurable: typeof import("./work-item-progress-repository").decideQualityDurable;

  beforeEach(async () => {
    vi.resetModules();
    fakeDbHandle = createFakeDb();
    ({ updateWorkItemLoteVtoDurable, deliverWorkDurable, decideQualityDurable } = await import(
      "./work-item-progress-repository"
    ));
    fakeDbHandle.workItems.set(
      "wi-correction",
      baseWorkItem({
        id: "wi-correction",
        orderNumber: "OA-2026-000180",
        packagingLote: "L26099",
        packagingVto: "09/2028",
        finishedQty: "1250",
        packingGroups: [{ cajas: 25, unidadesPorCaja: 50 }],
      })
    );
  });

  it("corrige L26099→L26100 y 09/2028→10/2028, deja auditoría con valor anterior/nuevo/actor/motivo", async () => {
    const row = await updateWorkItemLoteVtoDurable("wi-correction", {
      packagingLote: "L26100",
      packagingVto: "10/2028",
      reason: "Error de tipeo al cargar el lote original",
      updatedBy: "produccion@laboratoriogenus.com.ar",
      updatedBySector: "PRODUCCION",
    });
    expect(row.packagingLote).toBe("L26100");
    expect(row.packagingVto).toBe("10/2028");

    // SEGUNDA LECTURA — todas las pantallas ahora deben ver L26100/10-2028.
    const persisted = fakeDbHandle.workItems.get("wi-correction")!;
    expect(persisted.packagingLote).toBe("L26100");
    expect(persisted.packagingVto).toBe("10/2028");

    const event = fakeDbHandle.operationalEvents.find(
      (e) => e.type === "LOTE_VTO_CORRECTED"
    ) as { fromStatus: string; toStatus: string; actorEmail: string; note: string } | undefined;
    expect(event).toBeTruthy();
    expect(JSON.parse(event!.fromStatus)).toEqual({ lote: "L26099", vto: "09/2028" });
    expect(JSON.parse(event!.toStatus)).toEqual({ lote: "L26100", vto: "10/2028" });
    expect(event!.actorEmail).toBe("produccion@laboratoriogenus.com.ar");
    expect(event!.note).toBe("Error de tipeo al cargar el lote original");
  });

  it("una entrega ya confirmada ANTES de la corrección conserva su snapshot histórico (L26099), aunque el WorkItem pase a L26100", async () => {
    await decideQualityDurable("wi-correction", "aprobado", {
      decidedBy: "calidad@laboratoriogenus.com.ar",
      decidedBySector: "CALIDAD",
    });
    const delivery = await deliverWorkDurable({
      workItemId: "wi-correction",
      qualityItemId: "qc-correction",
      codigo: null,
      sourceSector: "CALIDAD",
      plannedDeliveryDate: "2026-10-05",
      actualDeliveredAt: "2026-10-02T15:00:00.000Z",
      remito: "R-0001",
      receivedBy: "Cliente",
      observations: null,
      deliveredBy: "deposito@laboratoriogenus.com.ar",
      deliveredBySector: "DEPOSITO",
    } as never);
    expect(delivery.lote).toBe("L26099");

    // Producción corrige DESPUÉS de que el remito ya salió con L26099.
    await updateWorkItemLoteVtoDurable("wi-correction", {
      packagingLote: "L26100",
      reason: "Corrección posterior — no debe tocar el remito ya emitido",
      updatedBy: "produccion@laboratoriogenus.com.ar",
      updatedBySector: "PRODUCCION",
    });

    // El WorkItem (fuente actual) ya muestra L26100...
    expect(fakeDbHandle.workItems.get("wi-correction")!.packagingLote).toBe("L26100");
    // ...pero el snapshot de la entrega ya confirmada NO cambió retroactivamente.
    const persistedDelivery = fakeDbHandle.workItemDeliveries.get(delivery.id as string)!;
    expect(persistedDelivery.lote).toBe("L26099");
  });

  it("rechaza la corrección sin motivo — no hay forma de pisar Lote/VTO sin auditoría", async () => {
    await expect(
      updateWorkItemLoteVtoDurable("wi-correction", {
        packagingLote: "L26100",
        reason: "",
        updatedBy: "produccion@laboratoriogenus.com.ar",
        updatedBySector: "PRODUCCION",
      })
    ).rejects.toThrow(/motivo/i);
    expect(fakeDbHandle.workItems.get("wi-correction")!.packagingLote).toBe("L26099");
  });
});

/**
 * Lote y VTO pueden cargarse en momentos distintos — completar uno no debe
 * exigir reenviar el otro, en ningún sentido (lote-primero-vto-después, y
 * a la inversa).
 */
describe("BLINDAJE DEFINITIVO LOTE/VTO — se completan en momentos independientes, sin reenviar el otro", () => {
  let saveWorkProgressDurable: typeof import("./work-item-progress-repository").saveWorkProgressDurable;
  let handoffToCodificadoDurable: typeof import("./codificado-handoff-service").handoffToCodificadoDurable;
  let deliverFromCodificadoDurable: typeof import("./codificado-handoff-service").deliverFromCodificadoDurable;

  const masivo = { email: "envasado@laboratoriogenus.com.ar", displayName: "Envasado", sector: "ENVASADO_MASIVO" };
  const codificado = { email: "codificado@laboratoriogenus.com.ar", displayName: "Codificado", sector: "CODIFICADO" };

  beforeEach(async () => {
    vi.resetModules();
    fakeDbHandle = createFakeDb();
    ({ saveWorkProgressDurable } = await import("./work-item-progress-repository"));
    ({ handoffToCodificadoDurable, deliverFromCodificadoDurable } = await import(
      "./codificado-handoff-service"
    ));
  });

  it("Producción carga solo Lote; Codificado completa solo VTO al entregar — Codificado no reenvía el lote", async () => {
    fakeDbHandle.workItems.set(
      "wi-lote-primero",
      baseWorkItem({ id: "wi-lote-primero", orderNumber: "OA-2026-000190", packagingLote: "L26099", packagingVto: null })
    );

    await saveWorkProgressDurable(
      "wi-lote-primero",
      {
        finishedQty: "1250",
        observation: "",
        updatedBy: masivo.email,
        packingGroups: [{ cajas: 25, unidadesPorCaja: 50 }],
      },
      "ENVASADO_MASIVO"
    );
    let persisted = fakeDbHandle.workItems.get("wi-lote-primero")!;
    expect(persisted.packagingLote).toBe("L26099");
    expect(persisted.packagingVto).toBeNull();

    await handoffToCodificadoDurable(
      { workItemId: "wi-lote-primero", totalUnits: 1250, idempotencyKey: "lote-primero-send-001" },
      masivo
    );
    persisted = fakeDbHandle.workItems.get("wi-lote-primero")!;
    expect(persisted.packagingLote).toBe("L26099");
    expect(persisted.packagingVto).toBeNull();

    // Codificado manda SOLO el VTO — nunca tuvo ni necesita reenviar el lote.
    await deliverFromCodificadoDurable(
      { workItemId: "wi-lote-primero", packagingVto: "09/2028", idempotencyKey: "lote-primero-deliver-001" },
      codificado
    );

    persisted = fakeDbHandle.workItems.get("wi-lote-primero")!;
    expect(persisted.packagingLote).toBe("L26099");
    expect(persisted.packagingVto).toBe("09/2028");
  });

  it("a la inversa: Producción carga solo VTO; Codificado completa solo Lote al entregar — Codificado no reenvía el VTO", async () => {
    fakeDbHandle.workItems.set(
      "wi-vto-primero",
      baseWorkItem({
        id: "wi-vto-primero",
        orderNumber: "OA-2026-000191",
        packagingLote: null,
        packagingVto: "09/2028",
        packingGroups: [{ cajas: 25, unidadesPorCaja: 50 }],
      })
    );

    await handoffToCodificadoDurable(
      { workItemId: "wi-vto-primero", totalUnits: 1250, idempotencyKey: "vto-primero-send-001" },
      masivo
    );
    let persisted = fakeDbHandle.workItems.get("wi-vto-primero")!;
    expect(persisted.packagingLote).toBeNull();
    expect(persisted.packagingVto).toBe("09/2028");

    await deliverFromCodificadoDurable(
      { workItemId: "wi-vto-primero", packagingLote: "L26099", idempotencyKey: "vto-primero-deliver-001" },
      codificado
    );

    persisted = fakeDbHandle.workItems.get("wi-vto-primero")!;
    expect(persisted.packagingLote).toBe("L26099");
    expect(persisted.packagingVto).toBe("09/2028");
  });
});

/**
 * El sistema de warnings (getWorkItemWarnings) debe reflejar exactamente el
 * mismo WorkItem canónico en cada punto del ciclo — nunca "atrasado" ni
 * "adelantado" respecto de lo que Neon tiene en ese momento.
 */
describe("BLINDAJE DEFINITIVO LOTE/VTO — los warnings siguen al WorkItem canónico en cada paso", () => {
  let saveWorkProgressDurable: typeof import("./work-item-progress-repository").saveWorkProgressDurable;
  let handoffToCodificadoDurable: typeof import("./codificado-handoff-service").handoffToCodificadoDurable;
  let deliverFromCodificadoDurable: typeof import("./codificado-handoff-service").deliverFromCodificadoDurable;
  let getWorkItemWarningCodes: typeof import("./work-item-warnings").getWorkItemWarningCodes;

  const masivo = { email: "envasado@laboratoriogenus.com.ar", displayName: "Envasado", sector: "ENVASADO_MASIVO" };
  const codificado = { email: "codificado@laboratoriogenus.com.ar", displayName: "Codificado", sector: "CODIFICADO" };

  beforeEach(async () => {
    vi.resetModules();
    fakeDbHandle = createFakeDb();
    ({ saveWorkProgressDurable } = await import("./work-item-progress-repository"));
    ({ handoffToCodificadoDurable, deliverFromCodificadoDurable } = await import(
      "./codificado-handoff-service"
    ));
    ({ getWorkItemWarningCodes } = await import("./work-item-warnings"));
    fakeDbHandle.workItems.set(
      "wi-warnings",
      baseWorkItem({
        id: "wi-warnings",
        orderNumber: "OA-2026-000195",
        packagingLote: null,
        packagingVto: null,
      })
    );
  });

  /**
   * getWorkItemWarnings() lee WorkItem.status (mapeado por el proyector
   * nativo desde operationalStatus — ver native-projector.ts), no el
   * `status` de workflow crudo (PUBLICADO/BORRADOR) que usa esta fila fake.
   * Se arma el objeto con esa traducción para llamar al helper real tal
   * cual lo hace la UI sobre un WorkItem ya proyectado.
   */
  function asProjectedWorkItem(row: FakeRow) {
    return { ...row, status: row.operationalStatus } as never;
  }

  it("FALTA_LOTE+FALTA_VTO mientras están vacíos, y desaparecen apenas Codificado los completa — mismo WorkItem, mismo cálculo", async () => {
    await saveWorkProgressDurable(
      "wi-warnings",
      {
        finishedQty: "1250",
        observation: "",
        updatedBy: masivo.email,
        packingGroups: [{ cajas: 25, unidadesPorCaja: 50 }],
      },
      "ENVASADO_MASIVO"
    );
    let row = fakeDbHandle.workItems.get("wi-warnings")!;
    expect(getWorkItemWarningCodes(asProjectedWorkItem(row))).toEqual(
      expect.arrayContaining(["FALTA_LOTE", "FALTA_VTO"])
    );

    await handoffToCodificadoDurable(
      { workItemId: "wi-warnings", totalUnits: 1250, idempotencyKey: "warnings-send-001" },
      masivo
    );
    await deliverFromCodificadoDurable(
      {
        workItemId: "wi-warnings",
        packagingLote: "L26099",
        packagingVto: "09/2028",
        idempotencyKey: "warnings-deliver-001",
      },
      codificado
    );

    row = fakeDbHandle.workItems.get("wi-warnings")!;
    const codes = getWorkItemWarningCodes(asProjectedWorkItem(row));
    expect(codes).not.toContain("FALTA_LOTE");
    expect(codes).not.toContain("FALTA_VTO");
  });
});
