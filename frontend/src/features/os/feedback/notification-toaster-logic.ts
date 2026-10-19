/** Lógica pura del aviso flotante: qué notificaciones se muestran como tarjeta y cuáles ya se mostraron. */

export type ToastCandidate = { id: string; read: boolean; createdAt: string };

/** Antigüedad máxima para mostrar una tarjeta (lo más viejo queda solo en la campana). */
export const TOAST_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const TOAST_MAX_VISIBLE = 3;

/**
 * Devuelve las notificaciones NO leídas, recientes y que todavía no se mostraron como tarjeta (más nuevas primero).
 * Así un usuario que vuelve a entrar ve lo pendiente una sola vez, y recargar la página no repite tarjetas ni sonido.
 */
export function pickToastsToShow<T extends ToastCandidate>(list: T[], shown: ReadonlySet<string>, now = Date.now()): T[] {
  return list
    .filter((n) => !n.read && !shown.has(n.id) && now - new Date(n.createdAt).getTime() <= TOAST_MAX_AGE_MS)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export function parseShownIds(raw: string | null): Set<string> {
  try {
    const arr = JSON.parse(raw ?? "[]");
    return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

export function serializeShownIds(ids: ReadonlySet<string>, max = 300): string {
  return JSON.stringify([...ids].slice(-max));
}
