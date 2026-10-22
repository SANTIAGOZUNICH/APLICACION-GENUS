/**
 * Orden manual persistente de las planillas (Stock MP, Ingresos MP, Ingresos/Salidas/Inventario ME).
 * El orden de la hoja es `load_seq`. Mover una fila = repartir las MISMAS posiciones (`load_seq`) que ya tenían las
 * filas afectadas: no se crean ni se pierden posiciones y las demás filas no se tocan. Funciones puras.
 */
export interface SeqRow {
  id: string;
  seq: number;
}

/**
 * Deja la fila `id` justo antes de `beforeId` (null = al final). `ordered` viene ordenado por `seq` ascendente.
 * Devuelve solo las filas cuya posición cambia, con su nueva `seq`.
 */
export function planMove(ordered: SeqRow[], id: string, beforeId: string | null): SeqRow[] {
  const from = ordered.findIndex((r) => r.id === id);
  if (from < 0) throw new Error("La fila no existe.");
  if (beforeId === id) return [];
  const next = ordered.filter((r) => r.id !== id);
  let at = next.length;
  if (beforeId != null) {
    at = next.findIndex((r) => r.id === beforeId);
    if (at < 0) throw new Error("La fila de destino no existe.");
  }
  next.splice(at, 0, ordered[from]);
  const seqs = ordered.map((r) => r.seq);
  const changes: SeqRow[] = [];
  next.forEach((r, i) => {
    const old = ordered[i];
    if (old.id !== r.id) changes.push({ id: r.id, seq: seqs[i] });
  });
  return changes;
}

/** Fila antes de la cual hay que insertar para subir/bajar `steps` posiciones visibles. `visible` = ids visibles en orden. */
export function beforeIdForShift(visible: string[], id: string, direction: "up" | "down" | "top" | "bottom"): string | null | undefined {
  const i = visible.indexOf(id);
  if (i < 0) return undefined;
  if (direction === "top") return i === 0 ? undefined : visible[0];
  if (direction === "bottom") return i === visible.length - 1 ? undefined : null;
  if (direction === "up") return i === 0 ? undefined : visible[i - 1];
  if (i === visible.length - 1) return undefined;
  return i + 2 < visible.length ? visible[i + 2] : null;
}
