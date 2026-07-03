interface EntityRefProps {
  children: string;
  className?: string;
}

/** Identificadores OE/OA/lote — tratamiento instrumento de precisión. */
export function EntityRef({ children, className = "" }: EntityRefProps) {
  return (
    <span
      className={`font-mono text-[0.9375rem] font-medium tracking-[0.06em] text-[var(--os-text)] sm:text-base ${className}`}
    >
      {children}
    </span>
  );
}
