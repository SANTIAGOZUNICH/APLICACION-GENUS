import { describe, expect, it } from "vitest";
import {
  computeWorkDivergences,
  coverageOf,
  deriveDeliveryStatus,
  deriveItemStatus,
  groupDeliveriesByClient,
  itemQuantities,
  matchDeliveryCandidates,
  parseQuantity,
  snapshotOf,
  summarizeRealDeliveries,
  validateDeliveryInput,
  validateReason,
  optionalReason,
} from "./rules";
import type { LinkedWork, ScheduledDelivery, ScheduledDeliveryItem } from "./types";

const work = (o: Partial<LinkedWork> = {}): LinkedWork => ({
  linkId: "l", workItemId: "w", linkedAt: "2026-10-01T00:00:00.000Z", linkedBy: "p@x", client: "FIRMEA", product: "CREMA", sector: "ENVASADO_MASIVO",
  line: "Línea 1", plannedDate: "2026-10-10", plannedDateTo: null, plannedQuantity: "1000", unit: "un.", deliveryDate: "2026-10-20",
  packagingLote: null, packagingVto: null, operationalStatus: "pendiente", finishedQty: null, orderNumber: null, responsible: "Línea 1", notes: null, completedAt: null,
  realDeliveries: [], deliveredQty: null, deliveredAt: null, delivered: false, cancelled: false, snapshot: {}, ...o,
});
const item = (o: Partial<ScheduledDeliveryItem> = {}): ScheduledDeliveryItem => ({
  id: "i1", deliveryId: "d1", product: "CREMA ACLARANTE", quantity: "1000", unit: "un.", sector: "ENVASADO_MASIVO", plannedProductionDate: null,
  lot: null, vto: null, notes: null, position: 0, version: 1, createdAt: "", updatedAt: "", works: [], status: "programada", ...o,
});
const delivery = (o: Partial<ScheduledDelivery> = {}): ScheduledDelivery => ({
  id: "d1", client: "FIRMEA", deliveryDate: "2026-10-20", responsible: null, notes: null, state: "programada", rescheduleCount: 0, version: 1,
  cancelledAt: null, cancelledBy: null, cancelReason: null, createdBy: "p@x", createdAt: "", updatedAt: "", items: [item()], status: "programada", ...o,
});

describe("validateDeliveryInput", () => {
  const base = { client: "FIRMEA", deliveryDate: "2026-10-15", items: [{ product: "CREMA" }] };
  it("acepta una entrega con datos pendientes (sin cantidad, lote, sector…): nada se inventa", () => {
    const r = validateDeliveryInput(base);
    expect(r.ok && r.value.items[0]).toMatchObject({ product: "CREMA", quantity: null, unit: null, sector: null, lot: null, vto: null, plannedProductionDate: null });
  });
  it("admite varios productos con cantidades es-AR", () => {
    const r = validateDeliveryInput({ ...base, items: [{ product: "A", quantity: "1.200", unit: "un." }, { product: "B", quantity: "50,5", sector: "ENVASADO_PREMIUM" }] });
    expect(r.ok && r.value.items.map((i) => i.quantity)).toEqual(["1.200", "50,5"]);
  });
  it.each([
    [{ ...base, client: " " }, /cliente/i],
    [{ ...base, deliveryDate: "31/02/2026" }, /fecha de entrega/i],
    [{ ...base, deliveryDate: "2026-02-31" }, /fecha de entrega/i],
    [{ ...base, items: [] }, /al menos un producto/i],
    [{ ...base, items: [{ product: "" }] }, /nombre es obligatorio/i],
    [{ ...base, items: [{ product: "A", quantity: "abc" }] }, /cantidad/i],
    [{ ...base, items: [{ product: "A", sector: "CALIDAD" }] }, /sector/i],
    [{ ...base, items: [{ product: "A", plannedProductionDate: "mañana" }] }, /fecha de producción/i],
  ])("rechaza %#", (input, msg) => {
    const r = validateDeliveryInput(input as never);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.message).toMatch(msg);
  });
});

describe("parseQuantity", () => {
  it.each([["1.200", 1200], ["1200", 1200], ["50,5", 50.5], ["", null], [null, null]])("%s", (raw, n) => expect(parseQuantity(raw as never)).toBe(n));
  it("inválida → undefined", () => expect(parseQuantity("12x")).toBeUndefined());
});

describe("estados derivados", () => {
  it("sin trabajos: Entrega programada", () => expect(deriveItemStatus(item())).toBe("programada"));
  it("trabajo pendiente → Producción pendiente; en curso → en proceso", () => {
    expect(deriveItemStatus(item({ works: [work()] }))).toBe("produccion_pendiente");
    expect(deriveItemStatus(item({ works: [work({ operationalStatus: "en_curso" })] }))).toBe("produccion_en_proceso");
  });
  it("SIN Calidad en el circuito: trabajo terminado y no entregado = «Lista para entregar» (no depende de qualityStatus)", () => {
    for (const st of ["completo", "revision", "entregado", "codificado_completo"]) {
      expect(deriveItemStatus(item({ works: [work({ operationalStatus: st })] }))).toBe("lista_para_entregar");
    }
    // Un trabajo en curso o pendiente todavía no está listo.
    expect(deriveItemStatus(item({ works: [work({ operationalStatus: "en_curso" })] }))).toBe("produccion_en_proceso");
    expect(deriveItemStatus(item({ works: [work({ operationalStatus: "bloqueado" })] }))).toBe("produccion_pendiente");
  });
  it("«Entregada» solo con la entrega REAL registrada y completa", () => {
    expect(deriveItemStatus(item({ works: [work({ operationalStatus: "completo", delivered: true, deliveredQty: 1000 })] }))).toBe("entregada");
  });
  it("entrega parcial: se entregó parte y queda saldo → «Entrega parcial», nunca «Entregada»", () => {
    // Un trabajo con entrega real que no completa lo producido.
    expect(deriveItemStatus(item({ works: [work({ operationalStatus: "entregado", delivered: false, deliveredQty: 400, realDeliveries: [{ id: "r", date: "2026-10-10", quantity: "400", unit: "un.", remito: null, receivedBy: null, lote: null, vto: null, observations: null }] })] }))).toBe("entrega_parcial");
    // Varios trabajos: uno entregado y el otro no.
    const a = work({ linkId: "a", plannedQuantity: "600", operationalStatus: "completo", delivered: true, deliveredQty: 600 });
    const b = work({ linkId: "b", workItemId: "w2", plannedQuantity: "400", operationalStatus: "completo", delivered: false });
    expect(deriveItemStatus(item({ works: [a, b] }))).toBe("entrega_parcial");
    expect(deriveItemStatus(item({ works: [a, { ...b, delivered: true, deliveredQty: 400 }] }))).toBe("entregada");
  });
  it("cantidad cubierta a medias: aunque lo cubierto esté entregado NO es «Entregada» (faltan trabajos): es parcial; sin entregas, nunca pasa de «en proceso»", () => {
    const w = work({ plannedQuantity: "400", operationalStatus: "completo", delivered: true, deliveredQty: 400 });
    expect(deriveItemStatus(item({ quantity: "1000", works: [w] }))).toBe("entrega_parcial");
    expect(deriveItemStatus(item({ quantity: "1000", works: [work({ plannedQuantity: "400", operationalStatus: "completo" })] }))).toBe("produccion_en_proceso");
    expect(deriveItemStatus(item({ quantity: "1000", works: [work({ plannedQuantity: "400" })] }))).toBe("produccion_pendiente");
  });
  it("trabajos cancelados no cuentan", () => {
    expect(deriveItemStatus(item({ works: [work({ cancelled: true, operationalStatus: "completo" })] }))).toBe("programada");
  });
  it("la entrega toma la etapa MÁS ATRASADA de sus productos; cancelada manda", () => {
    const a = item({ id: "a", status: "lista_para_entregar" });
    const b = item({ id: "b", status: "produccion_en_proceso" });
    expect(deriveDeliveryStatus({ state: "programada", items: [a, b] })).toBe("produccion_en_proceso");
    expect(deriveDeliveryStatus({ state: "cancelada", items: [a] })).toBe("cancelada");
    expect(deriveDeliveryStatus({ state: "programada", items: [{ ...a, status: "entregada" }] })).toBe("entregada");
  });
});

describe("matchDeliveryCandidates", () => {
  const d1 = delivery({ id: "d1", client: "FIRMEA", items: [item({ id: "i1", product: "CREMA ACLARANTE" }), item({ id: "i2", product: "SERUM FACIAL VITAMINA C", sector: "ENVASADO_PREMIUM" })] });
  const d2 = delivery({ id: "d2", client: "CAV", deliveryDate: "2026-10-22", items: [item({ id: "i3", product: "CREMA ACLARANTE" })] });
  const d3 = delivery({ id: "d3", client: "FIRMEA", deliveryDate: "2026-11-05", items: [item({ id: "i4", product: "CREMA ACLARANTE" })] });
  const cancelled = delivery({ id: "d4", client: "FIRMEA", state: "cancelada", items: [item({ id: "i5", product: "CREMA ACLARANTE" })] });

  it("muestra TODAS las entregas del cliente y producto (varias coincidencias), la más próxima primero", () => {
    const r = matchDeliveryCandidates([d3, d1, d2, cancelled], { client: "Firmea", product: "crema aclarante", sector: "ENVASADO_MASIVO" });
    expect(r.map((x) => x.itemId)).toEqual(["i1", "i4"]);
    expect(r.every((x) => x.match === "exacta")).toBe(true);
  });
  it("respeta el sector y no mezcla clientes ni entregas canceladas", () => {
    expect(matchDeliveryCandidates([d1], { client: "FIRMEA", product: "SERUM FACIAL VITAMINA C", sector: "ENVASADO_MASIVO" })).toEqual([]);
    expect(matchDeliveryCandidates([d1], { client: "FIRMEA", product: "SERUM FACIAL VITAMINA C", sector: "ENVASADO_PREMIUM" })).toHaveLength(1);
    expect(matchDeliveryCandidates([d2], { client: "FIRMEA", product: "CREMA ACLARANTE", sector: null })).toEqual([]);
    expect(matchDeliveryCandidates([cancelled], { client: "FIRMEA", product: "CREMA ACLARANTE", sector: null })).toEqual([]);
  });
  it("un producto sin sector definido sirve para cualquiera de los dos", () => {
    const free = delivery({ items: [item({ id: "x", sector: null })] });
    expect(matchDeliveryCandidates([free], { client: "FIRMEA", product: "CREMA ACLARANTE", sector: "ENVASADO_PREMIUM" })).toHaveLength(1);
  });
  it("sin cliente o producto no sugiere nada", () => {
    expect(matchDeliveryCandidates([d1], { client: "", product: "CREMA", sector: null })).toEqual([]);
  });
  it("un producto ya cubierto sigue disponible (una entrega se completa con varios trabajos) e indica lo cubierto", () => {
    const covered = delivery({ items: [item({ id: "c", works: [work({ plannedQuantity: "400" })] })] });
    const r = matchDeliveryCandidates([covered], { client: "FIRMEA", product: "CREMA ACLARANTE", sector: null });
    expect(r[0]).toMatchObject({ linkedWorks: 1, coveredQuantity: 400 });
  });
});

describe("computeWorkDivergences (solo lo que cambió DESPUÉS de asignar)", () => {
  const d = { deliveryDate: "2026-10-25" };
  const snap = { plannedQuantity: "1000", unit: "un.", deliveryDate: "2026-10-20", packagingLote: "L1", packagingVto: null as string | null };
  it("informa lo que la entrega cambió desde la asignación y el trabajo todavía no tiene; nunca la cantidad realizada ni lo pendiente", () => {
    const out = computeWorkDivergences(d, { quantity: "1.500", unit: "un.", lot: "L9", vto: null }, work({ plannedQuantity: "1000", deliveryDate: "2026-10-20", packagingLote: "L1", packagingVto: "10/2028", finishedQty: "900", snapshot: snap }));
    expect(out.map((x) => x.field)).toEqual(["plannedQuantity", "deliveryDate", "packagingLote"]);
    expect(out.some((x) => x.field === "packagingVto")).toBe(false); // la entrega no tiene VTO: no pisa
    expect(out.some((x) => (x.field as string) === "finishedQty")).toBe(false);
  });
  it("sin cambios desde la asignación → vacío, aunque el trabajo difiera por una edición manual del operario", () => {
    const out = computeWorkDivergences({ deliveryDate: "2026-10-20" }, { quantity: "1000", unit: "un.", lot: "L1", vto: null }, work({ plannedQuantity: "800", packagingLote: "L-OPERARIO", deliveryDate: "2026-10-20", snapshot: snap }));
    expect(out).toEqual([]);
  });
  it("un trabajo que cubre solo una parte (varios trabajos) NO genera falsa alarma de cantidad", () => {
    const out = computeWorkDivergences({ deliveryDate: "2026-10-20" }, { quantity: "1.500", unit: "un.", lot: "L1", vto: null }, work({ plannedQuantity: "700", snapshot: { ...snap, plannedQuantity: "1200" } }), 2);
    expect(out.find((x) => x.field === "plannedQuantity")).toBeUndefined();
  });
  it("si el trabajo ya tiene el valor nuevo no avisa; el mismo número en otro formato tampoco", () => {
    expect(computeWorkDivergences(d, { quantity: "1.000", unit: "UN.", lot: "L1", vto: null }, work({ plannedQuantity: "1000", unit: "un.", deliveryDate: "2026-10-25", snapshot: { ...snap, plannedQuantity: "900" } }))).toEqual([]);
  });
  it("sin foto previa (vínculo antiguo) se compara contra el trabajo", () => {
    const out = computeWorkDivergences(d, { quantity: null, unit: null, lot: null, vto: null }, work({ deliveryDate: "2026-10-20", snapshot: {} }));
    expect(out.map((x) => x.field)).toEqual(["deliveryDate"]);
  });
});

describe("snapshotOf y coverageOf", () => {
  it("la foto guarda lo programado en ese momento", () => {
    expect(snapshotOf({ deliveryDate: "2026-10-20" }, { quantity: "1.200", unit: "un.", lot: "L1", vto: "10/2028" })).toEqual({ plannedQuantity: "1.200", unit: "un.", deliveryDate: "2026-10-20", packagingLote: "L1", packagingVto: "10/2028" });
  });
  it("cobertura de la cantidad con varios trabajos (los cancelados no suman)", () => {
    const it = item({ quantity: "1.500", works: [work({ plannedQuantity: "700" }), work({ linkId: "b", plannedQuantity: "500" }), work({ linkId: "c", plannedQuantity: "300", cancelled: true })] });
    expect(coverageOf(it)).toEqual({ target: 1500, covered: 1200, missing: 300 });
    expect(coverageOf(item({ quantity: null, works: [work()] })).missing).toBeNull();
  });
});

describe("validateReason y agrupación por cliente", () => {
  it("bajas lógicas: motivo obligatorio sin largo mínimo arbitrario; fechas: motivo opcional (nunca inventado)", () => {
    expect(validateReason("x").ok).toBe(true);
    expect(validateReason("   ").ok).toBe(false);
    expect(validateReason(undefined).ok).toBe(false);
    expect(optionalReason(undefined)).toEqual({ ok: true, value: null });
    expect(optionalReason("  ")).toEqual({ ok: true, value: null });
    expect(optionalReason(" completado ")).toEqual({ ok: true, value: "completado" });
    expect(validateReason("  Cliente pidió otra fecha  ")).toEqual({ ok: true, value: "Cliente pidió otra fecha" });
  });
  it("un cliente con varias entregas el mismo día aparece UNA vez", () => {
    const g = groupDeliveriesByClient([delivery({ id: "a", client: "FIRMEA" }), delivery({ id: "b", client: "firmea " }), delivery({ id: "c", client: "CAV" }), delivery({ id: "d", client: "TSU" })]);
    expect(g.map((x) => x.client)).toEqual(["CAV", "FIRMEA", "TSU"]);
    expect(g.find((x) => x.client === "FIRMEA")!.deliveries).toHaveLength(2);
  });
});

describe("summarizeRealDeliveries (fecha real y cantidad entregada)", () => {
  const ev = (o: Partial<LinkedWork["realDeliveries"][number]> = {}) => ({ id: "r1", date: "2026-10-12", quantity: "1000", unit: "un.", remito: null, receivedBy: null, lote: null, vto: null, observations: null, ...o });
  it("sin entregas reales: no entregado y sin fecha", () => {
    expect(summarizeRealDeliveries({ plannedQuantity: "1000", finishedQty: null, realDeliveries: [] })).toEqual({ deliveredQty: null, deliveredAt: null, delivered: false });
  });
  it("completa cuando lo entregado alcanza lo embalado / producido / planificado (en ese orden)", () => {
    expect(summarizeRealDeliveries({ plannedQuantity: "1000", finishedQty: "980", realDeliveries: [ev({ quantity: "980" })] }).delivered).toBe(true);
    expect(summarizeRealDeliveries({ plannedQuantity: "1000", finishedQty: null, deliverableUnits: 960, realDeliveries: [ev({ quantity: "960" })] }).delivered).toBe(true);
    const part = summarizeRealDeliveries({ plannedQuantity: "1000", finishedQty: null, realDeliveries: [ev({ quantity: "400" })] });
    expect(part).toEqual({ deliveredQty: 400, deliveredAt: "2026-10-12", delivered: false });
  });
  it("varias entregas se suman y la fecha es la última", () => {
    const r = summarizeRealDeliveries({ plannedQuantity: "1000", finishedQty: null, realDeliveries: [ev({ id: "a", date: "2026-10-05", quantity: "400" }), ev({ id: "b", date: "2026-10-09", quantity: "600" })] });
    expect(r).toEqual({ deliveredQty: 1000, deliveredAt: "2026-10-09", delivered: true });
  });
  it("cantidades no numéricas: cualquier entrega real cuenta como completa (no se puede comparar)", () => {
    expect(summarizeRealDeliveries({ plannedQuantity: "a convenir", finishedQty: null, realDeliveries: [ev({ quantity: null })] }).delivered).toBe(true);
  });
});

describe("itemQuantities", () => {
  it("planificada, producida, entregada y pendiente; faltantes quedan en null", () => {
    const w = work({ plannedQuantity: "1000", finishedQty: "950", deliveredQty: 400 });
    expect(itemQuantities(item({ quantity: "1000", works: [w] }))).toEqual({ planned: 1000, produced: 950, delivered: 400, pending: 600 });
    expect(itemQuantities(item({ quantity: null, works: [] }))).toEqual({ planned: null, produced: null, delivered: null, pending: null });
    // Sin cantidad en el producto: se toma lo planificado en los trabajos.
    expect(itemQuantities(item({ quantity: null, works: [work({ plannedQuantity: "300" }), work({ linkId: "b", plannedQuantity: "200" })] })).planned).toBe(500);
  });
});

describe("entrega INAMOVIBLE", () => {
  const base = { client: "Cliente SA", deliveryDate: "2026-11-05", items: [{ product: "Shampoo", quantity: "10" }] } as never;
  it("por defecto NO es inamovible y se conserva el valor marcado", () => {
    const a = validateDeliveryInput(base);
    expect(a.ok && a.value.isImmovable).toBe(false);
    const b = validateDeliveryInput({ ...(base as object), isImmovable: true } as never);
    expect(b.ok && b.value.isImmovable).toBe(true);
    const c = validateDeliveryInput({ ...(base as object), isImmovable: "si" } as never);
    expect(c.ok && c.value.isImmovable).toBe(false); // solo `true` marca; no cambia fechas ni cantidades
    expect(b.ok && b.value.deliveryDate).toBe("2026-11-05");
  });
});
