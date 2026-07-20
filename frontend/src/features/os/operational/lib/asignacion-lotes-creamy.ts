import type { AsignacionLote } from "../adapters/asignacion-lotes-repository";
import { searchAsignacionLotes } from "./asignacion-lotes-search";

export interface CreamyLotesResult {
  id: string;
  label: string;
  meta: string;
  item: AsignacionLote;
}

export interface CreamyLotesAnswer {
  headline: string;
  hint: string;
  results: CreamyLotesResult[];
}

export function answerLotesQuery(query: string): CreamyLotesAnswer {
  const trimmed = query.trim();
  if (!trimmed) {
    return {
      headline: "Preguntá por un lote o producto",
      hint: "Ejemplo: Creamy, PR-120 o L-CR-001.",
      results: [],
    };
  }

  const results = searchAsignacionLotes(trimmed, { limit: 5 }).map((item) => ({
    id: item.id,
    label: `${item.producto} · ${item.lote}`,
    meta: [
      item.codigo ? `Código ${item.codigo}` : null,
      item.vto ? `Vto ${item.vto}` : null,
      item.cantidades ? `${item.cantidades} u.` : null,
    ]
      .filter(Boolean)
      .join(" · "),
    item,
  }));

  return {
    headline:
      results.length > 0
        ? `${results.length} resultado${results.length === 1 ? "" : "s"} en asignación de lotes`
        : "Sin resultados en asignación de lotes",
    hint:
      results.length > 0
        ? "Abrí Asignación de lotes para editar o revisar el registro completo."
        : "Probá con producto, lote, código o vencimiento.",
    results,
  };
}
