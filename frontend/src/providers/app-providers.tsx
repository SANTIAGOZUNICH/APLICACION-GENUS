"use client";

import { OperationsStoreProvider } from "@/lib/operations/operations-store";
import { ToastProvider } from "@/components/patterns/feedback/toast-provider";

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <OperationsStoreProvider>
      <ToastProvider>{children}</ToastProvider>
    </OperationsStoreProvider>
  );
}
