import { describe, expect, it } from "vitest";
import { stageCountdown } from "./business-days";
import { buildDemoPayload, DEMO_DELIVERY_KEYS, findDemoDelivery, startWithElapsed } from "./demo-data";

// Fechas variadas: día hábil, fin de semana, lunes tras fin de semana, con feriados cerca (Carnaval, Semana Santa, Navidad).
const NOWS = ["2026-10-14T15:00:00Z", "2026-10-17T15:00:00Z", "2026-10-19T12:00:00Z", "2026-02-17T15:00:00Z", "2026-04-02T15:00:00Z", "2026-12-24T15:00:00Z", "2027-01-04T15:00:00Z"].map((s) => new Date(s));
const byName = (p: ReturnType<typeof buildDemoPayload>, name: string) => p.products.find((x) => x.product === name)!;

describe("modo demostración — datos ficticios", () => {
  it.each(NOWS.map((n) => [n.toISOString(), n] as const))("%s: crema con 8 días hábiles restantes y shampoo con 3, siempre", (_l, now) => {
    const p = buildDemoPayload("s1", now, { confirmations: {} });
    const crema = byName(p, "Crema facial hidratante");
    const shampoo = byName(p, "Shampoo reparador");
    expect(crema.stage).toBe("ELABORACION");
    expect(crema.countdown?.remainingDays).toBe(8);
    expect(shampoo.stage).toBe("ENVASADO");
    expect(shampoo.countdown?.remainingDays).toBe(3);
  });

  it("los seis estados pedidos están presentes", () => {
    const p = buildDemoPayload("s1", new Date("2026-10-14T15:00:00Z"), { confirmations: {} });
    expect(p.products).toHaveLength(6);
    expect(byName(p, "Sérum antiedad").stage).toBe("LISTO");
    expect(byName(p, "Sérum antiedad").quantities.available).toBe(1500);
    const parcial = byName(p, "Acondicionador nutritivo");
    expect(parcial.partialDelivery).toBe(true);
    expect(parcial.quantities).toMatchObject({ requested: 5000, delivered: 2000, available: 1500, pending: 1500 });
    expect(parcial.stage).toBe("ENVASADO");
    const pendiente = byName(p, "Tónico capilar");
    expect(pendiente.stage).toBe("ENTREGADO");
    expect(pendiente.deliveries[0]!.canConfirm).toBe(true);
    const confirmada = byName(p, "Mascarilla nutritiva");
    expect(confirmada.stage).toBe("ENTREGADO");
    expect(confirmada.deliveries[0]!.confirmation).not.toBeNull();
    expect(confirmada.deliveries[0]!.canConfirm).toBe(false);
    expect(p.demo).toBe(true);
    expect(p.summary).toMatchObject({ elaboracion: 1, envasado: 2, listos: 1 });
  });

  it("confirmar una recepción cambia SOLO el estado ficticio de esa entrega", () => {
    const now = new Date("2026-10-14T15:00:00Z");
    const before = buildDemoPayload("s1", now, { confirmations: {} });
    const id = byName(before, "Tónico capilar").deliveries[0]!.id;
    const found = findDemoDelivery("s1", id, now, { confirmations: {} });
    expect(found?.key).toBe(DEMO_DELIVERY_KEYS.pendiente);
    const after = buildDemoPayload("s1", now, { confirmations: { [DEMO_DELIVERY_KEYS.pendiente]: now.toISOString() } });
    expect(byName(after, "Tónico capilar").deliveries[0]!.canConfirm).toBe(false);
    expect(byName(after, "Tónico capilar").deliveries[0]!.confirmation).not.toBeNull();
    // el resto queda igual
    expect(byName(after, "Acondicionador nutritivo").deliveries[0]!.canConfirm).toBe(true);
    expect(after.products.map((p) => p.stage)).toEqual(before.products.map((p) => p.stage));
  });

  it("los ids son opacos y distintos por sesión; no hay ningún id interno real", () => {
    const now = new Date("2026-10-14T15:00:00Z");
    const a = buildDemoPayload("s1", now, { confirmations: {} });
    const b = buildDemoPayload("s2", now, { confirmations: {} });
    expect(a.products[0]!.id).not.toBe(b.products[0]!.id);
    const json = JSON.stringify(a);
    expect(json).not.toMatch(/demo-w\d|demo-p\d|line:demo/);
    expect(findDemoDelivery("s1", "0".repeat(24), now, { confirmations: {} })).toBeNull();
    expect(findDemoDelivery("s2", byName(a, "Tónico capilar").deliveries[0]!.id, now, { confirmations: {} })).toBeNull(); // id de otra sesión
  });

  it("startWithElapsed es coherente con la cuenta regresiva real", () => {
    for (const now of NOWS) {
      for (const total of [10, 5]) {
        const start = startWithElapsed(now, 2);
        expect(stageCountdown(start, now, total)!.remainingDays).toBe(total - 2);
      }
    }
  });
});
