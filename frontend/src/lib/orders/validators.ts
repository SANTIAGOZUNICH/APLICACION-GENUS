import type {
  OaContent,
  OeContent,
  OrderContent,
  OrderDocType,
} from "@/lib/orders/types";
import { OrdersValidationError } from "@/lib/orders/types";

export function validateDeliverOe(content: OeContent): string[] {
  const missing: string[] = [];
  if (!content.header.productName.trim()) missing.push("Producto");
  if (!content.header.date.trim()) missing.push("Fecha");
  if (content.header.quantityKg == null) missing.push("Cantidad");
  if (!content.header.lot.trim()) missing.push("Lote");
  if (!content.header.client.trim()) missing.push("Cliente");
  if (content.materials.length === 0) missing.push("Materias primas");
  const invalidPct = content.materials.some(
    (m) => m.formulaPct == null && m.kgAPesar == null
  );
  if (invalidPct) missing.push("Kg y/o porcentajes válidos");
  if (content.procedureSteps.length === 0) missing.push("Procedimiento");
  if (content.processControl.cantidadObtenida == null) missing.push("Cantidad obtenida");
  if (!content.processControl.fechaFin.trim()) missing.push("Fecha de finalización");
  return missing;
}

export function validateDeliverOa(content: OaContent): string[] {
  const missing: string[] = [];
  if (!content.header.productName.trim()) missing.push("Producto");
  if (!content.header.client.trim()) missing.push("Cliente");
  if (!content.header.lot.trim()) missing.push("Lote");
  if (!content.header.vto.trim()) missing.push("VTO");
  if (!content.header.productCode.trim()) missing.push("Código");
  if (!content.materials.some((m) => m.nombreInsumo.trim() || m.codigo.trim())) {
    missing.push("Materiales");
  }
  if (!content.envasado.fechaInicio.trim()) missing.push("Fecha de inicio de envasado");
  if (!content.envasado.operarios.trim()) missing.push("Operarios");
  if (content.rendimientos.produccionTeoricaUnidades == null) {
    missing.push("Producción teórica");
  }
  if (content.rendimientos.cantidadUnidades == null) missing.push("Cantidades");
  if (content.rendimientos.rendimientoA == null) missing.push("Rendimiento");
  if (!content.analisisProductoTerminado.resultado.trim()) {
    missing.push("Resultado de producto terminado");
  }
  return missing;
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
