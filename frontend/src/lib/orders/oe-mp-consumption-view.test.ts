import { describe, expect, it } from "vitest";
import { emptyOeMaterial } from "@/lib/orders/content";
import { buildConsumptionView, fmtKg } from "@/lib/orders/oe-mp-consumption-view";

describe("fmtKg", () => {
  it("signo negativo explícito, unidad y formato es-AR; null → —", () => {
    expect(fmtKg(-5, { signed: true })).toBe("-5 kg");
    expect(fmtKg(2.5, { signed: true })).toBe("+2,5 kg");
    expect(fmtKg(-0.125)).toBe("-0,125 kg");
    expect(fmtKg(0)).toBe("0 kg");
    expect(fmtKg(null)).toBe("—");
  });
});

describe("buildConsumptionView", () => {
  const report = [
    { codigo: "MP-001", lote: "L01", consumido: 5, stockAntes: 20, stockDespues: 15, negativo: false, ultimoAt: "2026-10-28T10:00:00Z", actorEmail: "e@x" },
    { codigo: "MP-002", lote: "L02", consumido: 3, stockAntes: 2, stockDespues: -1, negativo: true, ultimoAt: "2026-10-28T10:01:00Z", actorEmail: "e@x" },
  ];
  it("lo descontado es «confirmado» con stock anterior/restante (negativo marcado); lo demás es previsto o pendiente", () => {
    const mats = [
      emptyOeMaterial({ id: "a", materiaPrima: "Glicerina", codigoMp: "MP-001", kgReal: 5, lote: "L01" }),
      emptyOeMaterial({ id: "b", materiaPrima: "Pantenol", codigoMp: "MP-002", kgReal: 3, lote: "L02" }),
      emptyOeMaterial({ id: "c", materiaPrima: "Aloe", codigoMp: "MP-003", kgReal: null, kgAPesar: 7 }),
      emptyOeMaterial({ id: "d", materiaPrima: "Urea", codigoMp: "MP-004", kgReal: 2, lote: "U1" }),
      emptyOeMaterial({ id: "e", materiaPrima: "", codigoMp: "", kgReal: null }),
    ];
    const v = buildConsumptionView(report, mats);
    expect(v.map((r) => [r.codigo, r.estado, r.kg])).toEqual([["MP-001", "confirmado", 5], ["MP-002", "confirmado", 3], ["MP-003", "previsto", 7], ["MP-004", "pendiente", 2]]);
    expect(v[1]).toMatchObject({ materiaPrima: "Pantenol", stockAntes: 2, stockDespues: -1, negativo: true });
    expect(v[0]).toMatchObject({ materiaPrima: "Glicerina", stockAntes: 20, stockDespues: 15, negativo: false });
  });
  it("una MP ya descontada no aparece además como prevista; sin nada que mostrar, vacío", () => {
    const mats = [emptyOeMaterial({ id: "a", materiaPrima: "Glicerina", codigoMp: "mp-001", kgReal: 5 })];
    expect(buildConsumptionView(report.slice(0, 1), mats)).toHaveLength(1);
    expect(buildConsumptionView([], [])).toEqual([]);
  });
});
