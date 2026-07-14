import { describe, expect, it } from "vitest";
import { formatUpdatedAgo, secondsSince } from "@/lib/api/live-sync-client";

describe("live-sync-client", () => {
  it("formatea segundos transcurridos", () => {
    expect(formatUpdatedAgo(null)).toBe("—");
    expect(formatUpdatedAgo(3)).toBe("ahora");
    expect(formatUpdatedAgo(12)).toBe("hace 12s");
    expect(formatUpdatedAgo(90)).toBe("hace 1 min");
  });

  it("calcula secondsSince desde ISO", () => {
    const recent = new Date(Date.now() - 5000).toISOString();
    const secs = secondsSince(recent);
    expect(secs).toBeGreaterThanOrEqual(4);
    expect(secs).toBeLessThanOrEqual(6);
  });
});
