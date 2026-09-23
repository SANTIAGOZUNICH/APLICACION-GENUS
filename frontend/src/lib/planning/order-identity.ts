/**
 * Identidad funcional de una OA/OE — PEDIDO + PRODUCTO + LOTE.
 *
 * PROBLEMA REAL: hasta acá, la única identidad de una OA/OE era el número
 * visible (`operational_orders.order_number`), auto-sugerido desde
 * Pedido+año (`pedido-order-ref.ts`) pero editable y NUNCA validado contra
 * lote. La regla "1 trabajo = 1 OA" (`ensure-oa-on-assign.ts`) rechaza
 * vincular una segunda vez el mismo número — así que cuando Producción
 * divide un mismo Pedido+Producto+Lote en varios WorkItems (otro día, otra
 * tanda), el segundo intento choca con "esta OA ya tiene un trabajo
 * asignado" y el único camino para seguir es escribir un número DISTINTO,
 * generando una OA nueva y redundante para lo que en el negocio es la misma
 * orden real.
 *
 * Esta identidad es la clave real para decidir "¿ya existe una OA/OE para
 * esto?" — independiente del número visible, que se sigue mostrando/
 * editando igual que antes. Nunca fuzzy: usa IDs/códigos canónicos cuando
 * existen (asignacionLoteId, código de producto) y si no, la misma
 * normalización determinística ya usada en el resto del proyecto
 * (`normalizeSearchKey`, la que ya usa el resolver tolerante de Asignación
 * de Lotes) — nunca un normalizador nuevo.
 */
import { normalizeSearchKey } from "@/lib/formulas/types";

/**
 * Clave de producto: prioriza el código canónico si vino (copiado a la OA
 * en `productCode`); si no, normaliza el texto libre. `null` = sin producto
 * (no debería ocurrir — el llamador ya exige producto no vacío antes).
 */
export function computeProductIdentityKey(
  product: string,
  productCode?: string | null
): string | null {
  const code = productCode?.trim();
  if (code) return `CODE:${normalizeSearchKey(code)}`;
  const key = normalizeSearchKey(product ?? "");
  return key || null;
}

/**
 * Clave de lote: prioriza el id canónico de Asignación de Lotes (resuelto
 * server-side, nunca confiado del cliente) sobre el texto libre. `null` =
 * SIN_LOTE — identidad propia (una única OA/OE provisional reutilizable por
 * Pedido+Producto mientras no se conozca el lote real).
 */
export function computeLoteIdentityKey(
  asignacionLoteId: string | null | undefined,
  manualLote: string | null | undefined
): string | null {
  const id = asignacionLoteId?.trim();
  if (id) return `AL:${id}`;
  const key = manualLote?.trim() ? normalizeSearchKey(manualLote) : "";
  return key ? `TXT:${key}` : null;
}

/**
 * Tiers "completa" de una OA/OE (mismo criterio que oa-duplicate-audit.ts,
 * repetido acá en vez de importado para no acoplar el módulo de auditoría
 * con el de re-resolución en edición). Usado para nunca mutar en el lugar
 * una orden ya completa — ver reresolveOrderIdentityOnEdit.
 */
export function isCompleteOrderStatus(status: string): boolean {
  return status === "COMPLETA" || status === "COMPLETA_CON_PENDIENTES";
}
