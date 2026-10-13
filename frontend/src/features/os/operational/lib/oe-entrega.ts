/**
 * Reglas de UX de la OE (Elaboración), puras para poder probarlas:
 *  - un ajuste ≠ 0 sin motivo NO se autoguarda (el servidor lo rechazaría y el operario vería «Error al guardar»
 *    mientras todavía está escribiendo): se avisa «falta el motivo» y se guarda apenas se completa;
 */
import type { OrderContent } from "@/lib/orders/types";

/** Nombre de la primera materia prima con ajuste ≠ 0 y sin motivo (null si no hay). */
export function ajusteSinMotivo(form: OrderContent | null | undefined): string | null {
  if (!form || form.kind !== "OE") return null;
  const m = form.materials.find((x) => Number(x.ajuste ?? 0) !== 0 && !String(x.ajusteMotivo ?? "").trim());
  return m ? m.materiaPrima || m.codigo || "una materia prima" : null;
}
