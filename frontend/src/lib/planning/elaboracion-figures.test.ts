import { describe, expect, it } from "vitest";
import { computeElaboracionFigures } from "./elaboracion-figures";

const base = { plannedQuantity: "60", finishedQty: null, operationalStatus: "pendiente", status: "PUBLICADO", unit: "kg", deliveredLinesKg: 0, sentToEnvasadoKg: null, sentToEnvasado: false };

describe("cifras reales de Elaboración", () => {
  it("pendiente: sin kg elaborados no se asume nada (ni elaborados ni pendientes)", () => {
    expect(computeElaboracionFigures(base)).toMatchObject({ state: "PENDIENTE", stateLabel: "Pendiente de elaboración", requestedKg: 60, elaboratedKg: null, deliveredKg: 0, pendingKg: null });
  });
  it("en elaboración: avance en curso o kg informados", () => {
    expect(computeElaboracionFigures({ ...base, operationalStatus: "en_curso" }).state).toBe("EN_ELABORACION");
    expect(computeElaboracionFigures({ ...base, finishedQty: "25" })).toMatchObject({ state: "EN_ELABORACION", elaboratedKg: 25, pendingKg: 25 });
  });
  it("elaborado: completo y todavía sin entregas", () => {
    expect(computeElaboracionFigures({ ...base, operationalStatus: "completo", finishedQty: "70" })).toMatchObject({ state: "ELABORADO", elaboratedKg: 70, deliveredKg: 0, pendingKg: 70 });
  });
  it("60 kg solicitados, 70 elaborados, 40 entregados → Entregado parcialmente; no se recorta a lo solicitado", () => {
    const f = computeElaboracionFigures({ ...base, operationalStatus: "completo", finishedQty: "70", deliveredLinesKg: 40 });
    expect(f).toMatchObject({ state: "ENTREGADO_PARCIAL", stateLabel: "Entregado parcialmente", requestedKg: 60, elaboratedKg: 70, deliveredKg: 40, pendingKg: 30 });
  });
  it("entregados los 30 restantes → Entregado, pendiente 0 (nunca negativo)", () => {
    expect(computeElaboracionFigures({ ...base, operationalStatus: "entregado", finishedQty: "70", deliveredLinesKg: 70 })).toMatchObject({ state: "ENTREGADO", deliveredKg: 70, pendingKg: 0 });
    expect(computeElaboracionFigures({ ...base, operationalStatus: "entregado", finishedQty: "60", deliveredLinesKg: 60.0000001 }).pendingKg).toBe(0);
  });
  it("el envío a Envasado cuenta como entrega real de los kg elaborados", () => {
    expect(computeElaboracionFigures({ ...base, operationalStatus: "completo", finishedQty: "70", sentToEnvasado: true, sentToEnvasadoKg: 70 })).toMatchObject({ state: "ENTREGADO", deliveredKg: 70, pendingKg: 0 });
  });
  it("un envío viejo no cuenta si el trabajo volvió a pendiente / en curso", () => {
    expect(computeElaboracionFigures({ ...base, operationalStatus: "en_curso", finishedQty: "70", sentToEnvasado: true, sentToEnvasadoKg: 70 })).toMatchObject({ state: "EN_ELABORACION", deliveredKg: 0 });
  });
  it("entregado sin renglones ni envío: estado Entregado y kg entregados desconocidos (no se inventan)", () => {
    expect(computeElaboracionFigures({ ...base, operationalStatus: "entregado" })).toMatchObject({ state: "ENTREGADO", deliveredKg: null, pendingKg: null });
  });
  it("cancelado y bloqueado", () => {
    expect(computeElaboracionFigures({ ...base, status: "CANCELADO" }).state).toBe("CANCELADO");
    expect(computeElaboracionFigures({ ...base, operationalStatus: "bloqueado" }).state).toBe("BLOQUEADO");
  });
  it("una corrección hacia abajo (entregado 70 → 40) vuelve a parcial", () => {
    expect(computeElaboracionFigures({ ...base, operationalStatus: "completo", finishedQty: "70", deliveredLinesKg: 40 }).state).toBe("ENTREGADO_PARCIAL");
  });
});
