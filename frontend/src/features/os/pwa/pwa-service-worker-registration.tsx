"use client";

import { useEffect, useState } from "react";
import { hasBlockingOperations, subscribeOperationGuards } from "@/lib/pwa/operation-guard";

type UpdateState = "idle" | "available" | "blocked" | "applying";

function buildId(): string {
  return (process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || "dev").slice(0, 7);
}

/**
 * Registra el SW y coordina actualizaciones sin perder formularios.
 */
export function PwaServiceWorkerRegistration() {
  const [updateState, setUpdateState] = useState<UpdateState>("idle");
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);
  const [blocking, setBlocking] = useState(false);

  useEffect(() => subscribeOperationGuards(() => setBlocking(hasBlockingOperations())), []);

  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

    const sha = process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || "dev";
    let cancelled = false;

    (async () => {
      try {
        // Inyectar build en el SW vía query (el script lee self.location).
        const reg = await navigator.serviceWorker.register(`/sw.js?build=${encodeURIComponent(sha)}`, {
          scope: "/",
          updateViaCache: "none",
        });

        const trackWaiting = (worker: ServiceWorker | null) => {
          if (!worker || cancelled) return;
          setWaitingWorker(worker);
          setUpdateState(hasBlockingOperations() ? "blocked" : "available");
          worker.addEventListener("statechange", () => {
            if (worker.state === "activated" && navigator.serviceWorker.controller) {
              window.location.reload();
            }
          });
        };

        if (reg.waiting) trackWaiting(reg.waiting);

        reg.addEventListener("updatefound", () => {
          const installing = reg.installing;
          if (!installing) return;
          installing.addEventListener("statechange", () => {
            if (installing.state === "installed" && navigator.serviceWorker.controller) {
              trackWaiting(reg.waiting);
            }
          });
        });

        // Revisar updates al volver a la pestaña (sin polling agresivo).
        const onVis = () => {
          if (document.visibilityState === "visible") void reg.update();
        };
        document.addEventListener("visibilitychange", onVis);
        return () => document.removeEventListener("visibilitychange", onVis);
      } catch (error) {
        console.warn("[pwa] SW registration failed", error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (updateState === "available" && blocking) setUpdateState("blocked");
    if (updateState === "blocked" && !blocking) setUpdateState("available");
  }, [blocking, updateState]);

  const applyUpdate = () => {
    if (hasBlockingOperations()) {
      setUpdateState("blocked");
      return;
    }
    if (!waitingWorker) return;
    setUpdateState("applying");
    waitingWorker.postMessage({ type: "SKIP_WAITING" });
  };

  if (updateState === "idle" || updateState === "applying") return null;

  return (
    <div
      role="status"
      className="fixed inset-x-3 bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] z-[var(--os-z-toast,60)] mx-auto max-w-md rounded-[var(--os-radius-sm)] border border-[var(--os-border)] bg-[var(--os-surface)] p-3 shadow-[var(--os-shadow-card-hover)] sm:inset-x-auto sm:right-4 sm:left-auto"
    >
      <p className="text-sm font-medium text-[var(--os-text)]">Hay una nueva versión de Genus OS</p>
      <p className="mt-1 text-xs text-[var(--os-text-muted)]">
        Build {buildId()}
        {updateState === "blocked"
          ? " · Guardá o cerrá la operación en curso antes de actualizar."
          : " · La sesión se mantiene."}
      </p>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={updateState === "blocked"}
          onClick={applyUpdate}
          className="min-h-11 flex-1 rounded-[var(--os-radius-sm)] bg-[var(--os-teal)] px-3 text-sm font-medium text-[var(--os-navy)] disabled:opacity-50"
        >
          Actualizar ahora
        </button>
        <button
          type="button"
          onClick={() => setUpdateState("idle")}
          className="min-h-11 rounded-[var(--os-radius-sm)] border border-[var(--os-border)] px-3 text-sm text-[var(--os-text)]"
        >
          Más tarde
        </button>
      </div>
    </div>
  );
}
