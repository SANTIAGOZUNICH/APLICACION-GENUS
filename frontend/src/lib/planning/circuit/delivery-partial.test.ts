import { describe, expect, it } from "vitest";
import { planPartialDelivery } from "./delivery-math";

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

  it("sin saldo pendiente no admite más entregas", () => {
    expect(planPartialDelivery({ ...base, alreadyDelivered: 2000, produced: 2000, requested: 1 })).toMatchObject({ ok: false, code: "NOTHING_PENDING" });
  });

  it("unidades decimales (kg) aceptan fracciones", () => {
    const r = planPartialDelivery({ assigned: 100, unit: "kg", alreadyDelivered: 0, produced: 40.5, requested: 40.5 });
    expect(r).toMatchObject({ ok: true, pending: 59.5, complete: false });
  });
});
