import { describe, expect, it } from "vitest";
import { planPartialDelivery, resolveDeliveryTarget } from "./delivery-math";

const base = { assigned: 2000, unit: "un." };

describe("planPartialDelivery (saldo = asignada − entregado)", () => {
  it("2.000 u.: 1.000 → 600 → 400; solo se completa al llegar a lo asignado", () => {
    const a = planPartialDelivery({ ...base, alreadyDelivered: 0, produced: 1000, requested: 1000 });
    expect(a).toMatchObject({ ok: true, quantity: 1000, cumulative: 1000, pending: 1000, complete: false });
    const b = planPartialDelivery({ ...base, alreadyDelivered: 1000, produced: 1600, requested: 600 });
    expect(b).toMatchObject({ ok: true, cumulative: 1600, pending: 400, complete: false });
    const c = planPartialDelivery({ ...base, alreadyDelivered: 1600, produced: 2000, requested: 400 });
    expect(c).toMatchObject({ ok: true, cumulative: 2000, pending: 0, complete: true });
  });

  it("no cierra el trabajo aunque lo terminado sea menos que lo asignado (entregar todo lo producido ≠ completar)", () => {
    const r = planPartialDelivery({ ...base, alreadyDelivered: 0, produced: 1000, requested: 1000 });
    expect(r.ok && r.complete).toBe(false);
  });

  it("rechaza cantidad no positiva, no entera (unidades) y mayor al saldo", () => {
    expect(planPartialDelivery({ ...base, alreadyDelivered: 0, produced: null, requested: 0 }).ok).toBe(false);
    expect(planPartialDelivery({ ...base, alreadyDelivered: 0, produced: null, requested: -3 }).ok).toBe(false);
    expect(planPartialDelivery({ ...base, alreadyDelivered: 0, produced: null, requested: null }).ok).toBe(false);
    expect(planPartialDelivery({ ...base, alreadyDelivered: 0, produced: null, requested: 10.5 })).toMatchObject({ ok: false, code: "INVALID_QUANTITY" });
    expect(planPartialDelivery({ ...base, alreadyDelivered: 1500, produced: null, requested: 600 })).toMatchObject({ ok: false, code: "EXCEEDS_BALANCE" });
  });

  it("no entrega más de lo terminado y todavía no entregado (cuando hay dato); sin dato no limita", () => {
    expect(planPartialDelivery({ ...base, alreadyDelivered: 0, produced: 800, requested: 1000 })).toMatchObject({ ok: false, code: "EXCEEDS_AVAILABLE" });
    expect(planPartialDelivery({ ...base, alreadyDelivered: 800, produced: 800, requested: 1 })).toMatchObject({ ok: false, code: "EXCEEDS_AVAILABLE" });
    expect(planPartialDelivery({ ...base, alreadyDelivered: 0, produced: null, requested: 1000 }).ok).toBe(true);
    expect(planPartialDelivery({ ...base, alreadyDelivered: 0, produced: 0, requested: 1000 }).ok).toBe(true);
  });

  it("más de lo pedido: con 2.050 realizadas se entregan 2.050 (1.000 + 800 + 250) sin excedente, sin pendiente negativo", () => {
    expect(planPartialDelivery({ ...base, alreadyDelivered: 0, produced: 2050, requested: 2050 })).toMatchObject({ ok: true, quantity: 2050, cumulative: 2050, pending: 0, complete: true });
    expect(planPartialDelivery({ ...base, alreadyDelivered: 0, produced: 2050, requested: 1000 })).toMatchObject({ ok: true, pending: 1050, complete: false });
    expect(planPartialDelivery({ ...base, alreadyDelivered: 1000, produced: 2050, requested: 800 })).toMatchObject({ ok: true, pending: 250, complete: false });
    expect(planPartialDelivery({ ...base, alreadyDelivered: 1800, produced: 2050, requested: 250 })).toMatchObject({ ok: true, cumulative: 2050, pending: 0, complete: true });
    expect(planPartialDelivery({ ...base, alreadyDelivered: 1800, produced: 2050, requested: 251 })).toMatchObject({ ok: false, code: "EXCEEDS_AVAILABLE" });
  });

  it("sin dato de realizadas la asignada es la referencia (no se inventan unidades)", () => {
    expect(planPartialDelivery({ ...base, alreadyDelivered: 0, produced: null, requested: 2050 })).toMatchObject({ ok: false, code: "EXCEEDS_BALANCE", error: expect.stringContaining("registralas primero como realizadas") });
  });

  it("sin saldo pendiente no admite más entregas", () => {
    expect(planPartialDelivery({ ...base, alreadyDelivered: 2000, produced: 2000, requested: 1 })).toMatchObject({ ok: false, code: "NOTHING_PENDING" });
  });

  it("unidades decimales (kg) aceptan fracciones", () => {
    const r = planPartialDelivery({ assigned: 100, unit: "kg", alreadyDelivered: 0, produced: 40.5, requested: 40.5 });
    expect(r).toMatchObject({ ok: true, pending: 59.5, complete: false });
  });
});

describe("cantidad solicitada = referencia, no tope (1.200 pedidas, 1.235 realizadas)", () => {
  const b = { assigned: 1200, unit: "un." };
  it("605 + 630: el acumulado llega a 1.235, completa y el pendiente nunca es negativo", () => {
    const a = planPartialDelivery({ ...b, alreadyDelivered: 0, produced: 1235, requested: 605 });
    expect(a).toMatchObject({ ok: true, cumulative: 605, pending: 630, complete: false });
    const c = planPartialDelivery({ ...b, alreadyDelivered: 605, produced: 1235, requested: 630 });
    expect(c).toMatchObject({ ok: true, cumulative: 1235, pending: 0, complete: true });
  });
  it("entregadas 1.200 de 1.235: quedan 35 reales (no completa) y se pueden entregar", () => {
    const a = planPartialDelivery({ ...b, alreadyDelivered: 0, produced: 1235, requested: 1200 });
    expect(a).toMatchObject({ ok: true, pending: 35, complete: false });
    expect(planPartialDelivery({ ...b, alreadyDelivered: 1200, produced: 1235, requested: 35 })).toMatchObject({ ok: true, pending: 0, complete: true });
    expect(planPartialDelivery({ ...b, alreadyDelivered: 1200, produced: 1235, requested: 36 }).ok).toBe(false);
  });
  it("sin sobreproducción todo sigue igual", () => {
    expect(planPartialDelivery({ ...b, alreadyDelivered: 0, produced: 800, requested: 800 })).toMatchObject({ pending: 400, complete: false });
    expect(planPartialDelivery({ ...b, alreadyDelivered: 800, produced: 1200, requested: 400 })).toMatchObject({ pending: 0, complete: true });
  });
  it("el objetivo de una entrega total es lo MAYOR entre lo declarado y lo realizado: nunca se recorta a lo pedido", () => {
    expect(resolveDeliveryTarget({ unit: "un.", packagingTotalUnits: 1200, finishedQty: "1235", plannedQuantity: "1200" })).toBe(1235);
    expect(resolveDeliveryTarget({ unit: "un.", packagingTotalUnits: 1200, finishedQty: "1100", plannedQuantity: "1200" })).toBe(1200);
    expect(resolveDeliveryTarget({ unit: "kg", finishedQty: "70", plannedQuantity: "60" })).toBe(70);
  });
});
