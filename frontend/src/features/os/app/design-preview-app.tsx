"use client";

import { PreviewProvider, usePreviewContext } from "@/design-preview/lib/preview-context";
import { SectorLogin } from "@/design-preview/components/sector-login";
import { TwinRouter } from "./twin-app";

function TwinAppInner() {
  const { session } = usePreviewContext();
  if (!session) return <SectorLogin />;
  return <TwinRouter />;
}

/** Digital Twin F9.6 — prototipo navegable completo del laboratorio. */
export function DesignPreviewApp() {
  return (
    <PreviewProvider>
      <div className="design-preview-root min-h-dvh bg-[var(--os-bg)]">
        <TwinAppInner />
      </div>
    </PreviewProvider>
  );
}
