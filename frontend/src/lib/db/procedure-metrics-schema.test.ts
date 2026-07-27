import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  isProcedureMetricsSchemaReady,
  resetProcedureMetricsSchemaCache,
  ProcedureMetricsSchemaPendingError,
} from "@/lib/db/procedure-metrics-schema";

describe("procedure-metrics-schema gate", () => {
  beforeEach(() => {
    resetProcedureMetricsSchemaCache();
    vi.unstubAllEnvs();
  });

  it("ready en memoria de tests", async () => {
    vi.stubEnv("VITEST", "true");
    await expect(isProcedureMetricsSchemaReady()).resolves.toBe(true);
  });

  it("pending error tiene código 0009", () => {
    const err = new ProcedureMetricsSchemaPendingError();
    expect(err.code).toBe("SCHEMA_PENDING_0009");
    expect(err.message).toContain("pendiente");
  });

  it("sin DB ni memoria retorna false", async () => {
    vi.stubEnv("VITEST", "");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("GENUS_FEATURE_MEMORY", "");
    vi.stubEnv("DATABASE_URL", "");
    resetProcedureMetricsSchemaCache();
    await expect(isProcedureMetricsSchemaReady()).resolves.toBe(false);
  });
});
