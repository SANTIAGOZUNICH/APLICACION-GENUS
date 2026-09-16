/**
 * Vínculo Asignación de Lotes → WorkItem (Producción → Asignar trabajo).
 *
 * INVESTIGACIÓN PREVIA: Asignación de Lotes NO tiene ningún campo de
 * Pedido/OA/OE (ver `AsignacionLote` en ./types.ts — solo lote/fecha/
 * producto/codigo/marca/cantidades/vto/muestras/cjMuestra/fechaAnalisis).
 * Tampoco existe un "código de producto" en el flujo de Asignar trabajo
 * (AssignWorkDialog no tiene ese campo, y `ProductionPedidoRecord` — lo que
 * autocompleta Cliente/Producto desde un Pedido — tampoco lo tiene). Por
 * lo tanto, hoy NO es posible cruzar por Pedido/OA/OE/código: la única
 * clave real y determinística disponible en ambos lados es
 * CLIENTE (marca) + PRODUCTO, normalizados (tildes/mayúsculas/espacios),
 * nunca fuzzy. Si en el futuro se agrega código de producto al flujo de
 * asignación, `resolveAsignacionLoteForWorkItem` es el único lugar a tocar
 * para sumarlo como identificador adicional.
 */
import { normalizeSearchKey } from "@/lib/formulas/types";

export interface AsignacionLoteMatchCandidate {
  id: string;
  lote: string;
  vto: string | null;
  producto: string;
  marca: string;
  codigo: string;
  cantidades: number;
  fecha: string | null;
}

/** Insumo mínimo del resolver — cualquier fuente (servicio en memoria/Neon, fila Drizzle cruda) alcanza con esto. */
export type AsignacionLoteResolveInput = AsignacionLoteMatchCandidate & { archived?: boolean };

export type AsignacionLoteResolution =
  | { status: "found"; candidate: AsignacionLoteMatchCandidate }
  | { status: "none" }
  | { status: "ambiguous"; candidates: AsignacionLoteMatchCandidate[] };

function toCandidate(a: AsignacionLoteResolveInput): AsignacionLoteMatchCandidate {
  return {
    id: a.id,
    lote: a.lote,
    vto: a.vto,
    producto: a.producto,
    marca: a.marca,
    codigo: a.codigo,
    cantidades: a.cantidades,
    fecha: a.fecha,
  };
}

/**
 * Resuelve qué asignación de lote corresponde a un cliente+producto dado.
 * Determinístico: normaliza y exige coincidencia EXACTA sobre el texto
 * normalizado — nunca fuzzy matching. Nunca elige silenciosamente entre
 * varias: si hay más de una activa (no archivada) para el mismo
 * cliente+producto, devuelve "ambiguous" con todas para que Producción
 * decida explícitamente.
 */
export function resolveAsignacionLoteForWorkItem(
  candidates: readonly AsignacionLoteResolveInput[],
  criteria: { cliente: string; producto: string }
): AsignacionLoteResolution {
  const cliente = normalizeSearchKey(criteria.cliente);
  const producto = normalizeSearchKey(criteria.producto);
  if (!cliente || !producto) return { status: "none" };

  const matches = candidates.filter(
    (c) =>
      !c.archived &&
      normalizeSearchKey(c.marca) === cliente &&
      normalizeSearchKey(c.producto) === producto
  );

  if (matches.length === 0) return { status: "none" };
  if (matches.length === 1) return { status: "found", candidate: toCandidate(matches[0]) };
  return { status: "ambiguous", candidates: matches.map(toCandidate) };
}

/**
 * Recupera una asignación específica por id, re-validando que sigue activa
 * y que todavía corresponde al cliente+producto indicado — usado por el
 * servidor al confirmar la asignación para nunca confiar ciegamente en un
 * id elegido por el cliente sobre un snapshot que pudo quedar desactualizado.
 */
export function findAsignacionLoteByIdForWorkItem(
  candidates: readonly AsignacionLoteResolveInput[],
  id: string,
  criteria: { cliente: string; producto: string }
): AsignacionLoteMatchCandidate | null {
  const cliente = normalizeSearchKey(criteria.cliente);
  const producto = normalizeSearchKey(criteria.producto);
  const found = candidates.find(
    (c) =>
      c.id === id &&
      !c.archived &&
      normalizeSearchKey(c.marca) === cliente &&
      normalizeSearchKey(c.producto) === producto
  );
  return found ? toCandidate(found) : null;
}

export type LoteVtoWarningCode =
  | "NONE"
  | "MISSING_LOTE_AND_VTO"
  | "MISSING_LOTE"
  | "MISSING_VTO"
  | "AMBIGUOUS";

/**
 * Warning no bloqueante para mostrar en Asignar trabajo — nunca deshabilita
 * el botón de asignar, es puramente informativo (mismo criterio que
 * getWorkItemWarnings para el resto del ciclo operativo).
 */
export function computeLoteVtoWarning(resolution: AsignacionLoteResolution): LoteVtoWarningCode {
  if (resolution.status === "ambiguous") return "AMBIGUOUS";
  if (resolution.status === "none") return "MISSING_LOTE_AND_VTO";
  const { lote, vto } = resolution.candidate;
  const hasLote = Boolean(lote?.trim());
  const hasVto = Boolean(vto?.trim());
  if (hasLote && hasVto) return "NONE";
  if (!hasLote && !hasVto) return "MISSING_LOTE_AND_VTO";
  if (!hasLote) return "MISSING_LOTE";
  return "MISSING_VTO";
}

export const LOTE_VTO_WARNING_LABEL: Record<LoteVtoWarningCode, string | null> = {
  NONE: null,
  MISSING_LOTE_AND_VTO: "NO TIENE LOTE Y VTO ASIGNADO",
  MISSING_LOTE: "NO TIENE LOTE ASIGNADO",
  MISSING_VTO: "NO TIENE VTO ASIGNADO",
  AMBIGUOUS: "HAY MÁS DE UN LOTE POSIBLE",
};
