import { GENERIC_LOTE_PATTERN, loteShape, normalizeCompact, normalizeText, parseNonNegativeAmount, parseVtoCandidate } from "./normalize";
import type { SmartPasteFieldCandidate, SmartPasteMasterData } from "./types";

/**
 * Clasifica UNA celda cruda contra TODOS los campos posibles, usando el
 * contenido de la celda + el maestro real de GENUS OS. Nunca mira en qué
 * columna está — eso es exactamente lo que permite reconstruir filas
 * desordenadas (ver row-resolver.ts).
 *
 * Cada detector devuelve 0 candidatos si el valor no tiene NADA que ver con
 * ese campo — nunca "score bajo por defecto" para todo.
 */
export function classifyCell(raw: string, master: SmartPasteMasterData): SmartPasteFieldCandidate[] {
  const candidates: SmartPasteFieldCandidate[] = [];
  const trimmed = raw.trim();
  if (!trimmed) return candidates;

  pushLoteCandidate(trimmed, master, candidates);
  pushVtoCandidate(trimmed, candidates);
  pushCantidadCandidate(trimmed, candidates);
  pushClienteCandidate(trimmed, master, candidates);
  pushProductoCandidate(trimmed, master, candidates);
  pushCodigoCandidate(trimmed, master, candidates);

  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}

function pushLoteCandidate(
  trimmed: string,
  master: SmartPasteMasterData,
  out: SmartPasteFieldCandidate[]
): void {
  const compact = normalizeCompact(trimmed);
  if (!compact) return;

  if (master.lotes.has(compact)) {
    out.push({
      field: "lote",
      score: 0.99,
      reason: `"${trimmed}" es un lote ya existente en GENUS OS.`,
      normalizedValue: compact,
    });
    return;
  }

  const shape = loteShape(trimmed);
  if (master.loteShapes.has(shape)) {
    out.push({
      field: "lote",
      score: 0.9,
      reason: `"${trimmed}" tiene el mismo formato que lotes reales ya cargados (${shape.replace(/A/g, "letra").replace(/9/g, "0")}).`,
      normalizedValue: compact,
    });
    return;
  }

  if (GENERIC_LOTE_PATTERN.test(compact)) {
    out.push({
      field: "lote",
      score: 0.55,
      reason: `"${trimmed}" tiene forma de lote (letras + números) pero no coincide con ningún lote histórico.`,
      normalizedValue: compact,
    });
  }
}

function pushVtoCandidate(trimmed: string, out: SmartPasteFieldCandidate[]): void {
  const parsed = parseVtoCandidate(trimmed);
  if (!parsed) return;
  out.push({
    field: "vto",
    score: 0.95,
    reason: `"${trimmed}" es una fecha de vencimiento válida (${parsed.iso}).`,
    normalizedValue: parsed.iso,
  });
}

function pushCantidadCandidate(trimmed: string, out: SmartPasteFieldCandidate[]): void {
  const amount = parseNonNegativeAmount(trimmed);
  if (amount === null) return;
  // Un número que TAMBIÉN tiene pinta de lote (ej. "130826") es más ambiguo
  // — se refleja en un score menor, nunca en descartar el candidato.
  const looksLikeLoteToo = GENERIC_LOTE_PATTERN.test(normalizeCompact(trimmed)) && /^\d+$/.test(trimmed.trim());
  out.push({
    field: "cantidad",
    score: looksLikeLoteToo ? 0.45 : 0.85,
    reason: looksLikeLoteToo
      ? `"${trimmed}" es numérico — podría ser cantidad, pero también tiene 6 dígitos como un lote real.`
      : `"${trimmed}" es un valor numérico — candidato a cantidad.`,
    normalizedValue: String(amount),
  });
}

function pushClienteCandidate(
  trimmed: string,
  master: SmartPasteMasterData,
  out: SmartPasteFieldCandidate[]
): void {
  const normalized = normalizeText(trimmed);
  const known = master.clientesByNormalized.get(normalized);
  if (known) {
    out.push({
      field: "cliente",
      score: 0.95,
      reason: `"${trimmed}" coincide con el cliente/marca "${known}" ya registrado.`,
      normalizedValue: known,
    });
    return;
  }
  if (looksLikeFreeText(trimmed)) {
    out.push({
      field: "cliente",
      score: 0.2,
      reason: `"${trimmed}" es texto sin coincidencia con ningún cliente conocido.`,
    });
  }
}

function pushProductoCandidate(
  trimmed: string,
  master: SmartPasteMasterData,
  out: SmartPasteFieldCandidate[]
): void {
  const normalized = normalizeText(trimmed);
  const known = master.productosByNormalized.get(normalized);
  if (known) {
    out.push({
      field: "producto",
      score: 0.95,
      reason: `"${trimmed}" coincide con el producto "${known}" ya registrado.`,
      normalizedValue: known,
    });
    return;
  }
  if (looksLikeFreeText(trimmed)) {
    out.push({
      field: "producto",
      score: 0.22,
      reason: `"${trimmed}" es texto sin coincidencia con ningún producto conocido.`,
    });
  }
}

function pushCodigoCandidate(
  trimmed: string,
  master: SmartPasteMasterData,
  out: SmartPasteFieldCandidate[]
): void {
  const normalized = normalizeText(trimmed);
  const known = master.codigosByNormalized.get(normalized);
  if (known) {
    out.push({
      field: "codigo",
      score: 0.9,
      reason: `"${trimmed}" coincide con el código "${known}" ya registrado.`,
      normalizedValue: known,
    });
  }
}

/** Texto plausible (no puramente numérico, no vacío, longitud razonable) — nunca decide por sí solo, solo habilita el candidato. */
function looksLikeFreeText(trimmed: string): boolean {
  if (/^\d+([.,]\d+)?$/.test(trimmed)) return false;
  return trimmed.length >= 2 && trimmed.length <= 80;
}

/**
 * Boost relacional (mensaje 2, punto 8): si un candidato CLIENTE y un
 * candidato PRODUCTO de la MISMA fila ya aparecieron juntos históricamente,
 * su score sube — GENUS OS "recuerda" su propia historia operativa.
 * Se aplica DESPUÉS de clasificar cada celda por separado, sobre la fila
 * completa (ver row-resolver.ts).
 */
export function applyRelationalBoost(
  clienteCandidate: SmartPasteFieldCandidate,
  productoCandidate: SmartPasteFieldCandidate,
  master: SmartPasteMasterData
): { cliente: SmartPasteFieldCandidate; producto: SmartPasteFieldCandidate } {
  const clienteNorm = normalizeText(clienteCandidate.normalizedValue ?? "");
  const productoNorm = normalizeText(productoCandidate.normalizedValue ?? "");
  if (!clienteNorm || !productoNorm) return { cliente: clienteCandidate, producto: productoCandidate };
  const known = master.productoClientePairs.has(`${productoNorm}::${clienteNorm}`);
  if (!known) return { cliente: clienteCandidate, producto: productoCandidate };
  const boost = 0.15;
  return {
    cliente: {
      ...clienteCandidate,
      score: Math.min(0.99, clienteCandidate.score + boost),
      reason: `${clienteCandidate.reason} Además, ya está relacionado históricamente con "${productoCandidate.normalizedValue}".`,
    },
    producto: {
      ...productoCandidate,
      score: Math.min(0.99, productoCandidate.score + boost),
      reason: `${productoCandidate.reason} Además, ya está relacionado históricamente con "${clienteCandidate.normalizedValue}".`,
    },
  };
}
