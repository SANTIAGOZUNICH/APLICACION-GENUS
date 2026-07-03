import type { InputHTMLAttributes } from "react";

const baseInputClassName =
  "h-12 w-full rounded-[12px] border bg-[var(--os-surface)] px-4 text-[15px] text-[var(--os-text)] transition-[border-color,box-shadow] duration-200 placeholder:text-[var(--os-text-muted)]/55 focus-visible:border-[var(--os-teal)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--os-teal)]/18 disabled:cursor-not-allowed disabled:opacity-60";

interface OsAuthFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string;
  leadingIcon?: React.ReactNode;
}

/** Campo de formulario auth — 48px, radius 12px, labels visibles. */
export function OsAuthField({
  label,
  htmlFor,
  hint,
  error,
  leadingIcon,
  className = "",
  ...inputProps
}: OsAuthFieldProps) {
  const errorId = error ? `${htmlFor}-error` : undefined;
  const hintId = hint ? `${htmlFor}-hint` : undefined;

  return (
    <div className="space-y-2.5">
      <label
        htmlFor={htmlFor}
        className="block text-[0.8125rem] font-medium tracking-tight text-[var(--os-text)]"
      >
        {label}
        {inputProps.required && (
          <span className="ml-1 text-[var(--os-teal)]" aria-hidden="true">
            *
          </span>
        )}
      </label>
      {hint && (
        <p id={hintId} className="text-xs leading-relaxed text-[var(--os-text-muted)]">
          {hint}
        </p>
      )}
      <div className="relative">
        {leadingIcon && (
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4 text-[var(--os-text-muted)]/70">
            {leadingIcon}
          </div>
        )}
        <input
          id={htmlFor}
          aria-describedby={[hintId, errorId].filter(Boolean).join(" ") || undefined}
          aria-invalid={error ? true : undefined}
          className={`${baseInputClassName} ${leadingIcon ? "pl-11" : ""} ${
            error
              ? "border-[var(--genus-error)] focus-visible:border-[var(--genus-error)] focus-visible:ring-[var(--genus-error)]/12"
              : "border-[var(--os-border)]"
          } ${className}`}
          {...inputProps}
        />
      </div>
      {error && (
        <p id={errorId} role="alert" className="text-sm text-[var(--genus-error)]">
          {error}
        </p>
      )}
    </div>
  );
}
