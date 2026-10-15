import { describe, expect, it } from "vitest";
import { defaultDeliveryKey, planDeliveryStep, resolveDeliveryTarget } from "./delivery-math";
import {
  buildCircuitNotification,
  deterministicCircuitNotificationId,
  type CircuitMovement,
} from "./movements";
import { suggestEnvasadoDestination } from "./destination";
import { classifyPendingDefinition } from "./pending-definition";
import {
  assertEnvasadoDeliveryBoxes,
  closeForCodificadoTransfer,
  hasRealPackingGroups,
} from "./packaging-close";
import { canDeliverWork, validateDeliverWorkActor } from "@/features/os/operational/lib/delivery-rbac";

describe("entregas parciales — aritmética", () => {
  it("objetivo: embalado > total declarado > realizado > planificado", () => {
    expect(resolveDeliveryTarget({ unit: "un.", deliverableUnits: 950, packagingTotalUnits: 1000, plannedQuantity: "1200" })).toBe(950);
    expect(resolveDeliveryTarget({ unit: "un.", packagingTotalUnits: 1000, plannedQuantity: "1200" })).toBe(1000);
    expect(resolveDeliveryTarget({ unit: "un.", finishedQty: "900", plannedQuantity: "1200" })).toBe(900);
    expect(resolveDeliveryTarget({ unit: "un.", plannedQuantity: "1.200" })).toBe(1200);
    expect(resolveDeliveryTarget({ unit: "un.", plannedQuantity: "n/d" })).toBeNull();
  });
  it("parcial deja saldo y no completa; la segunda entrega completa", () => {
    const first = planDeliveryStep({ target: 1000, alreadyDelivered: 0, requested: 400, unit: "un." });
    expect(first).toMatchObject({ ok: true, quantity: 400, pending: 600, complete: false });
    const second = planDeliveryStep({ target: 1000, alreadyDelivered: 400, requested: null, unit: "un." });
    expect(second).toMatchObject({ ok: true, quantity: 600, pending: 0, complete: true });
  });
  it("rechaza exceder el saldo, cantidades inválidas y entrega sin saldo", () => {
    expect(planDeliveryStep({ target: 1000, alreadyDelivered: 400, requested: 700, unit: "un." })).toMatchObject({ ok: false, code: "EXCEEDS_BALANCE" });
    expect(planDeliveryStep({ target: 1000, alreadyDelivered: 0, requested: 0, unit: "un." })).toMatchObject({ ok: false, code: "INVALID_QUANTITY" });
    expect(planDeliveryStep({ target: 1000, alreadyDelivered: 0, requested: 1.5, unit: "un." })).toMatchObject({ ok: false, code: "INVALID_QUANTITY" });
    expect(planDeliveryStep({ target: 1000, alreadyDelivered: 1000, requested: null, unit: "un." })).toMatchObject({ ok: false, code: "NOTHING_PENDING" });
  });
  it("kg decimales con tolerancia", () => {
    expect(planDeliveryStep({ target: 10.5, alreadyDelivered: 5.25, requested: 5.25, unit: "kg" })).toMatchObject({ ok: true, complete: true });
  });
  it("clave por defecto: mismo paso = misma clave; paso siguiente = otra", () => {
    const a = defaultDeliveryKey({ workItemId: "w", alreadyDelivered: 0, requested: 400 });
    expect(defaultDeliveryKey({ workItemId: "w", alreadyDelivered: 0, requested: 400 })).toBe(a);
    expect(defaultDeliveryKey({ workItemId: "w", alreadyDelivered: 400, requested: 400 })).not.toBe(a);
  });
});

describe("notificaciones del circuito", () => {
  const base: CircuitMovement = {
    type: "ELABORACION_A_ENVASADO",
    workItemId: "11111111-1111-1111-1111-111111111111",
    eventKey: "k-1",
    fromSector: "ELABORACION",
    toSector: "ENVASADO_MASIVO",
    client: "Cliente X",
    product: "Shampoo",
    quantity: "500",
    unit: "kg",
    lote: "L123",
    at: new Date("2026-10-14T18:30:00Z"),
    actorName: "Ana",
    actorEmail: "ana@x.com",
  };
  it("contiene origen, destino, cliente, producto, cantidad, lote, fecha, responsable, tipo y enlace", () => {
    const n = buildCircuitNotification(base);
    for (const t of ["Elaboración", "Envasado Masivo", "Cliente X", "Shampoo", "500 kg", "L123", "14/10/2026", "Ana", "Envío a Envasado"]) {
      expect(n.message).toContain(t);
    }
    expect(n.sectors).toEqual(["PRODUCCION", "DIRECCION"]);
    expect(n.href).toContain("workItemId=native%3A11111111");
  });
  it("id determinístico por tipo+trabajo+clave", () => {
    expect(buildCircuitNotification(base).id).toBe(deterministicCircuitNotificationId("ELABORACION_A_ENVASADO", base.workItemId, "k-1"));
    expect(buildCircuitNotification({ ...base }).id).toBe(buildCircuitNotification(base).id);
    expect(buildCircuitNotification({ ...base, eventKey: "k-2" }).id).not.toBe(buildCircuitNotification(base).id);
  });
  it("entrega parcial indica saldo; hrefs distintos por evento", () => {
    const n = buildCircuitNotification({ ...base, type: "ENVASADO_ENTREGA", toSector: null, fromSector: "ENVASADO_MASIVO", complete: false, pending: 600 });
    expect(n.title).toContain("parcial");
    expect(n.message).toContain("Saldo pendiente: 600");
    expect(buildCircuitNotification({ ...base, eventKey: "z" }).href).not.toBe(buildCircuitNotification(base).href);
  });
});

describe("destino Masivo/Premium", () => {
  it("deduce por pedido+producto, luego historial; ambiguo/ninguno => null", () => {
    expect(suggestEnvasadoDestination({ pedidoId: "p1", client: "C", product: "P" }, [{ sector: "ENVASADO_PREMIUM", pedidoId: "p1", client: "C", product: "P" }]).sector).toBe("ENVASADO_PREMIUM");
    expect(suggestEnvasadoDestination({ pedidoId: null, client: "C", product: "P" }, [{ sector: "ENVASADO_MASIVO", client: "c", product: "p" }]).reason).toBe("HISTORIAL_CLIENTE_PRODUCTO");
    expect(suggestEnvasadoDestination({ pedidoId: null, client: "C", product: "P" }, [{ sector: "ENVASADO_MASIVO", client: "C", product: "P" }, { sector: "ENVASADO_PREMIUM", client: "C", product: "P" }]).sector).toBeNull();
    expect(suggestEnvasadoDestination({ pedidoId: null, client: "C", product: "P" }, []).reason).toBe("NO_DETERMINABLE");
  });
});

describe("pendientes de definir", () => {
  it("acciones según sector; nunca se marca entregado", () => {
    expect(classifyPendingDefinition({ sector: "ELABORACION", operationalStatus: "revision", completedAt: "x" }).actions).toContain("ENVIAR_A_ENVASADO");
    const env = classifyPendingDefinition({ sector: "ENVASADO_MASIVO", operationalStatus: "revision", completedAt: "x", qualityStatus: "pendiente" });
    expect(env.actions).toEqual(["REGISTRAR_ENTREGA", "ENVIAR_A_CODIFICADO", "REHACER"]);
    expect(env.legacyQualityPending).toBe(true);
    expect(classifyPendingDefinition({ sector: "CODIFICADO", operationalStatus: "revision" }).actions).toContain("REGISTRAR_ENTREGA");
    const unknown = classifyPendingDefinition({ sector: "OTRO", operationalStatus: "revision" });
    expect(unknown.destinationKnown).toBe(false);
    expect(unknown.actions).toContain("ASIGNAR");
    expect(classifyPendingDefinition({ sector: "ENVASADO_MASIVO", operationalStatus: "entregado" }).pending).toBe(false);
  });
});

describe("excepción de cajas", () => {
  it("Envasado→Codificado: sin cajas no valida ni inventa distribución", () => {
    expect(closeForCodificadoTransfer({ totalUnits: 1000, sampleUnits: null, packingGroups: null })).toEqual({ deliverableUnits: undefined, closed: false });
    expect(closeForCodificadoTransfer({ totalUnits: 1000, sampleUnits: null, packingGroups: [] }).closed).toBe(false);
    expect(closeForCodificadoTransfer({ totalUnits: 1000, sampleUnits: null, packingGroups: [{ cajas: 2, unidadesPorCaja: 100 }] }).closed).toBe(false);
  });
  it("distribución real consistente: se conserva el cierre", () => {
    expect(closeForCodificadoTransfer({ totalUnits: 1000, sampleUnits: 3, packingGroups: [{ cajas: 10, unidadesPorCaja: 100 }] })).toEqual({ deliverableUnits: 1000, closed: true });
  });
  it("Entregar desde Envasado exige cajas y balance (o justificación)", () => {
    expect(hasRealPackingGroups([])).toBe(false);
    expect(() => assertEnvasadoDeliveryBoxes({ finishedQty: 1000, sampleUnits: null, packingGroups: [], observation: "" })).toThrow(/distribución en cajas/);
    expect(() => assertEnvasadoDeliveryBoxes({ finishedQty: 1000, sampleUnits: null, packingGroups: [{ cajas: 9, unidadesPorCaja: 100 }], observation: "" })).toThrow(/no coincide/);
    expect(() => assertEnvasadoDeliveryBoxes({ finishedQty: 1000, sampleUnits: null, packingGroups: [{ cajas: 9, unidadesPorCaja: 100 }], observation: "faltante justificado" })).not.toThrow();
    expect(assertEnvasadoDeliveryBoxes({ finishedQty: 1000, sampleUnits: null, packingGroups: [{ cajas: 10, unidadesPorCaja: 100 }], observation: "" }).packedUnits).toBe(1000);
  });
});

describe("permisos de entrega por sector (cliente)", () => {
  it("Producción/Dirección/Envasado/Codificado sí; Elaboración y Calidad no", () => {
    for (const s of ["PRODUCCION", "DIRECCION", "ENVASADO_MASIVO", "ENVASADO_PREMIUM", "CODIFICADO"]) expect(canDeliverWork(s)).toBe(true);
    expect(canDeliverWork("ELABORACION")).toBe(false);
    expect(canDeliverWork("CALIDAD")).toBe(false);
    expect(validateDeliverWorkActor("ELABORACION").ok).toBe(false);
    expect(validateDeliverWorkActor("").ok).toBe(false);
  });
});
