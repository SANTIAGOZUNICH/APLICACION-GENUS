import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

interface MainContentProps {
  children: ReactNode;
  className?: string;
}

export function MainContent({ children, className }: MainContentProps) {
  return (
    <main
      className={cn(
        "flex-1 overflow-y-auto bg-[var(--background)]",
        className
      )}
    >
      <div className="mx-auto w-full max-w-[75rem] px-4 py-6 lg:px-6 lg:py-8">
        {children}
      </div>
    </main>
  );
}
