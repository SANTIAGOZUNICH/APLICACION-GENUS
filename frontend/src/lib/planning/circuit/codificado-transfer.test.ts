import { describe, expect, it } from "vitest";
import { canTransferToCodificado, canWorkReceivedCodificado, defaultTransferKey, planCodificadoTransfer, summarizeCodificado } from "./codificado-transfer";

describe("planCodificadoTransfer", () => {
  const base = { assigned: 2000, unit: "un." } as const;
  it("800 → 700 → 500 sobre 2.000: acumulado y saldo correctos, completa solo al final", () => {
    const a = planCodificadoTransfer({ ...base, alreadyOut: 0, produced: 800, requested: 800 });
    expect(a).toMatchObject({ ok: true, quantity: 800, cumulative: 800, pending: 1200, complete: false });
    const b = planCodificadoTransfer({ ...base, alreadyOut: 800, produced: 1500, requested: 700 });
    expect(b).toMatchObject({ ok: true, cumulative: 1500, pending: 500, complete: false });
    const c = planCodificadoTransfer({ ...base, alreadyOut: 1500, produced: 2000, requested: 500 });
    expect(c).toMatchObject({ ok: true, cumulative: 2000, pending: 0, complete: true });
  });
  it("no se puede entregar más que lo terminado sin entregar, más que el saldo, 0, negativos ni decimales", () => {
    expect(planCodificadoTransfer({ ...base, alreadyOut: 0, produced: 800, requested: 900 })).toMatchObject({ ok: false, code: "EXCEEDS_AVAILABLE" });
    expect(planCodificadoTransfer({ ...base, alreadyOut: 1900, produced: 2000, requested: 200 })).toMatchObject({ ok: false, code: "EXCEEDS_BALANCE", error: expect.stringContaining("falta entregar a Codificado (100)") });
    expect(planCodificadoTransfer({ ...base, alreadyOut: 2000, produced: 2000, requested: 1 })).toMatchObject({ ok: false, code: "NOTHING_PENDING" });
    expect(planCodificadoTransfer({ ...base, alreadyOut: 0, produced: 800, requested: 0 })).toMatchObject({ ok: false, code: "INVALID_QUANTITY" });
    expect(planCodificadoTransfer({ ...base, alreadyOut: 0, produced: 800, requested: 10.5 })).toMatchObject({ ok: false, code: "INVALID_QUANTITY" });
  });
  it("las entregas a Producción cuentan igual que las de Codificado (nada se cuenta dos veces)", () => {
    expect(planCodificadoTransfer({ ...base, alreadyOut: 1300 + 500, produced: 2000, requested: 300 })).toMatchObject({ ok: false, code: "EXCEEDS_BALANCE" });
  });
});

describe("summarizeCodificado", () => {
  it("Envasado y Codificado ven cantidades coherentes", () => {
    const s = summarizeCodificado({ assigned: 2000, produced: 1500, deliveredToProduccion: 0, transferred: 800, coded: 500, deliveredByCodificado: 0 });
    expect(s).toMatchObject({ pendingToTransfer: 1200, availableToTransfer: 700, received: 800, coded: 500, pendingToCode: 300, notYetReceived: 1200 });
  });
  it("lo codificado nunca supera lo recibido y sin dato de terminadas no se inventa disponible", () => {
    expect(summarizeCodificado({ assigned: 100, produced: null, deliveredToProduccion: 0, transferred: 40, coded: 90, deliveredByCodificado: 0 })).toMatchObject({ coded: 40, pendingToCode: 0, availableToTransfer: null });
  });
});

describe("permisos y claves", () => {
  it("cada Envasado entrega lo suyo; Producción/Dirección pueden; otros no", () => {
    expect(canTransferToCodificado("ENVASADO_MASIVO", "ENVASADO_MASIVO")).toBe(true);
    expect(canTransferToCodificado("ENVASADO_PREMIUM", "ENVASADO_MASIVO")).toBe(false);
    expect(canTransferToCodificado("PRODUCCION", "ENVASADO_PREMIUM")).toBe(true);
    expect(canTransferToCodificado("CODIFICADO", "ENVASADO_MASIVO")).toBe(false);
    expect(canTransferToCodificado("CALIDAD", "ENVASADO_MASIVO")).toBe(false);
  });
  it("Codificado, Producción y Dirección consultan lo recibido", () => {
    for (const s of ["CODIFICADO", "PRODUCCION", "DIRECCION"]) expect(canWorkReceivedCodificado(s)).toBe(true);
    for (const s of ["ENVASADO_MASIVO", "CALIDAD", "DEPOSITO"]) expect(canWorkReceivedCodificado(s)).toBe(false);
  });
  it("la clave por defecto es estable para el mismo paso", () => {
    expect(defaultTransferKey({ workItemId: "a", alreadyOut: 800, requested: 700 })).toBe(defaultTransferKey({ workItemId: "a", alreadyOut: 800, requested: 700 }));
    expect(defaultTransferKey({ workItemId: "a", alreadyOut: 800, requested: 700 })).not.toBe(defaultTransferKey({ workItemId: "a", alreadyOut: 1500, requested: 700 }));
  });
});
