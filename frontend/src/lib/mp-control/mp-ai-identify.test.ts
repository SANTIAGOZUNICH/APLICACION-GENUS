import { describe, expect, it } from "vitest";
import { AI_MAX_CANDIDATES, buildIdentifyPrompt, parseIdentifyAnswer, type AiLineInput } from "./mp-ai-identify";

const lines: AiLineInput[] = [
  { lineId: "a", supplier: "Sur", supplierCode: "", description: "Provitamina B5 50%", unit: "kg", candidates: [{ code: "MP-002", description: "D-PANTENOL 75%" }, { code: "MP-003", description: "PANTENOL 50%" }] },
  { lineId: "b", supplier: "Sur", supplierCode: "", description: "Sodium hyaluronate", unit: "kg", candidates: [{ code: "MP-004", description: "HIALURONATO DE SODIO" }] },
];

describe("evaluación de equivalencias con IA: se valida TODO lo que devuelve", () => {
  it("el prompt incluye solo los candidatos acotados, no el inventario", () => {
    const many: AiLineInput = { ...lines[0]!, candidates: Array.from({ length: 30 }, (_, i) => ({ code: `X-${i}`, description: `Mat ${i}` })) };
    const p = buildIdentifyPrompt([many], "MP");
    expect((p.match(/"codigo"/g) ?? []).length).toBe(AI_MAX_CANDIDATES);
  });
  it("acepta equivalente→MEDIA y posible→BAJA, con motivo; nunca ALTA", () => {
    const r = parseIdentifyAnswer({ results: [{ lineId: "b", options: [{ code: "mp-004", verdict: "equivalente", reason: "Es el INCI del hialuronato de sodio" }] }] }, lines);
    expect(r.b).toEqual([expect.objectContaining({ code: "MP-004", confidence: "MEDIA", reason: expect.stringContaining("IA:") })]);
  });
  it("descarta un código inventado (fuera de los candidatos)", () => {
    expect(parseIdentifyAnswer({ results: [{ lineId: "b", options: [{ code: "MP-999", verdict: "equivalente", reason: "x" }] }] }, lines)).toEqual({});
  });
  it("descarta una equivalencia que contradice la concentración aunque la IA la acepte", () => {
    const r = parseIdentifyAnswer({ results: [{ lineId: "a", options: [{ code: "MP-002", verdict: "equivalente", reason: "mismo activo" }, { code: "MP-003", verdict: "equivalente", reason: "misma concentración" }] }] }, lines);
    expect(r.a?.map((x) => x.code)).toEqual(["MP-003"]);
  });
  it("ignora no_equivalente, respuestas basura y renglones desconocidos", () => {
    expect(parseIdentifyAnswer({ results: [{ lineId: "b", options: [{ code: "MP-004", verdict: "no_equivalente", reason: "no" }] }, { lineId: "zzz", options: [] }] }, lines)).toEqual({});
    expect(parseIdentifyAnswer("basura", lines)).toEqual({});
    expect(parseIdentifyAnswer(null, lines)).toEqual({});
  });
});
