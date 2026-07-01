import { cva, type VariantProps } from "class-variance-authority";
import { X } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils/cn";

const chipVariants = cva(
  "inline-flex items-center gap-1 rounded-full font-medium transition-colors",
  {
    variants: {
      variant: {
        neutral:
          "bg-[var(--badge-neutral-bg)] text-[var(--badge-neutral-text)]",
        outline:
          "border border-[var(--border)] bg-transparent text-[var(--muted-foreground)]",
        selected:
          "bg-[var(--sidebar-item-active-bg)] text-[var(--color-action)]",
      },
      size: {
        sm: "px-2 py-0.5 text-[var(--text-caption)] [&_svg]:size-3",
        md: "px-2.5 py-0.5 text-xs [&_svg]:size-3.5",
      },
      interactive: {
        true: "cursor-pointer hover:opacity-80",
        false: "",
      },
    },
    defaultVariants: {
      variant: "neutral",
      size: "md",
      interactive: false,
    },
  }
);

export interface ChipProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof chipVariants> {
  onRemove?: () => void;
  removable?: boolean;
}

const Chip = React.forwardRef<HTMLSpanElement, ChipProps>(
  (
    {
      className,
      variant,
      size,
      interactive,
      onRemove,
      removable,
      children,
      onClick,
      ...props
    },
    ref
  ) => {
    const isInteractive = interactive ?? Boolean(onClick);

    return (
      <span
        ref={ref}
        className={cn(
          chipVariants({ variant, size, interactive: isInteractive, className })
        )}
        onClick={onClick}
        role={isInteractive ? "button" : undefined}
        tabIndex={isInteractive ? 0 : undefined}
        onKeyDown={
          isInteractive
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onClick?.(e as unknown as React.MouseEvent<HTMLSpanElement>);
                }
              }
            : undefined
        }
        {...props}
      >
        {children}
        {(removable || onRemove) && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRemove?.();
            }}
            className="rounded-full p-0.5 hover:bg-black/10 dark:hover:bg-white/10"
            aria-label="Quitar"
          >
            <X className="size-3" />
          </button>
        )}
      </span>
    );
  }
);
Chip.displayName = "Chip";

export { Chip, chipVariants };
