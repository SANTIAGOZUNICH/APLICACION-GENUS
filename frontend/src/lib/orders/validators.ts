import type {
  OaContent,
  OeContent,
  OrderContent,
  OrderDocType,
} from "@/lib/orders/types";
import { OrdersValidationError } from "@/lib/orders/types";
import { validateAjusteRows } from "@/lib/orders/oe-ajuste";
import { recomputeOaDerived } from "@/lib/orders/content";

export function validateDeliverOe(content: OeContent): string[] {
  const missing: string[] = [];
  if (!content.header.productName.trim()) missing.push("Producto");
  if (!content.header.date.trim()) missing.push("Fecha");
  if (content.header.quantityKg == null) missing.push("Cantidad");
  if (!content.header.lot.trim()) missing.push("Lote");
  if (!content.header.client.trim()) missing.push("Cliente");
  if (content.materials.length === 0) missing.push("Materias primas");
  // Las filas de «lote adicional» de una MP no llevan % ni kg teóricos (son de su MP de la fórmula).
  const invalidPct = content.materials.some(
    (m) => !m.parentRowId && m.formulaPct == null && m.kgAPesar == null
  );
  if (invalidPct) missing.push("Kg y/o porcentajes válidos");
  if (content.procedureSteps.length === 0) missing.push("Procedimiento");
  if (content.processControl.cantidadObtenida == null) missing.push("Cantidad obtenida");
  if (!content.processControl.fechaFin.trim()) missing.push("Fecha de finalización");
  missing.push(...validateAjusteRows(content.materials));
  return missing;
}

export function validateDeliverOa(content: OaContent): string[] {
  const c = recomputeOaDerived(content);
  const missing: string[] = [];
  // Código, lote, cliente, VTO, análisis y responsables específicos son opcionales.
  if (!c.header.productName.trim()) missing.push("Producto");
  if (!c.header.fechaEmision.trim() && !c.envasado.fechaInicio.trim()) {
    missing.push("Fecha de la jornada");
  }
  if (!c.materials.some((m) => m.nombreInsumo.trim() || m.codigo.trim())) {
    missing.push("Materiales");
  }
  for (const m of c.materials) {
    const rec = Number(m.recibidos || 0);
    const des = Number(m.desechados || 0);
    const usa = Number(m.usados || 0);
    if (m.recibidos || m.desechados || m.usados) {
      if (des < 0 || usa < 0 || rec < 0) {
        missing.push(`Cantidades no negativas (insumo ${m.nro})`);
      }
      if (des + usa > rec && rec > 0) {
        missing.push(`Usados+Desechados coherentes con Recibidos (insumo ${m.nro})`);
      }
    }
  }
  if (!c.envasado.fechaInicio.trim()) missing.push("Fecha de inicio de envasado");
  if (
    !c.envasado.operariosList.some((o) => o.nombre.trim()) &&
    !c.envasado.operarios.trim()
  ) {
    missing.push("Operarios");
  }
  if (c.rendimientos.produccionTeoricaUnidades == null) {
    missing.push("Producción teórica");
  }
  if ((c.rendimientos.cantidadUnidades ?? 0) <= 0) missing.push("Cantidades de unidades");
  if (c.rendimientos.rendimientoA == null) missing.push("Rendimiento");
  return missing;
}

/**
 * Datos de una OE que se pueden dejar PENDIENTES al entregarla: todo lo administrativo (fecha, cliente, cantidad, lote de
 * producto terminado, procedimiento, cantidad obtenida, fecha de finalización, kg/% teóricos, materias primas). Se conservan como
 * «Datos pendientes» para completarlos después; nunca se inventan.
 * Lo ÚNICO que bloquea es lo crítico para la trazabilidad y el stock: que la orden tenga producto y que los KG REALES cargados
 * sean válidos (no negativos). El descuento de MP sigue exigiendo código y lote en las filas que informan kg reales.
 */
export const OE_DISPENSABLE_FIELDS = [
  "Fecha",
  "Cliente",
  "Cantidad",
  "Lote",
  "Materias primas",
  "Kg y/o porcentajes válidos",
  "Procedimiento",
  "Cantidad obtenida",
  "Fecha de finalización",
] as const;

export type DeliverMissing = { critical: string[]; secondary: string[] };

/** Separa lo que falta en crítico (bloquea) y pendiente (se entrega igual, queda marcado). */
export function classifyDeliverMissing(content: OrderContent): DeliverMissing {
  const missing = validateDeliver(content);
  if (content.kind !== "OE") return { critical: [], secondary: missing };
  const dispensable = new Set<string>(OE_DISPENSABLE_FIELDS);
  return { critical: missing.filter((m) => !dispensable.has(m)), secondary: missing.filter((m) => dispensable.has(m)) };
}

export function validateDeliver(content: OrderContent): string[] {
  if (content.kind === "OE") return validateDeliverOe(content);
  return validateDeliverOa(content);
}

export function assertDeliverable(content: OrderContent): void {
  const missing = validateDeliver(content);
  if (missing.length > 0) {
    throw new OrdersValidationError(
      `Faltan campos obligatorios para entregar: ${missing.join(", ")}.`
    );
  }
}

export function assertOrderTypeMatch(
  expected: OrderDocType,
  content: OrderContent
): void {
  if (content.kind !== expected) {
    throw new OrdersValidationError(
      `El contenido ${content.kind} no coincide con el tipo de orden ${expected}.`
    );
  }
}
