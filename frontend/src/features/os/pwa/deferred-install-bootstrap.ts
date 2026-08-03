/**
 * Inline bootstrap: capture beforeinstallprompt before React hydrates.
 * Keep tiny — no secrets, no network.
 * Does not replace the React module store; only stashes the event on window.
 */
export const DEFERRED_INSTALL_BOOTSTRAP_SCRIPT = `
(function () {
  if (typeof window === "undefined") return;
  if (window.__genusInstallBootstrapBound) return;
  window.__genusInstallBootstrapBound = true;
  window.__genusDeferredInstall = window.__genusDeferredInstall || null;
  window.addEventListener("beforeinstallprompt", function (event) {
    event.preventDefault();
    window.__genusDeferredInstall = event;
    try {
      window.dispatchEvent(new CustomEvent("genus:beforeinstallprompt"));
    } catch (_) {}
  });
  window.addEventListener("appinstalled", function () {
    window.__genusDeferredInstall = null;
    try {
      window.dispatchEvent(new CustomEvent("genus:appinstalled"));
    } catch (_) {}
  });
})();
`.trim();
