"use client";

import { useEffect, useRef } from "react";

interface Props {
  checked: boolean;
  /** Solo header: algunos (no todos) los visibles. */
  indeterminate?: boolean;
  onChange: () => void;
  label: string;
  testId?: string;
}

/**
 * Checkbox de tabla con área táctil amplia (≥ 40 px, cómodo en tablet). Se usa tanto en el
 * encabezado (`indeterminate`) como en cada fila.
 */
export function BulkSelectCheckbox({ checked, indeterminate = false, onChange, label, testId }: Props) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate && !checked;
  }, [indeterminate, checked]);
  return (
    <label className="-m-2 flex h-10 w-10 cursor-pointer items-center justify-center">
      <input
        ref={ref}
        type="checkbox"
        checked={checked}
        onChange={onChange}
        aria-label={label}
        data-testid={testId}
        className="h-5 w-5 cursor-pointer accent-[var(--genus-primary,#1f6f4a)]"
      />
    </label>
  );
}

/** Clase para resaltar la fila seleccionada. */
export function bulkRowClassName(selected: boolean): string {
  return selected ? "bg-[var(--genus-primary-soft,#e8f3ec)]" : "";
}
