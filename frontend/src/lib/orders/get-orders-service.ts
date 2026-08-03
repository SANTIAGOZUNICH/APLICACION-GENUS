import "server-only";

import { isDatabaseConfigured } from "@/lib/db/client";
import { DrizzleOrdersRepository } from "@/lib/orders/drizzle-repository";
import { MemoryOrdersRepository } from "@/lib/orders/memory-repository";
import { OrdersService } from "@/lib/orders/orders-service";
import { OrdersUnavailableError } from "@/lib/orders/types";

let memorySingleton: MemoryOrdersRepository | null = null;
let override: OrdersService | null = null;

export function setOrdersServiceForTests(service: OrdersService | null) {
  override = service;
}

export function getMemoryOrdersRepositoryForTests(): MemoryOrdersRepository {
  memorySingleton = new MemoryOrdersRepository();
  return memorySingleton;
}

/**
 * Órdenes legales requieren Neon en runtime.
 * Memory solo para unit tests vía setOrdersServiceForTests.
 */
export function getOrdersService(): OrdersService {
  if (override) return override;
  if (!isDatabaseConfigured()) {
    throw new OrdersUnavailableError();
  }
  return new OrdersService(new DrizzleOrdersRepository());
}

/** Solo tests: servicio sobre memoria sin tocar Neon. */
export function createMemoryOrdersService(): OrdersService {
  return new OrdersService(new MemoryOrdersRepository());
}
