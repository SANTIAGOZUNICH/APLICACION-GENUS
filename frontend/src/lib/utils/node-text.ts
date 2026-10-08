import { isValidElement, type ReactNode } from "react";

const TEXT_PROPS = ["label", "text", "title", "value", "status", "children"] as const;

/**
 * Extrae el texto visible de un ReactNode SIN renderizarlo (para copiar al
 * portapapeles desde la grilla tipo Excel). Recorre strings/números/arrays y
 * los `children` de los elementos; en componentes de función sin children usa
 * props comunes (label/text/title/value). Una columna con contenido no textual
 * (íconos, botones) debe declarar `text` explícito en su definición.
 */
export function nodeToText(node: ReactNode, depth = 0): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (depth > 8) return "";
  if (Array.isArray(node)) {
    return node
      .map((n) => nodeToText(n, depth + 1))
      .filter((t) => t.trim() !== "")
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  }
  if (isValidElement(node)) {
    const props = (node.props ?? {}) as Record<string, unknown>;
    if (props["aria-hidden"] === true || props["aria-hidden"] === "true") return "";
    for (const key of TEXT_PROPS) {
      const v = props[key];
      if (v === undefined || v === null) continue;
      const text = typeof v === "string" || typeof v === "number" ? String(v) : nodeToText(v as ReactNode, depth + 1);
      if (text.trim()) return (key === "status" ? text.replace(/_/g, " ") : text).replace(/\s+/g, " ").trim();
    }
  }
  return "";
}
