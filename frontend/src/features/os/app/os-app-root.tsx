"use client";

import { PreviewProvider, usePreviewContext } from "@/features/os/session/preview-context";
import { SectorLogin } from "@/features/sectors/components/sector-login";
import { TwinRouter } from "./twin-app";

function TwinAppInner() {
  const { session } = usePreviewContext();
  if (!session) return <SectorLogin />;
  return <TwinRouter />;
}

/** Shared OS app root — entry for /design-preview, /mi-trabajo, /plan-semanal, /consulta. */
export function OsAppRoot() {
  return (
    <PreviewProvider>
      <div className="design-preview-root min-h-dvh bg-[var(--os-bg)]">
        <TwinAppInner />
      </div>
    </PreviewProvider>
  );
}
