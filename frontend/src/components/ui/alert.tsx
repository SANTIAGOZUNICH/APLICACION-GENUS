import { cva, type VariantProps } from "class-variance-authority";
import {
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  Info,
  type LucideIcon,
} from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";

const alertVariants = cva(
  "flex gap-3 rounded-lg border p-4 text-sm",
  {
    variants: {
      variant: {
        info: "border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)] [&_[data-alert-icon]]:text-[var(--color-neutral)]",
        attention:
          "border-[var(--color-attention)]/30 bg-[var(--badge-attention-bg)] text-[var(--foreground)] [&_[data-alert-icon]]:text-[var(--color-attention)]",
        problem:
          "border-[var(--color-problem)]/30 bg-[var(--badge-problem-bg)] text-[var(--foreground)] [&_[data-alert-icon]]:text-[var(--color-problem)]",
        ok: "border-[var(--color-ok)]/30 bg-[var(--badge-ok-bg)] text-[var(--foreground)] [&_[data-alert-icon]]:text-[var(--color-ok)]",
      },
    },
    defaultVariants: {
      variant: "info",
    },
  }
);

const alertIcons: Record<
  NonNullable<VariantProps<typeof alertVariants>["variant"]>,
  LucideIcon
> = {
  info: Info,
  attention: AlertTriangle,
  problem: AlertOctagon,
  ok: CheckCircle2,
};

export interface AlertAction {
  label: string;
  onClick?: () => void;
}

export interface AlertProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof alertVariants> {
  title?: string;
  action?: AlertAction;
  hideIcon?: boolean;
}

const Alert = React.forwardRef<HTMLDivElement, AlertProps>(
  (
    { className, variant = "info", title, action, hideIcon, children, ...props },
    ref
  ) => {
    const Icon = alertIcons[variant ?? "info"];

    return (
      <div
        ref={ref}
        role="alert"
        className={cn(alertVariants({ variant, className }))}
        {...props}
      >
        {!hideIcon && (
          <Icon data-alert-icon className="size-5 shrink-0" aria-hidden="true" />
        )}
        <div className="min-w-0 flex-1">
          {title && (
            <p className="mb-1 font-medium text-[var(--foreground)]">{title}</p>
          )}
          <div className="text-[var(--muted-foreground)]">{children}</div>
          {action && (
            <div className="mt-3">
              <Button variant="tertiary" size="sm" onClick={action.onClick}>
                {action.label}
              </Button>
            </div>
          )}
        </div>
      </div>
    );
  }
);
Alert.displayName = "Alert";

export { Alert, alertVariants };
