/**
 * Deducción del Envasado de destino (Masivo / Premium) al terminar una Elaboración — parte PURA.
 *
 * No se infiere del nombre del producto (frágil): se usa lo que el sistema YA sabe de la planificación real:
 *   1. el Envasado que ya tiene trabajos del MISMO pedido (y producto, si hay coincidencia exacta);
 *   2. si no hay pedido, el Envasado donde se envasó antes el mismo cliente + producto.
 * Si hay más de un destino posible o ninguno, devuelve `null` y el diálogo le pide a la persona que elija.
 */
import { normalizeSearchKey } from "@/lib/formulas/types";

export type EnvasadoDestination = "ENVASADO_MASIVO" | "ENVASADO_PREMIUM";

export const ENVASADO_DESTINATIONS: readonly EnvasadoDestination[] = ["ENVASADO_MASIVO", "ENVASADO_PREMIUM"];

export function isEnvasadoDestination(value: unknown): value is EnvasadoDestination {
  return value === "ENVASADO_MASIVO" || value === "ENVASADO_PREMIUM";
}

export interface DestinationCandidate {
  sector: string;
  pedidoId?: string | null;
  client?: string | null;
  product?: string | null;
}

export interface DestinationSuggestion {
  sector: EnvasadoDestination | null;
  reason: "PEDIDO_PRODUCTO" | "PEDIDO" | "HISTORIAL_CLIENTE_PRODUCTO" | "NO_DETERMINABLE" | "AMBIGUO";
}

function uniqueSector(rows: DestinationCandidate[]): EnvasadoDestination | "AMBIGUO" | null {
  const sectors = [...new Set(rows.map((r) => r.sector).filter(isEnvasadoDestination))];
  if (sectors.length === 0) return null;
  if (sectors.length > 1) return "AMBIGUO";
  return sectors[0];
}

export function suggestEnvasadoDestination(
  source: { pedidoId?: string | null; client?: string | null; product?: string | null },
  candidates: DestinationCandidate[]
): DestinationSuggestion {
  const product = normalizeSearchKey(source.product ?? "");
  const client = normalizeSearchKey(source.client ?? "");

  if (source.pedidoId) {
    const samePedido = candidates.filter((c) => c.pedidoId === source.pedidoId);
    const sameProduct = samePedido.filter((c) => product && normalizeSearchKey(c.product ?? "") === product);
    const byProduct = uniqueSector(sameProduct);
    if (byProduct && byProduct !== "AMBIGUO") return { sector: byProduct, reason: "PEDIDO_PRODUCTO" };
    const byPedido = uniqueSector(samePedido);
    if (byPedido === "AMBIGUO") return { sector: null, reason: "AMBIGUO" };
    if (byPedido) return { sector: byPedido, reason: "PEDIDO" };
  }

  if (client && product) {
    const history = candidates.filter(
      (c) => normalizeSearchKey(c.client ?? "") === client && normalizeSearchKey(c.product ?? "") === product
    );
    const byHistory = uniqueSector(history);
    if (byHistory === "AMBIGUO") return { sector: null, reason: "AMBIGUO" };
    if (byHistory) return { sector: byHistory, reason: "HISTORIAL_CLIENTE_PRODUCTO" };
  }
  return { sector: null, reason: "NO_DETERMINABLE" };
}

const MASIVO_LINES = ["Línea 1", "Línea 2", "Línea 3", "Línea 4"] as const;
const PREMIUM_LINES = ["Línea 1", "Línea 2"] as const;

export function envasadoLinesFor(sector: EnvasadoDestination): readonly string[] {
  return sector === "ENVASADO_MASIVO" ? MASIVO_LINES : PREMIUM_LINES;
}
