import * as React from "react";
import { cn } from "@/lib/utils/cn";

export interface FormFieldProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Stable id linking label, input and error */
  htmlFor: string;
  label: string;
  required?: boolean;
  description?: string;
  error?: string;
  children: React.ReactNode;
}

export function FormField({
  htmlFor,
  label,
  required,
  description,
  error,
  children,
  className,
  ...props
}: FormFieldProps) {
  const errorId = error ? `${htmlFor}-error` : undefined;
  const descriptionId = description ? `${htmlFor}-description` : undefined;

  return (
    <div className={cn("flex flex-col gap-1.5", className)} {...props}>
      <label
        htmlFor={htmlFor}
        className="text-sm font-medium text-[var(--foreground)]"
      >
        {label}
        {required && (
          <span className="ml-0.5 text-[var(--color-problem)]" aria-hidden="true">
            *
          </span>
        )}
      </label>
      {description && (
        <p
          id={descriptionId}
          className="text-[var(--muted-foreground)]"
          style={{ fontSize: "var(--text-meta)" }}
        >
          {description}
        </p>
      )}
      {React.isValidElement(children)
        ? React.cloneElement(children as React.ReactElement<Record<string, unknown>>, {
            id: htmlFor,
            "aria-describedby": [descriptionId, errorId].filter(Boolean).join(" ") || undefined,
            "aria-invalid": error ? true : undefined,
          })
        : children}
      {error && (
        <p
          id={errorId}
          role="alert"
          className="text-sm text-[var(--color-problem)]"
        >
          {error}
        </p>
      )}
    </div>
  );
}
