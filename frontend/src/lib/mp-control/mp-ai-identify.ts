/**
 * Evaluación de equivalencias de MP con IA — reglas PURAS (armar el pedido y VALIDAR la respuesta).
 *
 * La IA solo recibe, por cada renglón del remito, un puñado de candidatos REALES del inventario (nunca el inventario completo) y devuelve
 * un veredicto razonado por candidato. Todo lo que devuelve se valida acá: un código fuera de la lista se descarta, una concentración /
 * grado / presentación contradictoria se descarta, y ninguna respuesta se aplica sola (siempre queda como sugerencia a confirmar).
 */
import { specConflict } from "./mp-identity";

export type AiCandidate = { code: string; description: string; unit?: string };
export type AiLineInput = { lineId: string; supplier: string; supplierCode: string; description: string; unit: string; candidates: AiCandidate[] };
export type AiSuggestion = { code: string; description: string; unit: string; confidence: "ALTA" | "MEDIA" | "BAJA"; reason: string };

export const AI_MAX_LINES = 25;
export const AI_MAX_CANDIDATES = 8;

export function buildIdentifyPrompt(lines: AiLineInput[], module: "MP" | "ME"): string {
  const what = module === "MP" ? "materias primas de un laboratorio de cosmética/alimentos/farma" : "materiales de envase";
  const payload = lines.map((l) => ({
    lineId: l.lineId,
    remito: { proveedor: l.supplier, codigoProveedor: l.supplierCode, descripcion: l.description, unidad: l.unit },
    candidatos: l.candidates.slice(0, AI_MAX_CANDIDATES).map((c) => ({ codigo: c.code, descripcion: c.description })),
  }));
  return `Sos un especialista en ${what}. Para cada renglón de un remito te paso candidatos REALES de nuestro inventario. Decidí, candidato por candidato, si es el MISMO material que el del remito.
Reglas estrictas:
- Usá SOLO los códigos de "candidatos" de ese renglón. Nunca inventes un código ni propongas un material que no esté en la lista.
- Considerá nombre comercial, nombre químico, INCI, sinónimos en español/inglés, composición, concentración, grado/calidad, presentación y proveedor.
- Si la concentración, el grado o la presentación difieren (p. ej. 50% vs 75%), o la función es parecida pero es OTRO material, el veredicto es "no_equivalente".
- "equivalente": es el mismo material con identidad y especificación compatibles. "posible": probable pero falta un dato para asegurarlo. "no_equivalente": no lo es.
- Si dudás entre "equivalente" y "posible", elegí "posible". Explicá en una frase corta (máx. 140 caracteres) en español.
Devolvé SOLO JSON: {"results":[{"lineId":string,"options":[{"code":string,"verdict":"equivalente"|"posible"|"no_equivalente","reason":string}]}]}
Datos:
${JSON.stringify(payload)}`;
}

/** Valida la respuesta del modelo contra los candidatos enviados. Nunca confía en ella. */
export function parseIdentifyAnswer(answer: unknown, lines: AiLineInput[]): Record<string, AiSuggestion[]> {
  const out: Record<string, AiSuggestion[]> = {};
  const root = (answer && typeof answer === "object" ? answer : {}) as { results?: unknown };
  const results = Array.isArray(root.results) ? root.results : Array.isArray(answer) ? (answer as unknown[]) : [];
  const byId = new Map(lines.map((l) => [l.lineId, l]));
  for (const r of results) {
    const o = (r && typeof r === "object" ? r : {}) as { lineId?: unknown; options?: unknown };
    const line = byId.get(String(o.lineId ?? ""));
    if (!line || !Array.isArray(o.options)) continue;
    const allowed = new Map(line.candidates.map((c) => [c.code.trim().toUpperCase(), c]));
    const list: AiSuggestion[] = [];
    for (const opt of o.options) {
      const x = (opt && typeof opt === "object" ? opt : {}) as { code?: unknown; verdict?: unknown; reason?: unknown };
      const cand = allowed.get(String(x.code ?? "").trim().toUpperCase());
      if (!cand) continue; // código inventado o fuera de la lista
      const verdict = String(x.verdict ?? "");
      if (verdict !== "equivalente" && verdict !== "posible") continue;
      if (specConflict(line.description, cand.description)) continue; // la IA no pisa una contradicción de especificación
      const reason = String(x.reason ?? "").replace(/\s+/g, " ").trim().slice(0, 160) || "Evaluado por IA";
      // La IA nunca produce «ALTA»: una equivalencia razonada es MEDIA y siempre requiere confirmación de una persona.
      list.push({ code: cand.code, description: cand.description, unit: cand.unit ?? "", confidence: verdict === "equivalente" ? "MEDIA" : "BAJA", reason: `IA: ${reason}` });
    }
    list.sort((a, b) => (a.confidence === b.confidence ? a.code.localeCompare(b.code) : a.confidence === "MEDIA" ? -1 : 1));
    if (list.length) out[line.lineId] = list.slice(0, 3);
  }
  return out;
}
