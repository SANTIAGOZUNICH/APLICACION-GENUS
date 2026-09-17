import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/asignacion-lotes/asignacion-lotes-sync-service", () => ({
  syncAllEnabledSources: vi.fn().mockResolvedValue([]),
}));

describe("GET /api/cron/asignacion-lotes-sync", () => {
  const originalSecret = process.env.CRON_SECRET;

  beforeEach(() => {
    process.env.CRON_SECRET = "test-secret";
  });

  afterEach(() => {
    process.env.CRON_SECRET = originalSecret;
  });

  it("sin CRON_SECRET configurado -> 500, nunca corre sin secreto", async () => {
    delete process.env.CRON_SECRET;
    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/cron/asignacion-lotes-sync"));
    expect(res.status).toBe(500);
  });

  it("sin header Authorization -> 401", async () => {
    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/cron/asignacion-lotes-sync"));
    expect(res.status).toBe(401);
  });

  it("con el secreto correcto -> 200 y dispara la sincronización de todas las fuentes habilitadas", async () => {
    const { GET } = await import("./route");
    const res = await GET(
      new Request("http://localhost/api/cron/asignacion-lotes-sync", {
        headers: { authorization: "Bearer test-secret" },
      })
    );
    expect(res.status).toBe(200);
  });
});
