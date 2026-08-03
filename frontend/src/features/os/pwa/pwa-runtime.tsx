"use client";

import { ConnectionStatusBanner } from "@/features/os/pwa/connection-status-banner";
import { ensureDeferredInstallPromptCapture } from "@/features/os/pwa/deferred-install-prompt";
import { PwaServiceWorkerRegistration } from "@/features/os/pwa/pwa-service-worker-registration";

// Capture BIP as soon as this client module evaluates.
ensureDeferredInstallPromptCapture();

/** Runtime PWA global: SW + banner de conexión (sin cachear datos). */
export function PwaRuntime() {
  return (
    <>
      <PwaServiceWorkerRegistration />
      <div className="pointer-events-none fixed inset-x-0 top-0 z-[80]">
        <div className="pointer-events-auto">
          <ConnectionStatusBanner />
        </div>
      </div>
    </>
  );
}
