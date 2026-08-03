/**
 * @vitest-environment happy-dom
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { InstallGenusOsButton } from "./install-genus-os-button";
import {
  __resetDeferredInstallPromptForTests,
  ensureDeferredInstallPromptCapture,
  type BeforeInstallPromptEventLike,
} from "./deferred-install-prompt";

function stubMatchMedia(standalone = false) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) =>
      ({
        matches: query.includes("standalone") ? standalone : false,
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      }) as MediaQueryList,
  });
}

function dispatchBip(outcome: "accepted" | "dismissed" = "accepted") {
  const prompt = vi.fn(async () => undefined);
  const event = new Event("beforeinstallprompt") as BeforeInstallPromptEventLike;
  Object.defineProperty(event, "prompt", { value: prompt, configurable: true });
  Object.defineProperty(event, "userChoice", {
    value: Promise.resolve({ outcome }),
    configurable: true,
  });
  window.dispatchEvent(event);
  return prompt;
}

describe("InstallGenusOsButton one-click native install", () => {
  afterEach(() => {
    cleanup();
    __resetDeferredInstallPromptForTests();
    vi.restoreAllMocks();
  });

  it("one click calls prompt() once and does not open intermediate Instalar ahora modal", async () => {
    stubMatchMedia(false);
    Object.defineProperty(navigator, "userAgent", {
      configurable: true,
      value:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });

    ensureDeferredInstallPromptCapture();
    const prompt = dispatchBip("accepted");

    render(<InstallGenusOsButton variant="login" />);
    fireEvent.click(screen.getByRole("button", { name: "Instalar Genus OS" }));

    await waitFor(() => expect(prompt).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText("Instalar ahora")).toBeNull();
  });

  it("standalone shows already-installed label and does not open a modal", () => {
    stubMatchMedia(true);
    render(<InstallGenusOsButton variant="login" />);
    const button = screen.getByRole("button", { name: "Genus OS ya está instalada" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("iPhone Safari opens short share guide without Instalar ahora", () => {
    stubMatchMedia(false);
    Object.defineProperty(navigator, "userAgent", {
      configurable: true,
      value:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    });
    Object.defineProperty(navigator, "platform", { configurable: true, value: "iPhone" });

    render(<InstallGenusOsButton variant="login" />);
    fireEvent.click(screen.getByRole("button", { name: "Instalar Genus OS" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText(/Agregar a inicio/i)).toBeTruthy();
    expect(screen.queryByText("Instalar ahora")).toBeNull();
  });
});
