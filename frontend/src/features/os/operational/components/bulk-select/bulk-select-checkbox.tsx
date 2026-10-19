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
export function BulkSelectCheckbox({
  checked,
  indeterminate = false,
  onChange,
  label,
  testId,
}: Props) {
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
        className="h-5 w-5 cursor-pointer rounded accent-[var(--genus-brand-primary)]"
      />
    </label>
  );
}

/**
 * Resalta la fila seleccionada SIN cambiar su alto ni su distribución: fondo turquesa translúcido (el texto conserva
 * su color) y un borde lateral fino dibujado con sombra interna en la primera celda. Usa solo tokens/colores del
 * tema oscuro de GENUS OS (--genus-brand-primary = #12bfb7); nunca fondos claros.
 */
export function bulkRowClassName(selected: boolean): string {
  return selected
    ? "bg-[rgb(18_191_183_/_0.12)] [&>td:first-child]:shadow-[inset_3px_0_0_0_rgb(18_191_183_/_0.9)]"
    : "";
}
