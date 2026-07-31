import "server-only";

import { MemoryCreamyMemoryRepository } from "@/lib/creamy-memory/memory-repository";
import type { CreamyMemoryRepository } from "@/lib/creamy-memory/repository";
import { CreamyMemoryService } from "@/lib/creamy-memory/service";

let sharedMemoryRepository: MemoryCreamyMemoryRepository | null = null;
let overrideRepository: CreamyMemoryRepository | null = null;

/** Solo tests: inyectar un repositorio (memoria fresca, spy, etc). Pasar null para volver al default. */
export function setCreamyMemoryRepositoryForTests(repository: CreamyMemoryRepository | null): void {
  overrideRepository = repository;
}

function getSharedMemoryRepository(): MemoryCreamyMemoryRepository {
  if (!sharedMemoryRepository) {
    sharedMemoryRepository = new MemoryCreamyMemoryRepository();
  }
  return sharedMemoryRepository;
}

/**
 * Devuelve el servicio de memoria de Creamy.
 *
 * La migración 0015 (drizzle/0015_creamy_memory.sql) que crea
 * creamy_conversations / creamy_messages / creamy_user_memories /
 * creamy_operational_memories / creamy_memory_evidence /
 * creamy_memory_audit_events queda **diferida** hasta APPLY_MIGRATION_0015=1
 * (ver scripts/migrate-if-database.mjs).
 *
 * Hasta que esas tablas existan (y salvo que se inyecte un repositorio de
 * test), Creamy usa siempre `MemoryCreamyMemoryRepository`: un Map en memoria
 * de proceso mantenido como singleton a nivel de módulo. Esto permite
 * demostrar memoria funcional dentro de una misma instancia "warm" de
 * Preview, pero **no es durable** — no sobrevive reinicios ni se comparte
 * entre instancias/regiones.
 *
 * TODO(0015): una vez aplicada la migración, wirear un
 * DrizzleCreamyMemoryRepository acá (por ejemplo detectando la tabla con
 * `SELECT to_regclass('public.creamy_user_memories')` y cayendo a memoria si
 * es null), en vez de usar siempre memoria. El flag
 * `CREAMY_MEMORY_BACKEND=neon` queda reservado para ese momento.
 */
export function getCreamyMemoryService(): CreamyMemoryService {
  if (overrideRepository) return new CreamyMemoryService(overrideRepository);
  return new CreamyMemoryService(getSharedMemoryRepository());
}

/** true recién cuando 0015 esté aplicada y el adaptador Drizzle esté conectado. */
export function isCreamyMemoryDurable(): boolean {
  return false;
}
