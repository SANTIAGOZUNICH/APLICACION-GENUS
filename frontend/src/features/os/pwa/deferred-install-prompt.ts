/**
 * Global deferred beforeinstallprompt store.
 * Captures early (module import + optional window bootstrap) and survives remounts.
 */

export type BeforeInstallPromptEventLike = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

type Listener = () => void;

declare global {
  interface Window {
    __genusDeferredInstall?: BeforeInstallPromptEventLike | null;
    __genusInstallCaptureBound?: boolean;
    __genusInstallBootstrapBound?: boolean;
  }
}

let deferred: BeforeInstallPromptEventLike | null = null;
let installed = false;
let captureBound = false;
const listeners = new Set<Listener>();

function notify() {
  for (const listener of listeners) listener();
}

function adoptFromWindow() {
  if (typeof window === "undefined") return;
  const fromBootstrap = window.__genusDeferredInstall;
  if (fromBootstrap) {
    deferred = fromBootstrap;
  }
}

function onBeforeInstallPrompt(event: Event) {
  event.preventDefault();
  const bip = event as BeforeInstallPromptEventLike;
  deferred = bip;
  if (typeof window !== "undefined") {
    window.__genusDeferredInstall = bip;
  }
  notify();
}

function onAppInstalled() {
  installed = true;
  deferred = null;
  if (typeof window !== "undefined") {
    window.__genusDeferredInstall = null;
  }
  notify();
}

/** Bind listeners once (safe to call repeatedly). */
export function ensureDeferredInstallPromptCapture(): void {
  if (typeof window === "undefined") return;
  adoptFromWindow();
  if (captureBound || window.__genusInstallCaptureBound) return;
  captureBound = true;
  window.__genusInstallCaptureBound = true;
  window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
  window.addEventListener("appinstalled", onAppInstalled);
  window.addEventListener("genus:beforeinstallprompt", () => {
    adoptFromWindow();
    notify();
  });
  window.addEventListener("genus:appinstalled", onAppInstalled);
}

export function getDeferredInstallPrompt(): BeforeInstallPromptEventLike | null {
  adoptFromWindow();
  return deferred;
}

export function hasDeferredInstallPrompt(): boolean {
  return Boolean(getDeferredInstallPrompt());
}

export function wasAppInstalledEventSeen(): boolean {
  return installed;
}

export function clearDeferredInstallPrompt(): void {
  deferred = null;
  if (typeof window !== "undefined") {
    window.__genusDeferredInstall = null;
  }
  notify();
}

/**
 * Runs native install in the same user gesture. Returns outcome or null if unavailable.
 */
export async function promptNativeInstall(): Promise<"accepted" | "dismissed" | null> {
  const event = getDeferredInstallPrompt();
  if (!event) return null;
  await event.prompt();
  const choice = await event.userChoice;
  clearDeferredInstallPrompt();
  if (choice.outcome === "accepted") {
    installed = true;
  }
  notify();
  return choice.outcome;
}

export function subscribeDeferredInstallPrompt(listener: Listener): () => void {
  ensureDeferredInstallPromptCapture();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test helper — resets module state. */
export function __resetDeferredInstallPromptForTests(): void {
  deferred = null;
  installed = false;
  captureBound = false;
  listeners.clear();
  if (typeof window !== "undefined") {
    window.__genusDeferredInstall = null;
    window.__genusInstallCaptureBound = false;
  }
}
