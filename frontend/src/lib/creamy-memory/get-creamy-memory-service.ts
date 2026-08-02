import "server-only";

import { MemoryCreamyMemoryRepository } from "@/lib/creamy-memory/memory-repository";
import { DrizzleCreamyMemoryRepository } from "@/lib/creamy-memory/drizzle-repository";
import type { CreamyMemoryRepository } from "@/lib/creamy-memory/repository";
import { isDatabaseConfigured } from "@/lib/db/client";
import { CreamyMemoryService } from "@/lib/creamy-memory/service";

let sharedMemoryRepository: MemoryCreamyMemoryRepository | null = null;
let durableMemoryRepository: DrizzleCreamyMemoryRepository | null = null;
let resilientDurableRepository: CreamyMemoryRepository | null = null;
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

function shouldUseDurableRepository(): boolean {
  if (process.env.CREAMY_MEMORY_BACKEND === "memory") return false;
  return process.env.CREAMY_MEMORY_BACKEND === "neon" ||
    (process.env.VERCEL_ENV === "preview" && isDatabaseConfigured());
}

/** Missing 0015/0017 tables and transient Neon errors keep Creamy usable in Preview. */
function getResilientDurableRepository(): CreamyMemoryRepository {
  if (resilientDurableRepository) return resilientDurableRepository;
  durableMemoryRepository ??= new DrizzleCreamyMemoryRepository();
  const fallback = getSharedMemoryRepository();
  resilientDurableRepository = new Proxy(durableMemoryRepository, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") return value;
      return async (...args: unknown[]) => {
        try {
          return await value.apply(target, args);
        } catch (error) {
          console.warn("[creamy-memory] Neon unavailable; using process-memory fallback.", error);
          const fallbackMethod = fallback[prop as keyof CreamyMemoryRepository] as (...methodArgs: unknown[]) => Promise<unknown>;
          return fallbackMethod.apply(fallback, args);
        }
      };
    },
  }) as CreamyMemoryRepository;
  return resilientDurableRepository;
}

export function getCreamyMemoryService(): CreamyMemoryService {
  if (overrideRepository) return new CreamyMemoryService(overrideRepository);
  if (shouldUseDurableRepository()) {
    return new CreamyMemoryService(getResilientDurableRepository());
  }
  return new CreamyMemoryService(getSharedMemoryRepository());
}

export function isCreamyMemoryDurable(): boolean {
  return !overrideRepository && shouldUseDurableRepository();
}
