"use client";

import { useEffect, useState } from "react";
import { portalPwaStore } from "./pwa-store";

/**
 * Registra el service worker del portal (scope /entregas) y avisa cuando hay una versión nueva. La versión nueva no se activa sola:
 * el usuario toca «Actualizar» (SKIP_WAITING) y la página se recarga. Captura `beforeinstallprompt` para el botón «Instalar».
 */
export function PortalPwaRuntime() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    const onBip = (e: Event) => {
      e.preventDefault();
      portalPwaStore.setInstallEvent(e as never);
    };
    const onInstalled = () => portalPwaStore.setInstallEvent(null);
    // El script de arranque del layout raíz puede haber capturado el evento antes de hidratar: se toma de ahí.
    const early = (window as unknown as { __genusDeferredInstall?: Event | null }).__genusDeferredInstall;
    if (early) portalPwaStore.setInstallEvent(early as never);
    window.addEventListener("beforeinstallprompt", onBip);
    window.addEventListener("appinstalled", onInstalled);
    if (!("serviceWorker" in navigator)) return () => {
      window.removeEventListener("beforeinstallprompt", onBip);
      window.removeEventListener("appinstalled", onInstalled);
    };
    let cancelled = false;
    let reloading = false;
    const onControllerChange = () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    };
    (async () => {
      try {
        const reg = await navigator.serviceWorker.register("/entregas/sw.js", { scope: "/entregas", updateViaCache: "none" });
        if (cancelled) return;
        if (reg.waiting && navigator.serviceWorker.controller) setWaiting(reg.waiting);
        reg.addEventListener("updatefound", () => {
          const nw = reg.installing;
          nw?.addEventListener("statechange", () => {
            if (nw.state === "installed" && navigator.serviceWorker.controller) setWaiting(nw);
          });
        });
        navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
        // Busca versión nueva al volver a la app.
        const onVis = () => { if (document.visibilityState === "visible") void reg.update().catch(() => undefined); };
        document.addEventListener("visibilitychange", onVis);
      } catch {
        /* sin service worker el portal sigue funcionando igual */
      }
    })();
    return () => {
      cancelled = true;
      window.removeEventListener("beforeinstallprompt", onBip);
      window.removeEventListener("appinstalled", onInstalled);
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, []);

  if (!waiting) return null;
  return (
    <div className="gp-update-banner" role="status" data-testid="sw-update">
      <span>Hay una versión nueva del portal.</span>
      <button type="button" className="gp-btn gp-btn-primary gp-btn-sm" data-testid="sw-update-apply" onClick={() => waiting.postMessage({ type: "SKIP_WAITING" })}>Actualizar</button>
    </div>
  );
}
