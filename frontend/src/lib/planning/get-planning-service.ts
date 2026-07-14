import "server-only";

import { isDatabaseConfigured } from "@/lib/db/client";
import { DrizzlePlanningRepository } from "@/lib/planning/drizzle-repository";
import { MemoryPlanningRepository } from "@/lib/planning/memory-repository";
import { PlanningService } from "@/lib/planning/planning-service";
import { isNativePlanningEnabled } from "@/lib/planning/planning-source";

let memorySingleton: MemoryPlanningRepository | null = null;

/**
 * En tests se puede inyectar con setPlanningServiceForTests.
 * En runtime native usa Drizzle si hay DATABASE_URL; memory solo para unit tests.
 */
let override: PlanningService | null = null;

export function setPlanningServiceForTests(service: PlanningService | null) {
  override = service;
}

export function getMemoryRepositoryForTests(): MemoryPlanningRepository {
  memorySingleton = new MemoryPlanningRepository();
  return memorySingleton;
}

export function getPlanningService(): PlanningService {
  if (override) return override;
  if (!isNativePlanningEnabled()) {
    throw new Error("Planificación nativa deshabilitada (GENUS_PLANNING_SOURCE≠native).");
  }
  if (!isDatabaseConfigured()) {
    throw new Error("DATABASE_URL no configurada para planificación nativa.");
  }
  return new PlanningService(new DrizzlePlanningRepository());
}
