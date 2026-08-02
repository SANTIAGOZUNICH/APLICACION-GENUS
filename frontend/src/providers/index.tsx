import type { ReactNode } from "react";
import { ThemeProvider } from "./theme-provider";
import { PwaRuntime } from "@/features/os/pwa/pwa-runtime";

interface ProvidersProps {
  children: ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  return (
    <ThemeProvider>
      <PwaRuntime />
      {children}
    </ThemeProvider>
  );
}
