"use client";

import { useEffect, useState, type InputHTMLAttributes } from "react";

/** «1,5» o «1.5» → 1.5; vacío → null; a medio escribir («1,» «-») → undefined (todavía no es un número). */
export function parseDecimalInput(text: string): number | null | undefined {
  const t = text.trim().replace(/\s/g, "").replace(",", ".");
  if (!t) return null;
  if (!/^-?\d*\.?\d*$/.test(t) || t === "-" || t === "." || t === "-." || t.endsWith(".")) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Campo numérico que acepta coma decimal (como Excel en castellano). Con `type="number"` el navegador descartaba
 * «1,5» y el dato quedaba vacío sin aviso. Guarda el texto mientras se escribe y entrega el número cuando es válido.
 */
export function DecimalInput({
  value,
  onValue,
  ...rest
}: { value: number | null | undefined; onValue: (n: number | null) => void } & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type">) {
  const show = (n: number | null | undefined) => (n == null ? "" : String(n).replace(".", ","));
  const [text, setText] = useState(show(value));
  useEffect(() => {
    // Cambio que viene de afuera (recarga, otra celda): se muestra; lo que se está escribiendo no se pisa.
    if (parseDecimalInput(text) !== (value ?? null)) setText(show(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <input
      {...rest}
      type="text"
      inputMode="decimal"
      value={text}
      onChange={(e) => {
        const next = e.target.value;
        if (!/^[-\d.,\s]*$/.test(next)) return; // solo números
        setText(next);
        const n = parseDecimalInput(next);
        if (n !== undefined) onValue(n);
      }}
    />
  );
}
