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
    const c = cond as { __eq?: [string, unknown] };
    if (c.__eq) return row[c.__eq[0]] === c.__eq[1];
    // Predicado SQL crudo (ej. version + 1, IS NULL OR = id) — no
    // introspectable en el fake; se trata como cierto (mismo criterio que
    // work-assignment-service.test.ts).
    return true;
  }

  function tableFor(name: string): Map<string, FakeRow> {
    if (name === "operationalOrders") return operationalOrders;
    if (name === "workItemDeliveries") return workItemDeliveries;
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

  return { tx, workItems, operationalOrders, workItemDeliveries, operationalEvents };
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
    "line",
    "operationalStatus",
    "deletedAt",
  ];
  const orderCols = ["id", "orderNumber", "type", "linkedWorkItemId", "version"];
  const deliveryCols = ["id", "workItemId", "status", "archived"];
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
});
