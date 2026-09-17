/**
 * Vínculo Asignación de Lotes → WorkItem (Producción → Asignar trabajo).
 *
 * INVESTIGACIÓN PREVIA: Asignación de Lotes NO tiene ningún campo de
 * Pedido/OA/OE (ver `AsignacionLote` en ./types.ts — solo lote/fecha/
 * producto/codigo/marca/cantidades/vto/muestras/cjMuestra/fechaAnalisis).
 * Tampoco existe un "código de producto" en el flujo de Asignar trabajo
 * (AssignWorkDialog no tiene ese campo, y `ProductionPedidoRecord` — lo que
 * autocompleta Cliente/Producto desde un Pedido — tampoco lo tiene). Por
 * lo tanto, hoy NO es posible cruzar por Pedido/OA/OE/código como
 * identificador propio del lado del pedido: la única clave real disponible
 * en ambos lados es CLIENTE (marca) + PRODUCTO (texto libre).
 *
 * CASO REAL QUE MOTIVÓ ESTA VERSIÓN (reproducido en Production, cliente
 * ECODERM): la coincidencia exacta normalizada fallaba porque GENUS
 * distribuye el mismo dato real en campos distintos según quién lo carga:
 *   - Asignación de Lotes: marca="ROSEHIP-ECODERM", producto="SERUM",
 *     codigo="VITAMINA C"
 *   - Pedido de Producción: cliente="ECODERM",
 *     producto="SERUM VITAMINA C ROSEHIP"
 * "ECODERM" nunca es === "ROSEHIP-ECODERM", y "SERUM" nunca es === "SERUM
 * VITAMINA C ROSEHIP" — pese a ser evidentemente el mismo trabajo. De ahí
 * las dos tolerancias deterministas (NO fuzzy) de abajo: cliente por
 * subconjunto de tokens, y producto por cobertura de tokens significativos
 * (producto+código) sin exigir igualdad literal.
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

export type MatchTier = "EXACTO" | "COMPATIBLE";

export type AsignacionLoteResolution =
  | { status: "found"; candidate: AsignacionLoteMatchCandidate; matchTier: MatchTier }
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

// Conectores en español que nunca aportan identidad de producto/cliente —
// quitarlos no es "fuzzy": es la misma idea de stopwords determinística que
// ya usa el resto del codebase (p. ej. isGenericSheetName).
const CONNECTOR_STOPWORDS = new Set([
  "de", "del", "la", "el", "los", "las", "con", "para", "y", "o", "x", "a", "en", "sin", "por", "al", "un", "una",
]);

// Tokens de talle/cantidad ("1kg", "250gr", "x50ml", "500ml") — son formato
// de packaging, no identidad de producto. Se detectan por FORMA (dígito +
// unidad conocida), nunca por lista de palabras de producto.
const SIZE_TOKEN_RE =
  /^x?\d+([.,]\d+)?(kgs?|gr?s?|gramos?|mgs?|mls?|lts?|litros?|cc|cm|mm|un|und|unids?|uds?|unidades)$/i;

function tokensOf(value: string, stripConnectors: boolean): string[] {
  const tokens = normalizeSearchKey(value).split(" ").filter(Boolean);
  return stripConnectors ? tokens.filter((t) => !CONNECTOR_STOPWORDS.has(t)) : tokens;
}

function joinedAlnumKey(value: string): string {
  return normalizeSearchKey(value).replace(/\s+/g, "");
}

type ClienteRelation = "EXACT" | "TOKEN_SUBSET" | "NONE";

// Cliente/marca ya es una restricción fuerte (nunca se compara contra TODOS
// los productos, solo dentro del mismo cliente) — acá solo se tolera que el
// mismo cliente esté escrito como submarca compuesta ("ROSEHIP-ECODERM",
// "ECODERM - DUGA", "ECODERM-SUSNA GRESS"), un patrón real y frecuente en
// los datos de Producción. Mismo criterio de subconjunto de tokens que ya
// usa `resolveClientFromFilename` en formulas/types.ts — no es un
// normalizador nuevo, es la misma idea aplicada acá.
const CLIENT_TOKEN_MIN_LEN = 3;

export function clienteRelation(a: string, b: string): ClienteRelation {
  const na = normalizeSearchKey(a);
  const nb = normalizeSearchKey(b);
  if (!na || !nb) return "NONE";
  if (na === nb) return "EXACT";
  const ta = na.split(" ").filter((t) => t.length >= CLIENT_TOKEN_MIN_LEN);
  const tb = nb.split(" ").filter((t) => t.length >= CLIENT_TOKEN_MIN_LEN);
  if (ta.length === 0 || tb.length === 0) return "NONE";
  const setA = new Set(ta);
  const setB = new Set(tb);
  const aSubsetOfB = ta.every((t) => setB.has(t));
  const bSubsetOfA = tb.every((t) => setA.has(t));
  return aSubsetOfB || bSubsetOfA ? "TOKEN_SUBSET" : "NONE";
}

type ProductoRelation = "EXACT" | "CONTAINED" | "NONE";
const PRODUCT_CONTAINMENT_THRESHOLD = 0.7;

/**
 * Compara el producto+código de una asignación contra el texto libre de
 * producto del pedido. Determinístico, explicable, NUNCA fuzzy por edición
 * de caracteres:
 *  1. Igualdad exacta normalizada, o igualdad ignorando espacios (para
 *     tolerar "ROSE HIP" vs "ROSEHIP") -> EXACT.
 *  2. Si no, se arman dos "bolsas" de tokens significativos (sin
 *     conectores ni tokens de talle/cantidad): la de la asignación
 *     (producto + código) y la del pedido (restando las palabras que ya
 *     están explicadas por la marca — ver caso ROSEHIP en el comentario de
 *     arriba). Si el pedido, ya limpio, tiene MÁS palabras sin explicar que
 *     la asignación, se rechaza: esa palabra de más puede ser una variante
 *     real (color/sabor/presentación) y no hay forma segura de saber que no
 *     lo es. Si no, se exige que el lado más chico esté cubierto en al
 *     menos un 70% por el más grande.
 */
export function productoRelation(
  candidate: { producto: string; codigo: string; marca: string },
  pedidoProducto: string
): ProductoRelation {
  const candNorm = normalizeSearchKey(candidate.producto);
  const pedidoNorm = normalizeSearchKey(pedidoProducto);
  if (!candNorm || !pedidoNorm) return "NONE";
  if (candNorm === pedidoNorm) return "EXACT";
  if (joinedAlnumKey(candidate.producto) === joinedAlnumKey(pedidoProducto)) return "EXACT";

  const marcaTokens = new Set(tokensOf(candidate.marca, true));
  const candidateBag = [
    ...new Set(
      tokensOf(`${candidate.producto} ${candidate.codigo || ""}`, true).filter((t) => !SIZE_TOKEN_RE.test(t))
    ),
  ];
  const pedidoBag = [
    ...new Set(
      tokensOf(pedidoProducto, true).filter((t) => !SIZE_TOKEN_RE.test(t) && !marcaTokens.has(t))
    ),
  ];
  if (candidateBag.length < 2 || pedidoBag.length < 2) return "NONE";
  // El pedido agrega palabras que ni el producto ni la marca de la
  // asignación explican -> puede ser una variante real (ej.: "AFTER SHAVE"
  // vs "AFTER SHAVE VIOLETA"). No se arriesga.
  if (pedidoBag.length > candidateBag.length) return "NONE";

  const pedidoSet = new Set(pedidoBag);
  const intersection = candidateBag.filter((t) => pedidoSet.has(t)).length;
  const ratio = intersection / pedidoBag.length;
  return ratio >= PRODUCT_CONTAINMENT_THRESHOLD ? "CONTAINED" : "NONE";
}

function classifyMatch(clienteRel: ClienteRelation, productoRel: ProductoRelation): MatchTier | null {
  if (clienteRel === "NONE" || productoRel === "NONE") return null;
  return clienteRel === "EXACT" && productoRel === "EXACT" ? "EXACTO" : "COMPATIBLE";
}

/**
 * Resuelve qué asignación de lote corresponde a un cliente+producto dado.
 * Nunca elige silenciosamente entre varias: si más de un candidato alcanza
 * el nivel de coincidencia más alto disponible, devuelve "ambiguous" con
 * todos para que Producción decida explícitamente. Un candidato "COMPATIBLE"
 * nunca gana contra un "EXACTO" que exista en simultáneo.
 */
export function resolveAsignacionLoteForWorkItem(
  candidates: readonly AsignacionLoteResolveInput[],
  criteria: { cliente: string; producto: string }
): AsignacionLoteResolution {
  if (!criteria.cliente?.trim() || !criteria.producto?.trim()) return { status: "none" };

  const qualifying: Array<{ item: AsignacionLoteResolveInput; tier: MatchTier }> = [];
  for (const c of candidates) {
    if (c.archived) continue;
    const clienteRel = clienteRelation(criteria.cliente, c.marca);
    if (clienteRel === "NONE") continue;
    const productoRel = productoRelation(c, criteria.producto);
    const tier = classifyMatch(clienteRel, productoRel);
    if (!tier) continue;
    qualifying.push({ item: c, tier });
  }

  if (qualifying.length === 0) return { status: "none" };

  const hasExacto = qualifying.some((q) => q.tier === "EXACTO");
  const topTier = hasExacto ? "EXACTO" : "COMPATIBLE";
  const top = qualifying.filter((q) => q.tier === topTier);

  if (top.length === 1) return { status: "found", candidate: toCandidate(top[0]!.item), matchTier: topTier };
  return { status: "ambiguous", candidates: top.map((q) => toCandidate(q.item)) };
}

/**
 * Recupera una asignación específica por id, re-validando que sigue activa
 * y que todavía corresponde al cliente+producto indicado (con la misma
 * tolerancia que `resolveAsignacionLoteForWorkItem`) — usado por el
 * servidor al confirmar la asignación para nunca confiar ciegamente en un
 * id elegido por el cliente sobre un snapshot que pudo quedar desactualizado.
 */
export function findAsignacionLoteByIdForWorkItem(
  candidates: readonly AsignacionLoteResolveInput[],
  id: string,
  criteria: { cliente: string; producto: string }
): AsignacionLoteMatchCandidate | null {
  const found = candidates.find((c) => c.id === id && !c.archived);
  if (!found) return null;
  const clienteRel = clienteRelation(criteria.cliente, found.marca);
  if (clienteRel === "NONE") return null;
  const productoRel = productoRelation(found, criteria.producto);
  if (productoRel === "NONE") return null;
  return toCandidate(found);
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

export interface LoteVtoInconsistency {
  currentLote: string | null;
  currentVto: string | null;
  foundLote: string | null;
  foundVto: string | null;
  asignacionLoteId: string;
}

/**
 * Sección 11 del pedido: detección adicional, puramente informativa. Un
 * WorkItem que YA tiene lote/VTO propio nunca se sobreescribe ni se
 * bloquea — pero si una resolución inequívoca (found) contra Asignación de
 * Lotes indica un lote/VTO distinto al que el WorkItem ya tiene, vale la
 * pena poder señalarlo para revisión humana. Devuelve null si no hay
 * "found" o si no hay ningún valor propio con el que comparar (ese caso es
 * el de `fillBareWorkItemsFromAsignacionLote`, no este).
 */
export function detectLoteVtoInconsistency(
  current: { packagingLote: string | null; packagingVto: string | null },
  resolution: AsignacionLoteResolution
): LoteVtoInconsistency | null {
  if (resolution.status !== "found") return null;
  const currentLote = current.packagingLote?.trim() || null;
  const currentVto = current.packagingVto?.trim() || null;
  if (!currentLote && !currentVto) return null;
  const foundLote = resolution.candidate.lote?.trim() || null;
  const foundVto = resolution.candidate.vto?.trim() || null;
  const loteDiffers = Boolean(currentLote && foundLote && currentLote !== foundLote);
  const vtoDiffers = Boolean(currentVto && foundVto && currentVto !== foundVto);
  if (!loteDiffers && !vtoDiffers) return null;
  return { currentLote, currentVto, foundLote, foundVto, asignacionLoteId: resolution.candidate.id };
}
