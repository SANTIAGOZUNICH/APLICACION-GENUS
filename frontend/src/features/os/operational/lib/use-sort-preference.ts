"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Recuerda el último orden elegido EN ESTA PANTALLA, EN ESTE NAVEGADOR —
 * localStorage puro, nunca server-side, nunca ligado a usuario/rol/sesión.
 * Es intencional: así no hay riesgo de que la preferencia de una persona
 * quede pegada a otra, ni de que un cambio de permisos la exponga (mismo
 * criterio "de forma segura sin afectar usuarios/roles" pedido). Si
 * localStorage no está disponible (modo privado, cuota llena) la
 * preferencia simplemente no persiste — nunca rompe la pantalla.
 *
 * Implementado con useSyncExternalStore (no useState+useEffect) — es el
 * patrón correcto de React para una fuente externa mutable como
 * localStorage: `getServerSnapshot` hace que el render inicial en servidor
 * Y la primera pasada de hidratación en cliente coincidan exactamente
 * (siempre `defaultKey`), evitando el mismatch de hidratación; la
 * preferencia real se aplica recién después de hidratar, sin un setState
 * síncrono dentro de un efecto.
 */
const STORAGE_PREFIX = "genus_os_sort_pref:";
const listeners = new Set<() => void>();

function storageKey(screenId: string): string {
  return STORAGE_PREFIX + screenId;
}

function readStored(screenId: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(storageKey(screenId));
  } catch {
    return null;
  }
}

function writeStored(screenId: string, key: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(screenId), key);
  } catch {
    /* best-effort */
  }
  for (const listener of listeners) listener();
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

/**
 * `screenId` debe ser estable y único por pantalla (ej. "calidad-aprobados").
 * `validKeys`, si se pasa, descarta una preferencia guardada que ya no
 * exista entre las opciones actuales (ej. tras un despliegue que cambió el
 * set de opciones) en vez de dejar la pantalla en un estado inválido.
 */
export function useSortPreference(
  screenId: string,
  defaultKey: string,
  validKeys?: readonly string[]
): [string, (key: string) => void] {
  const sortKey = useSyncExternalStore(
    subscribe,
    () => {
      const stored = readStored(screenId);
      if (stored && (!validKeys || validKeys.includes(stored))) return stored;
      return defaultKey;
    },
    () => defaultKey
  );

  const setSortKey = useCallback(
    (key: string) => {
      writeStored(screenId, key);
    },
    [screenId]
  );

  return [sortKey, setSortKey];
}
