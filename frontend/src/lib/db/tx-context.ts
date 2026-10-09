/**
 * Transacción "ambiente" (AsyncLocalStorage): permite que servicios existentes que no reciben un `tx` (p. ej. el libro
 * mayor de MP) escriban DENTRO de la transacción de quien los llama. Así una operación de MP (lote JSONB + movimiento
 * del libro mayor + auditoría) se confirma o se descarta entera, en vez de quedar a medias en dos conexiones.
 */
import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";
import type { getDb } from "@/lib/db/client";

export type DbTx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

const storage = new AsyncLocalStorage<DbTx>();

/** Transacción en curso (o null si no hay ninguna). */
export function currentTx(): DbTx | null {
  return storage.getStore() ?? null;
}

/** Ejecuta `fn` con `tx` como transacción ambiente. */
export function runWithTx<T>(tx: DbTx, fn: () => Promise<T>): Promise<T> {
  return storage.run(tx, fn);
}
