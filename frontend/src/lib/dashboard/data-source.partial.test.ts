import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const queries: string[] = [];
vi.mock("@/lib/db/client", () => ({
  isDatabaseConfigured: () => true,
  getDb: () => ({
    execute(q: unknown) {
      queries.push(new PgDialect().sqlToQuery(q as never).sql);
      return Promise.resolve({ rows: [] });
    },
  }),
}));
vi.mock("@/lib/db/feature-schema", () => ({ isFeatureMemoryAllowed: () => false }));

import { loadDashboardData } from "./data-source";

describe("loadDashboardData — entregas parciales", () => {
  it("3) las entregas del Dashboard (KPI «entregado» y lead time) cuentan solo entregas COMPLETAS", async () => {
    await loadDashboardData();
    const deliveries = queries.find((q) => q.includes("from work_item_deliveries"));
    expect(deliveries).toBeTruthy();
    expect(deliveries).toMatch(/d\.delivery_complete = true/);
  });
});
