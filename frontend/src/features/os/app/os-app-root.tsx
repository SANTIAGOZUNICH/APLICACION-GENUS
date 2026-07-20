"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { PreviewProvider, usePreviewContext } from "@/features/os/session/preview-context";
import { isAuthenticatedPreview } from "@/features/os/auth/lib/auth-session-helpers";
import { OperationalStoreProvider } from "@/features/os/operational";
import { WorkspaceProvider } from "@/features/os/workspace/workspace-provider";
import { CreamyChatProvider } from "@/features/os/assistant/creamy-chat-context";
import type { TwinNavEntry } from "@/features/os/navigation/twin-nav";
import { TwinRouter } from "./twin-app";

function TwinAppInner() {
  const { session } = usePreviewContext();
  const router = useRouter();

  useEffect(() => {
    // La sesión React hidrata desde storage vía PreviewProvider (useLayoutEffect);
    // solo redirigimos si storage tampoco tiene sesión — evita el falso-negativo
    // del primer render, que causaría un loop /login ↔ /mi-trabajo.
    if (!session && !isAuthenticatedPreview()) router.replace("/login");
  }, [session, router]);

  if (!session) return null;
  return <TwinRouter />;
}

export interface OsAppRootProps {
  initialNav?: TwinNavEntry;
}

/** Shared OS app root — entry for /design-preview, /mi-trabajo, /plan-semanal, /consulta. */
export function OsAppRoot({ initialNav }: OsAppRootProps = {}) {
  return (
    <PreviewProvider initialNav={initialNav}>
      <OperationalStoreProvider>
        <CreamyChatProvider>
          <WorkspaceProvider>
            <div className="design-preview-root min-h-dvh bg-[var(--os-bg)]">
              <TwinAppInner />
            </div>
          </WorkspaceProvider>
        </CreamyChatProvider>
      </OperationalStoreProvider>
    </PreviewProvider>
  );
}
