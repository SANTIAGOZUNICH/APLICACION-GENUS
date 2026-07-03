import { ArrowRight } from "lucide-react";

interface QuickActionProps {
  label: string;
  onClick: () => void;
  variant?: "primary" | "secondary";
}

export function QuickAction({ label, onClick, variant = "secondary" }: QuickActionProps) {
  const isPrimary = variant === "primary";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`group inline-flex items-center gap-2 rounded-[12px] px-5 py-3 text-sm font-semibold transition-all duration-200 ease-out ${
        isPrimary
          ? "bg-[var(--os-teal)] text-white hover:bg-[var(--os-teal)]/92 hover:shadow-[var(--os-shadow)]"
          : "border border-[var(--os-border)] bg-[var(--os-surface)] text-[var(--os-text)] hover:border-[var(--os-teal)]/40 hover:text-[var(--os-teal)]"
      }`}
    >
      <span>{label}</span>
      <ArrowRight
        className={`size-4 transition-transform duration-200 group-hover:translate-x-0.5 ${
          isPrimary ? "text-white/90" : "text-[var(--os-text-muted)] group-hover:text-[var(--os-teal)]"
        }`}
        aria-hidden="true"
      />
    </button>
  );
}
