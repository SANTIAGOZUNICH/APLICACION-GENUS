import { describe, expect, it } from "vitest";
import { deriveProductStage, workTarget, type DeliveryFact, type WorkFact } from "./stage-rules";

const NOW = new Date("2026-10-19T15:00:00Z");
const HOURS = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

let seq = 0;
function work(over: Partial<WorkFact> = {}): WorkFact {
  return {
    id: `w${++seq}`,
    sector: "ELABORACION",
    status: "pendiente",
    source: "native",
    createdAt: "2026-10-05T13:00:00Z",
    assignedAt: "2026-10-05T13:00:00Z",
    receivedFromElaboracionAt: null,
    completedAt: null,
    progressUpdatedAt: null,
    sentToCodificadoAt: null,
    viaCodificado: false,
    plannedQuantity: "5000",
    unit: "un.",
    finishedQty: null,
    deliverableUnits: null,
    packagingTotalUnits: null,
    deliveries: [],
    ...over,
  };
}
const delivery = (key: string, quantity: number, at = "2026-10-19T12:00:00Z"): DeliveryFact => ({ key, at, quantity, unit: "un." });
const derive = (works: WorkFact[]) => deriveProductStage(works, { now: NOW })!;

describe("etapas del cliente", () => {
  it("asignado a Elaboración → Elaboración, con el ingreso real de la asignación", () => {
    const s = derive([work({ unit: "kg", plannedQuantity: "300" })]);
    expect(s.stage).toBe("ELABORACION");
    expect(s.substage).toBeNull();
    expect(s.stageStartedAt).toBe("2026-10-05T13:00:00Z");
    expect(s.stageStartSource).toBe("asignacion");
    expect(s.quantities).toMatchObject({ requested: 300, delivered: 0, unit: "kg" });
  });

  it("Elaboración terminada pero todavía sin trabajo de Envasado → sigue en Elaboración (en traspaso)", () => {
    const s = derive([work({ status: "revision" })]);
    expect(s).toMatchObject({ stage: "ELABORACION", substage: "TERMINADA_EN_TRASPASO" });
  });

  it("sin fecha verificable (trabajo importado de una hoja) no se inventa el inicio", () => {
    const s = derive([work({ source: "import_sheets", assignedAt: null })]);
    expect(s.stageStartedAt).toBeNull();
    expect(s.stageStartSource).toBeNull();
    const nativeNoEvent = derive([work({ source: "native", assignedAt: null })]);
    expect(nativeNoEvent).toMatchObject({ stageStartedAt: "2026-10-05T13:00:00Z", stageStartSource: "carga_nativa" });
  });

  it("Elaboración entrega a Envasado → Envasado, con el ingreso real del circuito (la Elaboración «completo» es traspaso)", () => {
    const elab = work({ status: "completo", unit: "kg", plannedQuantity: "300", completedAt: "2026-10-14T10:00:00Z" });
    const env = work({ sector: "ENVASADO_MASIVO", status: "pendiente", receivedFromElaboracionAt: "2026-10-14T10:00:05Z", assignedAt: "2026-10-14T10:00:05Z" });
    const s = derive([elab, env]);
    expect(s).toMatchObject({ stage: "ENVASADO", substage: null, stageStartedAt: "2026-10-14T10:00:05Z", stageStartSource: "ingreso_envasado" });
    expect(s.quantities.requested).toBe(5000);
  });

  it("Envasado envía a Codificado → sigue en proceso de finalización, NUNCA entregado", () => {
    const cod = work({ sector: "CODIFICADO", status: "en_curso", viaCodificado: true, sentToCodificadoAt: "2026-10-16T09:00:00Z", receivedFromElaboracionAt: "2026-10-14T10:00:05Z" });
    const s = derive([work({ status: "completo" }), cod]);
    expect(s).toMatchObject({ stage: "ENVASADO", substage: "FINALIZACION" });
    expect(s.stage).not.toBe("ENTREGADO");
    expect(s.quantities.delivered).toBe(0);
  });

  it("Envasado recién terminado: espera la ventana antes de mostrarse «Listo» (podría pasar a Codificado)", () => {
    const fresh = work({ sector: "ENVASADO_PREMIUM", status: "revision", completedAt: HOURS(0.2) });
    expect(derive([fresh])).toMatchObject({ stage: "ENVASADO", substage: "FINALIZACION" });
    const settled = work({ sector: "ENVASADO_PREMIUM", status: "revision", completedAt: HOURS(3) });
    expect(derive([settled])).toMatchObject({ stage: "LISTO", substage: null });
  });

  it("Codificado terminado (solo falta entregar) → Listo para entregar de inmediato", () => {
    const cod = work({ sector: "CODIFICADO", status: "revision", viaCodificado: true, completedAt: HOURS(0.1) });
    const s = derive([cod]);
    expect(s.stage).toBe("LISTO");
    expect(s.readyWorks).toEqual([{ workItemId: cod.id, available: 5000, readySince: cod.completedAt }]);
  });

  it("entrega final completa → Entregado, con la fecha de la última entrega", () => {
    const env = work({ sector: "ENVASADO_MASIVO", status: "entregado", deliveries: [delivery("line:1", 5000, "2026-10-19T12:00:00Z")] });
    const s = derive([work({ status: "completo" }), env]);
    expect(s).toMatchObject({ stage: "ENTREGADO", lastDeliveryAt: "2026-10-19T12:00:00Z" });
    expect(s.quantities).toMatchObject({ requested: 5000, delivered: 5000, pending: 0, available: 0 });
  });

  it("marcado «entregado» SIN entrega real registrada no cuenta como entregado (no hay prueba física)", () => {
    const env = work({ sector: "ENVASADO_MASIVO", status: "entregado", deliveries: [] });
    expect(derive([env]).stage).not.toBe("ENTREGADO");
  });

  it("entrega parcial: 2.000 de 5.000 entregadas y el resto todavía en proceso", () => {
    const env = work({ sector: "ENVASADO_MASIVO", status: "en_curso", deliveries: [delivery("line:1", 2000)] });
    const s = derive([env]);
    expect(s.stage).toBe("ENVASADO");
    expect(s.partialDelivery).toBe(true);
    expect(s.quantities).toMatchObject({ requested: 5000, delivered: 2000, pending: 3000, available: 0 });
  });

  it("entrega parcial con el resto ya terminado: Listo, con 3.000 disponibles", () => {
    const env = work({ sector: "ENVASADO_MASIVO", status: "revision", completedAt: HOURS(5), deliveries: [delivery("line:1", 2000)] });
    const s = derive([env]);
    expect(s.stage).toBe("LISTO");
    expect(s.quantities).toMatchObject({ delivered: 2000, pending: 3000, available: 3000 });
    expect(s.partialDelivery).toBe(true);
  });

  it("dos tandas: una lista y otra en proceso → etapa menos avanzada, con lo ya disponible aparte", () => {
    const a = work({ sector: "ENVASADO_MASIVO", status: "revision", plannedQuantity: "2000", completedAt: HOURS(6) });
    const b = work({ sector: "ENVASADO_MASIVO", status: "en_curso", plannedQuantity: "3000" });
    const s = derive([a, b]);
    expect(s.stage).toBe("ENVASADO");
    expect(s.quantities).toMatchObject({ requested: 5000, available: 2000, pending: 5000 });
    expect(s.readyWorks.map((r) => r.workItemId)).toEqual([a.id]);
  });

  it("no suma entre unidades distintas (kg y unidades)", () => {
    const a = work({ sector: "ENVASADO_MASIVO", status: "en_curso", unit: "un.", plannedQuantity: "1000" });
    const b = work({ sector: "ENVASADO_PREMIUM", status: "en_curso", unit: "kg", plannedQuantity: "50" });
    const s = derive([a, b]);
    expect(s.quantities.mixedUnits).toBe(true);
    expect(s.quantities.requested).toBeNull();
    expect(s.quantities.unit).toBeNull();
  });

  it("la cantidad a entregar usa lo embalado antes que lo planificado", () => {
    expect(workTarget({ deliverableUnits: 4800, packagingTotalUnits: 4900, finishedQty: "4950", plannedQuantity: "5000" })).toBe(4800);
    expect(workTarget({ deliverableUnits: null, packagingTotalUnits: null, finishedQty: null, plannedQuantity: "1.200" })).toBe(1200);
    expect(workTarget({ deliverableUnits: null, packagingTotalUnits: null, finishedQty: "abc", plannedQuantity: "" })).toBeNull();
  });

  it("hitos con fecha real: nunca se inventan los que no se pueden verificar", () => {
    const elab = work({ status: "completo", assignedAt: "2026-10-05T13:00:00Z" });
    const env = work({
      sector: "ENVASADO_MASIVO",
      status: "entregado",
      receivedFromElaboracionAt: "2026-10-14T10:00:05Z",
      completedAt: "2026-10-18T09:00:00Z",
      deliveries: [delivery("line:1", 5000, "2026-10-19T12:00:00Z")],
    });
    expect(derive([elab, env]).milestones).toEqual({
      elaboracion: "2026-10-05T13:00:00Z",
      envasado: "2026-10-14T10:00:05Z",
      listo: "2026-10-18T09:00:00Z",
      entregado: "2026-10-19T12:00:00Z",
    });
    const imported = derive([work({ source: "import_sheets", assignedAt: null })]);
    expect(imported.milestones).toEqual({ elaboracion: null, envasado: null, listo: null, entregado: null });
  });

  it("sin trabajos no hay etapa", () => {
    expect(deriveProductStage([], { now: NOW })).toBeNull();
  });
});
