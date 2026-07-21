import "server-only";

import { isDatabaseConfigured } from "@/lib/db/client";
import { memoryInventoryRepo, MemoryInventoryRepo } from "./memory-repo";
import { createInventoryService, InventoryService } from "./inventory-service";

let singleton: InventoryService | null = null;
let memoryMode = true;

/** Sin DATABASE_URL: servicio en memoria (no simula Neon; la API informa que no puede persistir). */
export function getInventoryService(): InventoryService {
  if (!singleton) {
    memoryMode = !isDatabaseConfigured();
    singleton = createInventoryService(memoryInventoryRepo);
  }
  return singleton;
}

export function isInventoryPersistenceReady(): boolean {
  return isDatabaseConfigured();
}

export function isInventoryMemoryMode(): boolean {
  return !isDatabaseConfigured() || memoryMode;
}

/** Tests: forzar repo limpio. */
export function resetInventoryServiceForTests(repo?: MemoryInventoryRepo): InventoryService {
  if (!repo) {
    memoryInventoryRepo.reset();
  }
  singleton = createInventoryService(repo ?? memoryInventoryRepo);
  memoryMode = true;
  return singleton;
}

export { memoryInventoryRepo };
