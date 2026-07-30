"use client";

import type { ReactNode } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils/cn";

interface OsClampedTextProps {
  children: ReactNode;
  /** Texto completo para tooltip (si difiere del children). */
  fullText?: string;
  className?: string;
  lines?: 1 | 2;
  mono?: boolean;
}

/**
 * Texto de celda: máx. 2 líneas + ellipsis + tooltip oscuro con valor completo.
 * No usa break-all.
 */
export function OsClampedText({
  children,
  fullText,
  className,
  lines = 2,
  mono = false,
}: OsClampedTextProps) {
  const tip =
    fullText ??
    (typeof children === "string" || typeof children === "number"
      ? String(children)
      : undefined);

  const inner = (
    <span
      className={cn(
        mono ? "os-mono-id" : "os-cell-clamp",
        lines === 1 && !mono && "line-clamp-1",
        className
      )}
    >
      {children}
    </span>
  );

  if (!tip || tip.trim() === "" || tip === "—") {
    return inner;
  }

  return (
    <TooltipProvider delayDuration={280}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="block min-w-0 max-w-full cursor-default">{inner}</span>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          className="max-w-sm border-[var(--os-border)] bg-[var(--os-surface-glass-strong,var(--os-surface))] text-[var(--os-text)] shadow-[var(--os-shadow-md)]"
        >
          {tip}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
