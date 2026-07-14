import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createLiveSyncPollController,
  nextPollDelayMs,
  LIVE_SYNC_POLL_BASE_MS,
} from "@/lib/live-sync/live-sync-poll-controller";

describe("live-sync-poll-controller", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("backoff gradual 3s → 5s → 10s → 30s y reset tras éxito", () => {
    expect(nextPollDelayMs(3_000, false)).toBe(5_000);
    expect(nextPollDelayMs(5_000, false)).toBe(10_000);
    expect(nextPollDelayMs(10_000, false)).toBe(30_000);
    expect(nextPollDelayMs(30_000, false)).toBe(30_000);
    expect(nextPollDelayMs(30_000, true)).toBe(LIVE_SYNC_POLL_BASE_MS);
  });

  it("evita requests superpuestos", async () => {
    let resolveCheck!: (value: {
      changed: boolean;
      version: string;
      checkedAt: string;
    }) => void;
    let checks = 0;

    const poll = createLiveSyncPollController({
      isVisible: () => true,
      check: () => {
        checks += 1;
        return new Promise((resolve) => {
          resolveCheck = resolve;
        });
      },
      onChanged: () => {},
    });

    poll.start();
    await Promise.resolve();
    expect(checks).toBe(1);
    expect(poll.isInFlight()).toBe(true);

    poll.onVisibilityChange();
    await Promise.resolve();
    expect(checks).toBe(1);

    resolveCheck!({
      changed: false,
      version: "v1",
      checkedAt: new Date().toISOString(),
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(poll.getKnownVersion()).toBe("v1");
    poll.stop();
  });

  it("pestaña oculta pausa y al volver hace check inmediato", async () => {
    vi.useFakeTimers();
    let visible = true;
    let checks = 0;

    const poll = createLiveSyncPollController({
      isVisible: () => visible,
      check: async () => {
        checks += 1;
        return {
          changed: false,
          version: `v${checks}`,
          checkedAt: new Date().toISOString(),
        };
      },
      onChanged: () => {},
    });

    poll.start();
    await Promise.resolve();
    expect(checks).toBe(1);

    visible = false;
    poll.onVisibilityChange();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(checks).toBe(1);

    visible = true;
    poll.onVisibilityChange();
    await Promise.resolve();
    expect(checks).toBe(2);
    poll.stop();
  });

  it("error 429 / fallo activa backoff y éxito reinicia a 3s", async () => {
    vi.useFakeTimers();
    let mode: "fail" | "ok" = "fail";
    const onChanged = vi.fn();

    const poll = createLiveSyncPollController({
      isVisible: () => true,
      check: async () => {
        if (mode === "fail") throw new Error("RATE_LIMITED");
        return {
          changed: true,
          version: "v2",
          checkedAt: new Date().toISOString(),
        };
      },
      onChanged,
    });

    poll.start();
    await Promise.resolve();
    expect(poll.getDelayMs()).toBe(5_000);

    await vi.advanceTimersByTimeAsync(5_000);
    await Promise.resolve();
    expect(poll.getDelayMs()).toBe(10_000);

    mode = "ok";
    await vi.advanceTimersByTimeAsync(10_000);
    await Promise.resolve();
    expect(poll.getDelayMs()).toBe(3_000);
    expect(onChanged).toHaveBeenCalledTimes(1);
    poll.stop();
  });

  it("SSE caído + polling activo converge igual (changed dispara refetch)", async () => {
    const onChanged = vi.fn();
    let version = "v1";

    const poll = createLiveSyncPollController({
      isVisible: () => true,
      check: async (known) => {
        const changed = Boolean(known) && known !== version;
        return {
          changed,
          version,
          revision: changed ? 2 : 1,
          checkedAt: new Date().toISOString(),
        };
      },
      onChanged,
    });

    poll.start();
    await Promise.resolve();
    expect(onChanged).not.toHaveBeenCalled();

    version = "v2";
    poll.onVisibilityChange();
    await Promise.resolve();
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(onChanged.mock.calls[0]![0].version).toBe("v2");
    poll.stop();
  });
});
