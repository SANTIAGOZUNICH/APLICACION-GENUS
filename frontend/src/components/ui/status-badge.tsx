import { cva, type VariantProps } from "class-variance-authority";
import { createElement } from "react";
import { cn } from "@/lib/utils/cn";
import {
  getStatusBadgeClasses,
  getStatusIcon,
  getStatusLabel,
} from "@/lib/tokens/status-map";
import type { Status } from "@/types/ui/status";

const statusBadgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full font-medium whitespace-nowrap",
  {
    variants: {
      size: {
        sm: "px-2 py-0.5 text-[var(--text-caption)] [&_svg]:size-3",
        md: "px-2.5 py-0.5 text-xs [&_svg]:size-3.5",
        lg: "px-3 py-1 text-sm [&_svg]:size-4",
      },
    },
    defaultVariants: {
      size: "md",
    },
  }
);

export interface StatusBadgeProps extends VariantProps<typeof statusBadgeVariants> {
  /** Canonical status — resolved via status-map.ts */
  status: Status;
  /** Hide icon (e.g. dense tables) */
  hideIcon?: boolean;
  className?: string;
}

export function StatusBadge({
  status,
  size,
  hideIcon = false,
  className,
}: StatusBadgeProps) {
  const { bg, text } = getStatusBadgeClasses(status);
  const label = getStatusLabel(status);

  return (
    <span
      className={cn(statusBadgeVariants({ size, className }))}
      style={{ backgroundColor: bg, color: text }}
      role="status"
      aria-label={label}
    >
      {!hideIcon &&
        createElement(getStatusIcon(status), { "aria-hidden": true })}
      {label}
    </span>
  );
}

export { statusBadgeVariants };
