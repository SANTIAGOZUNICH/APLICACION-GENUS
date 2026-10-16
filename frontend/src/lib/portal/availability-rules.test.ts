import { describe, expect, it } from "vitest";
import { canActorMark, canActorRetract, canRetractMark, checkRequestedQuantity, evaluateAvailability, type AvailabilityInput } from "./availability-rules";

const base = (over: Partial<AvailabilityInput> = {}): AvailabilityInput => ({
  sector: "ENVASADO_MASIVO", status: "en_curso", unit: "un.", plannedQuantity: "5000", finishedQty: null, deliverableUnits: null,
  packagingTotalUnits: null, deleted: false, cancelled: false, delivered: 0, marked: 0, markBase: null, ...over,
});

describe("quién puede marcar «Listo para entregar»", () => {
  it("Envasado Masivo y Premium marcan SUS trabajos; Codificado los suyos", () => {
    expect(canActorMark("ENVASADO_MASIVO", "ENVASADO_MASIVO")).toBe(true);
    expect(canActorMark("ENVASADO_PREMIUM", "ENVASADO_PREMIUM")).toBe(true);
    expect(canActorMark("CODIFICADO", "CODIFICADO")).toBe(true);
  });
  it("tras enviar a Codificado el trabajo es de Codificado: Envasado ya no puede marcarlo", () => {
    expect(canActorMark("ENVASADO_MASIVO", "CODIFICADO")).toBe(false);
    expect(canActorMark("ENVASADO_PREMIUM", "CODIFICADO")).toBe(false);
  });
  it("un sector no marca el trabajo de otro, ni Elaboración, ni Producción/Dirección/Depósito/Calidad", () => {
    expect(canActorMark("ENVASADO_MASIVO", "ENVASADO_PREMIUM")).toBe(false);
    expect(canActorMark("CODIFICADO", "ENVASADO_MASIVO")).toBe(false);
    expect(canActorMark("ELABORACION", "ELABORACION")).toBe(false);
    for (const s of ["PRODUCCION", "DIRECCION", "DEPOSITO", "CALIDAD", "MATERIA_PRIMA", "", null, undefined]) expect(canActorMark(s, "ENVASADO_MASIVO")).toBe(false);
  });
  it("rectificar: Producción, Dirección o el sector que confirmó", () => {
    expect(canActorRetract("PRODUCCION", "CODIFICADO")).toBe(true);
    expect(canActorRetract("DIRECCION", "ENVASADO_MASIVO")).toBe(true);
    expect(canActorRetract("CODIFICADO", "CODIFICADO")).toBe(true);
    expect(canActorRetract("ENVASADO_MASIVO", "CODIFICADO")).toBe(false);
    expect(canActorRetract("DEPOSITO", "CODIFICADO")).toBe(false);
  });
});

describe("cantidades disponibles", () => {
  it("trabajo terminado, sin marcas: se puede marcar todo lo entregable", () => {
    const ev = evaluateAvailability(base({ status: "revision", finishedQty: "5000" }));
    expect(ev).toMatchObject({ produced: 5000, maxQuantity: 5000, available: 0, block: null });
  });
  it("trabajo EN CURSO: solo lo informado en «Guardar avance» (2.000 de 5.000)", () => {
    const ev = evaluateAvailability(base({ finishedQty: "2000" }));
    expect(ev).toMatchObject({ produced: 2000, maxQuantity: 2000, block: null });
  });
  it("en curso sin avance informado: no hay evidencia → bloqueado, nunca se inventa la cantidad", () => {
    expect(evaluateAvailability(base()).block).toBe("SIN_CANTIDAD_TERMINADA");
    expect(evaluateAvailability(base({ finishedQty: "0" })).block).toBe("SIN_CANTIDAD_TERMINADA");
    expect(evaluateAvailability(base({ finishedQty: "abc" })).block).toBe("SIN_CANTIDAD_TERMINADA");
  });
  it("nueva disponibilidad: 2.000 ya marcadas, terminan 3.000 más → se pueden marcar solo las 3.000 nuevas", () => {
    expect(evaluateAvailability(base({ finishedQty: "2000", marked: 2000 })).block).toBe("NADA_PENDIENTE_DE_MARCAR");
    const ev = evaluateAvailability(base({ status: "revision", finishedQty: "5000", marked: 2000 }));
    expect(ev).toMatchObject({ maxQuantity: 3000, available: 2000 });
  });
  it("lo entregado cuenta como cubierto: nunca se vuelve a ofrecer", () => {
    const ev = evaluateAvailability(base({ status: "revision", finishedQty: "5000", marked: 2000, markBase: 0, delivered: 2000 }));
    expect(ev).toMatchObject({ maxQuantity: 3000, available: 0 });
    // entregado sin marca previa (circuito anterior): tampoco se marca de nuevo lo ya entregado
    expect(evaluateAvailability(base({ status: "revision", finishedQty: "5000", delivered: 2000 })).maxQuantity).toBe(3000);
  });
  it("entregas ANTERIORES a la primera confirmación (trabajos históricos) no se vuelven «disponibles»", () => {
    // 2.000 ya entregadas antes; el sector confirma las 3.000 restantes → 3.000 disponibles (no 1.000)
    const before = evaluateAvailability(base({ status: "revision", finishedQty: "5000", delivered: 2000, markBase: null }));
    expect(before).toMatchObject({ maxQuantity: 3000, available: 0 });
    const after = evaluateAvailability(base({ status: "revision", finishedQty: "5000", delivered: 2000, marked: 3000, markBase: 2000 }));
    expect(after).toMatchObject({ maxQuantity: 0, available: 3000 });
    // luego se entregan 1.000 más → quedan 2.000 disponibles
    expect(evaluateAvailability(base({ status: "revision", finishedQty: "5000", delivered: 3000, marked: 3000, markBase: 2000 })).available).toBe(2000);
  });
  it("trabajos entregados, cancelados, borrados o de otro sector: bloqueados", () => {
    expect(evaluateAvailability(base({ status: "entregado", finishedQty: "5000", delivered: 5000 })).block).toBe("ENTREGADO");
    expect(evaluateAvailability(base({ cancelled: true, finishedQty: "100" })).block).toBe("CANCELADO");
    expect(evaluateAvailability(base({ deleted: true, finishedQty: "100" })).block).toBe("BORRADO");
    expect(evaluateAvailability(base({ sector: "ELABORACION", status: "revision" })).block).toBe("SECTOR_NO_APLICA");
  });
  it("usa lo embalado (entregable) antes que lo planificado y nunca supera lo que falta entregar", () => {
    const ev = evaluateAvailability(base({ status: "revision", deliverableUnits: 4800, finishedQty: "4950" }));
    expect(ev.maxQuantity).toBe(4800);
    // en curso con un avance mayor al total: se limita al total del trabajo
    expect(evaluateAvailability(base({ plannedQuantity: "1000", finishedQty: "1200", deliverableUnits: 1000 })).maxQuantity).toBe(1000);
  });
  it("unidades enteras: se redondea hacia abajo; kg admiten decimales", () => {
    expect(evaluateAvailability(base({ status: "revision", finishedQty: "10", plannedQuantity: "10" })).maxQuantity).toBe(10);
    expect(evaluateAvailability(base({ unit: "kg", status: "revision", plannedQuantity: "12,5", finishedQty: "12,5" })).maxQuantity).toBeCloseTo(12.5);
  });
});

describe("validación de la cantidad pedida", () => {
  const ev = evaluateAvailability(base({ finishedQty: "2000" }));
  it("sin cantidad = todo lo marcable", () => expect(checkRequestedQuantity(undefined, ev, "un.")).toEqual({ ok: true, quantity: 2000 }));
  it("parcial válida", () => expect(checkRequestedQuantity(500, ev, "un.")).toEqual({ ok: true, quantity: 500 }));
  it("rechaza cero, negativas, no numéricas y fraccionarias en unidades enteras", () => {
    for (const bad of [0, -5, "x", NaN, Infinity, 1.5]) expect(checkRequestedQuantity(bad, ev, "un.")).toMatchObject({ ok: false, code: "INVALID" });
  });
  it("rechaza más de lo terminado y no marcado", () => expect(checkRequestedQuantity(2001, ev, "un.")).toMatchObject({ ok: false, code: "EXCEEDS" }));
});

describe("rectificación", () => {
  const marks = [{ id: "m1", quantity: 2000 }, { id: "m2", quantity: 3000 }];
  it("sin entregas se puede retirar cualquier marca", () => {
    expect(canRetractMark(marks, "m1", 0)).toBe(true);
    expect(canRetractMark(marks, "m2", 0)).toBe(true);
  });
  it("lo entregado consume primero las marcas más antiguas: la entregada no se puede retirar, la nueva sí", () => {
    expect(canRetractMark(marks, "m1", 2000)).toBe(false);
    expect(canRetractMark(marks, "m2", 2000)).toBe(true);
    expect(canRetractMark(marks, "m2", 2500)).toBe(false); // entrega parcial ya tocó a la segunda
    expect(canRetractMark(marks, "m2", 5000)).toBe(false);
  });
  it("una marca desconocida no se puede retirar", () => expect(canRetractMark(marks, "zz", 0)).toBe(false));
});
