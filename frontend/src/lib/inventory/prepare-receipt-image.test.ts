import { describe, expect, it } from "vitest";
import { needsShrink, scaleFor, SHRINK_STEPS, withRetry } from "./prepare-receipt-image";

describe("prepare-receipt-image", () => {
  it("los PDF y los JPG/PNG chicos van tal cual; una foto grande o HEIC se recomprime", () => {
    expect(needsShrink({ name: "r.pdf", type: "application/pdf", size: 9e6 })).toBe(false);
    expect(needsShrink({ name: "r.jpg", type: "image/jpeg", size: 1e6 })).toBe(false);
    expect(needsShrink({ name: "r.jpg", type: "image/jpeg", size: 6e6 })).toBe(true);
    expect(needsShrink({ name: "r.heic", type: "image/heic", size: 1e6 })).toBe(true);
  });
  it("nunca agranda y respeta el lado mayor", () => {
    expect(scaleFor(4000, 3000, 2400)).toBeCloseTo(0.6);
    expect(scaleFor(1000, 800, 2400)).toBe(1);
  });
  it("los pasos reducen siempre calidad o tamaño", () => {
    for (let i = 1; i < SHRINK_STEPS.length; i++) {
      const a = SHRINK_STEPS[i - 1]!, b = SHRINK_STEPS[i]!;
      expect(b.maxSide <= a.maxSide && b.quality <= a.quality && (b.maxSide < a.maxSide || b.quality < a.quality)).toBe(true);
    }
  });
  it("reintenta fallas transitorias y se rinde con la última", async () => {
    let n = 0;
    await expect(withRetry(async () => { n++; if (n < 3) throw new Error("red"); return "ok"; }, { baseMs: 1 })).resolves.toBe("ok");
    n = 0;
    await expect(withRetry(async () => { n++; throw new Error("fin"); }, { baseMs: 1, tries: 2 })).rejects.toThrow("fin");
    expect(n).toBe(2);
    n = 0;
    await expect(withRetry(async () => { n++; throw new Error("400"); }, { baseMs: 1, retryable: () => false })).rejects.toThrow("400");
    expect(n).toBe(1);
  });
});
