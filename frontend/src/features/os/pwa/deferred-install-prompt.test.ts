/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __resetDeferredInstallPromptForTests,
  clearDeferredInstallPrompt,
  ensureDeferredInstallPromptCapture,
  getDeferredInstallPrompt,
  hasDeferredInstallPrompt,
  promptNativeInstall,
  subscribeDeferredInstallPrompt,
  wasAppInstalledEventSeen,
  type BeforeInstallPromptEventLike,
} from "./deferred-install-prompt";

function dispatchBip(outcome: "accepted" | "dismissed" = "accepted") {
  const prompt = vi.fn(async () => undefined);
  const event = new Event("beforeinstallprompt") as BeforeInstallPromptEventLike;
  Object.defineProperty(event, "prompt", { value: prompt, configurable: true });
  Object.defineProperty(event, "userChoice", {
    value: Promise.resolve({ outcome }),
    configurable: true,
  });
  window.dispatchEvent(event);
  return { prompt, event };
}

describe("deferred-install-prompt", () => {
  afterEach(() => {
    __resetDeferredInstallPromptForTests();
    vi.restoreAllMocks();
  });

  it("captures beforeinstallprompt globally and keeps it across subscribers", () => {
    ensureDeferredInstallPromptCapture();
    const seen: boolean[] = [];
    const unsub = subscribeDeferredInstallPrompt(() => {
      seen.push(hasDeferredInstallPrompt());
    });

    dispatchBip();
    expect(hasDeferredInstallPrompt()).toBe(true);
    expect(getDeferredInstallPrompt()).toBeTruthy();
    expect(seen.some(Boolean)).toBe(true);
    unsub();
  });

  it("promptNativeInstall calls prompt exactly once and clears the event", async () => {
    ensureDeferredInstallPromptCapture();
    const { prompt } = dispatchBip("accepted");

    const first = await promptNativeInstall();
    const second = await promptNativeInstall();

    expect(first).toBe("accepted");
    expect(second).toBeNull();
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(hasDeferredInstallPrompt()).toBe(false);
    expect(wasAppInstalledEventSeen()).toBe(true);
  });

  it("cancelled choice does not mark installed and clears deferred event", async () => {
    ensureDeferredInstallPromptCapture();
    dispatchBip("dismissed");

    const outcome = await promptNativeInstall();
    expect(outcome).toBe("dismissed");
    expect(wasAppInstalledEventSeen()).toBe(false);
    expect(hasDeferredInstallPrompt()).toBe(false);
  });

  it("appinstalled clears deferred prompt", () => {
    ensureDeferredInstallPromptCapture();
    dispatchBip();
    expect(hasDeferredInstallPrompt()).toBe(true);

    window.dispatchEvent(new Event("appinstalled"));
    expect(hasDeferredInstallPrompt()).toBe(false);
    expect(wasAppInstalledEventSeen()).toBe(true);
  });

  it("adopts event stashed by bootstrap on window", () => {
    const prompt = vi.fn(async () => undefined);
    const bip = {
      preventDefault: vi.fn(),
      prompt,
      userChoice: Promise.resolve({ outcome: "accepted" as const }),
    } as BeforeInstallPromptEventLike;
    window.__genusDeferredInstall = bip;
    ensureDeferredInstallPromptCapture();
    expect(hasDeferredInstallPrompt()).toBe(true);
    clearDeferredInstallPrompt();
    expect(hasDeferredInstallPrompt()).toBe(false);
  });
});
