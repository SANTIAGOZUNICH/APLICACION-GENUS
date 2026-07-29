import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getNeonReadCache,
  invalidateNeonReadCache,
  setNeonReadCache,
  withNeonReadCache,
} from "@/lib/db/neon-read-cache";

describe("neon-read-cache", () => {
  afterEach(() => {
    invalidateNeonReadCache();
    vi.useRealTimers();
  });

  it("devuelve miss y luego hit dentro del TTL", async () => {
    let loads = 0;
    const v1 = await withNeonReadCache("k1", 5_000, async () => {
      loads += 1;
      return { n: 1 };
    });
    const v2 = await withNeonReadCache("k1", 5_000, async () => {
      loads += 1;
      return { n: 2 };
    });
    expect(v1).toEqual({ n: 1 });
    expect(v2).toEqual({ n: 1 });
    expect(loads).toBe(1);
  });

  it("expira y vuelve a cargar", async () => {
    vi.useFakeTimers();
    setNeonReadCache("k2", "a", 1_000);
    expect(getNeonReadCache<string>("k2")).toBe("a");
    vi.advanceTimersByTime(1_001);
    expect(getNeonReadCache<string>("k2")).toBeNull();
  });

  it("invalida por prefijo", () => {
    setNeonReadCache("remitos:all", [1], 60_000);
    setNeonReadCache("remitos:one", 2, 60_000);
    setNeonReadCache("other", 3, 60_000);
    invalidateNeonReadCache("remitos:");
    expect(getNeonReadCache("remitos:all")).toBeNull();
    expect(getNeonReadCache("remitos:one")).toBeNull();
    expect(getNeonReadCache("other")).toBe(3);
  });
});
