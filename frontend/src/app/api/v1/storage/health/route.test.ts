import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/v1/storage/health/route";

const ENV_KEYS = [
  "GENUS_FILE_STORAGE",
  "BLOB_STORE_ID",
  "VERCEL_OIDC_TOKEN",
  "BLOB_READ_WRITE_TOKEN",
  "BLOB_WEBHOOK_PUBLIC_KEY",
  "VERCEL",
] as const;

describe("GET /api/v1/storage/health", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    for (const k of ENV_KEYS) delete process.env[k];
    process.env.GENUS_FILE_STORAGE = "vercel_blob";
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("OIDC health sin secretos", async () => {
    process.env.BLOB_STORE_ID = "store_must_not_leak";
    process.env.VERCEL_OIDC_TOKEN = "oidc_must_not_leak";
    process.env.BLOB_WEBHOOK_PUBLIC_KEY = "webhook_must_not_leak";
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      provider: "VERCEL_BLOB_PRIVATE",
      configured: true,
      authMode: "OIDC",
      storeConfigured: true,
    });
    const raw = JSON.stringify(body);
    expect(raw).not.toContain("store_must_not_leak");
    expect(raw).not.toContain("oidc_must_not_leak");
    expect(raw).not.toContain("webhook_must_not_leak");
  });

  it("TOKEN health local", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "rw_must_not_leak";
    const res = await GET();
    const body = await res.json();
    expect(body.configured).toBe(true);
    expect(body.authMode).toBe("TOKEN");
    expect(JSON.stringify(body)).not.toContain("rw_must_not_leak");
  });

  it("NONE cuando no hay auth", async () => {
    const res = await GET();
    expect(await res.json()).toEqual({
      provider: "VERCEL_BLOB_PRIVATE",
      configured: false,
      authMode: "NONE",
      storeConfigured: false,
    });
  });
});
