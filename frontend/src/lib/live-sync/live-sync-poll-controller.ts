/**
 * Controlador de polling liviano cliente → /live-sync/check.
 * Framework-agnóstico para tests (visibility, overlap, backoff).
 */

export const LIVE_SYNC_POLL_BASE_MS = 3_000;
export const LIVE_SYNC_POLL_BACKOFF_STEPS_MS = [3_000, 5_000, 10_000, 30_000] as const;

export interface LiveSyncCheckClientResult {
  changed: boolean;
  version: string;
  revision?: number;
  checkedAt: string;
  workItems?: unknown[];
  counts?: unknown;
}

export interface LiveSyncPollControllerOptions {
  check: (
    knownVersion: string | null,
    signal: AbortSignal
  ) => Promise<LiveSyncCheckClientResult>;
  onChanged: (result: LiveSyncCheckClientResult) => void;
  isVisible: () => boolean;
  baseIntervalMs?: number;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
}

export function nextPollDelayMs(currentDelayMs: number, ok: boolean): number {
  if (ok) return LIVE_SYNC_POLL_BASE_MS;
  const steps = LIVE_SYNC_POLL_BACKOFF_STEPS_MS;
  const idx = steps.findIndex((step) => step === currentDelayMs);
  if (idx === -1) {
    const next = steps.find((step) => step > currentDelayMs);
    return next ?? steps[steps.length - 1]!;
  }
  return steps[Math.min(idx + 1, steps.length - 1)]!;
}

export function createLiveSyncPollController(options: LiveSyncPollControllerOptions) {
  const baseIntervalMs = options.baseIntervalMs ?? LIVE_SYNC_POLL_BASE_MS;
  const setTimeoutFn = options.setTimeoutFn ?? setTimeout;
  const clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout;

  let knownVersion: string | null = null;
  let delayMs = baseIntervalMs;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<void> | null = null;
  let aborted = false;
  let controller = new AbortController();

  const clearTimer = () => {
    if (timer !== null) {
      clearTimeoutFn(timer);
      timer = null;
    }
  };

  const schedule = (ms: number) => {
    clearTimer();
    if (aborted) return;
    timer = setTimeoutFn(() => {
      void tick();
    }, ms);
  };

  const tick = async (force = false) => {
    if (aborted) return;
    if (!force && !options.isVisible()) return;
    if (inFlight) return;

    inFlight = (async () => {
      try {
        const result = await options.check(knownVersion, controller.signal);
        if (aborted) return;

        knownVersion = result.version;
        delayMs = nextPollDelayMs(delayMs, true);

        if (result.changed) {
          options.onChanged(result);
        }
      } catch {
        if (aborted) return;
        delayMs = nextPollDelayMs(delayMs, false);
      } finally {
        inFlight = null;
        if (!aborted && options.isVisible()) {
          schedule(delayMs);
        }
      }
    })();

    await inFlight;
  };

  return {
    start() {
      aborted = false;
      controller = new AbortController();
      delayMs = baseIntervalMs;
      void tick(true);
    },
    stop() {
      aborted = true;
      clearTimer();
      controller.abort();
      inFlight = null;
    },
    onVisibilityChange() {
      if (aborted) return;
      if (options.isVisible()) {
        delayMs = baseIntervalMs;
        void tick(true);
      } else {
        clearTimer();
      }
    },
    getKnownVersion() {
      return knownVersion;
    },
    getDelayMs() {
      return delayMs;
    },
    isInFlight() {
      return inFlight !== null;
    },
  };
}

export type LiveSyncPollController = ReturnType<typeof createLiveSyncPollController>;
