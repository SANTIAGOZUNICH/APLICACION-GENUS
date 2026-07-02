"use client";

import { OperationsStoreProvider } from "@/lib/operations/operations-store";
import { CurrentSectorProvider } from "@/lib/operational/current-sector-context";
import { ToastProvider } from "@/components/patterns/feedback/toast-provider";

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <OperationsStoreProvider>
      <CurrentSectorProvider>
        <ToastProvider>{children}</ToastProvider>
      </CurrentSectorProvider>
    </OperationsStoreProvider>
  );
}
