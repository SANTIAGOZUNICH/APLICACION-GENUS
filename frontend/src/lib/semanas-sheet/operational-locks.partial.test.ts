import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const captured: unknown[] = [];
vi.mock("@/lib/db/client", () => ({
  isDatabaseConfigured: () => true,
  getDb: () => ({
    select() {
      const api = {
        from: () => api,
        where(cond: unknown) {
          captured.push(cond);
          return Promise.resolve([]);
        },
      };
      return api;
    },
  }),
}));

import { loadOperationalLocks } from "./operational-locks";

describe("loadOperationalLocks — entregas parciales", () => {
  it("3) solo una entrega COMPLETA (delivery_complete) bloquea la celda de la planilla; una parcial no", async () => {
    vi.stubEnv("NODE_ENV", "test");
    delete process.env.GENUS_SEMANAS_FIXTURE_XLSX;
    await loadOperationalLocks();
    expect(captured.length).toBeGreaterThanOrEqual(1);
    const { sql } = new PgDialect().sqlToQuery(captured[0] as never);
    expect(sql).toMatch(/"delivery_complete" = \$/);
    expect(sql).toMatch(/"status" = \$/);
  });
});
