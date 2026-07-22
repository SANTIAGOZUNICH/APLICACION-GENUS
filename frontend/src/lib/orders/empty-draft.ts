/**
 * Helpers de borradores vacíos OE/OA (captura vs representación).
 */
import type {
  OaContent,
  OeContent,
  OperationalOrderRecord,
  OrderAssignedSector,
  OrderContent,
  OrderStatus,
} from "@/lib/orders/types";
import type { OrdersActor } from "@/lib/orders/types";
import type { SectorId } from "@/types/operational/sector";

export const DISPLAY_SIN_COMPLETAR = "Sin completar";
export const SIN_ASIGNAR = "SIN_ASIGNAR" as const;

export function displayProduct(value: string | null | undefined): string {
  return value?.trim() ? value.trim() : DISPLAY_SIN_COMPLETAR;
}

export function displayClient(value: string | null | undefined): string {
  return value?.trim() ? value.trim() : DISPLAY_SIN_COMPLETAR;
}

export function displaySector(value: OrderAssignedSector | string | null | undefined): string {
  if (!value || value === SIN_ASIGNAR) return "Sin asignar";
  return value;
}

export function isBlankOrderField(value: string | null | undefined): boolean {
  return !String(value ?? "").trim();
}

/** Orden sin datos de negocio cargados (borrador vacío). */
export function isEmptyDraftOrder(order: Pick<
  OperationalOrderRecord,
  "product" | "client" | "code" | "lot" | "status" | "formData" | "completionPercentage"
>): boolean {
  if (order.status !== "BORRADOR" && order.status !== "PENDIENTE") {
    // También considerar BORRADOR estricto; EN_PROCESO ya no es "vacío eliminable"
  }
  const headerEmpty =
    isBlankOrderField(order.product) &&
    isBlankOrderField(order.client) &&
    isBlankOrderField(order.code) &&
    isBlankOrderField(order.lot);
  if (!headerEmpty) return false;
  if ((order.completionPercentage ?? 0) > 0) return false;
  return isOrderContentEffectivelyEmpty(order.formData);
}

export function isOrderContentEffectivelyEmpty(content: OrderContent): boolean {
  if (content.kind === "OE") return isOeEffectivelyEmpty(content);
  return isOaEffectivelyEmpty(content);
}

function isOeEffectivelyEmpty(c: OeContent): boolean {
  if (c.header.productName.trim() || c.header.code.trim() || c.header.client.trim() || c.header.lot.trim()) {
    return false;
  }
  if (c.header.quantityKg != null) return false;
  if (c.materials.some((m) => m.materiaPrima.trim() || m.codigo.trim() || m.lote.trim())) {
    return false;
  }
  if (c.procedureSteps.some((s) => s.text.trim())) return false;
  return true;
}

function isOaEffectivelyEmpty(c: OaContent): boolean {
  if (
    c.header.productName.trim() ||
    c.header.client.trim() ||
    c.header.productCode.trim() ||
    c.header.lot.trim()
  ) {
    return false;
  }
  if (c.materials.some((m) => m.nombreInsumo.trim() || m.recibidos || m.usados)) return false;
  if (c.envasado.operariosList.some((o) => o.nombre.trim()) || c.envasado.operarios.trim()) {
    return false;
  }
  if (c.rendimientos.produccionTeoricaUnidades != null) return false;
  if ((c.rendimientos.cantidadUnidades ?? 0) > 0) return false;
  return true;
}

export function canDeleteEmptyDraft(
  order: OperationalOrderRecord,
  actor: OrdersActor
): boolean {
  if (order.status !== "BORRADOR") return false;
  if (order.completedAt) return false;
  if (!isEmptyDraftOrder(order)) return false;
  if (
    actor.sector === "CALIDAD" ||
    actor.sector === "PRODUCCION" ||
    actor.sector === "DIRECCION"
  ) {
    return true;
  }
  return order.createdBy === actor.email;
}

/** Sector asignado inicial según quien crea. */
export function resolveInitialAssignedSector(
  type: "OE" | "OA",
  actorSector: SectorId,
  requested?: OrderAssignedSector | null
): OrderAssignedSector {
  if (type === "OE") {
    if (requested === "ELABORACION" || requested === SIN_ASIGNAR) return requested;
    if (requested == null) return SIN_ASIGNAR;
    return "ELABORACION";
  }
  // OA
  if (actorSector === "ENVASADO_MASIVO") return "ENVASADO_MASIVO";
  if (actorSector === "ENVASADO_PREMIUM") return "ENVASADO_PREMIUM";
  if (actorSector === "CODIFICADO") return SIN_ASIGNAR;
  // Calidad / Producción / Dirección
  if (
    requested === "ENVASADO_MASIVO" ||
    requested === "ENVASADO_PREMIUM" ||
    requested === SIN_ASIGNAR
  ) {
    return requested;
  }
  return SIN_ASIGNAR;
}

export function assertOaAssignmentChangeAllowed(
  actorSector: SectorId,
  from: OrderAssignedSector,
  to: OrderAssignedSector
): void {
  if (actorSector === "ENVASADO_MASIVO" && to !== "ENVASADO_MASIVO") {
    throw new Error("Masivo no puede reasignar la OA a otro sector.");
  }
  if (actorSector === "ENVASADO_PREMIUM" && to !== "ENVASADO_PREMIUM") {
    throw new Error("Premium no puede reasignar la OA a otro sector.");
  }
  if (actorSector === "CODIFICADO" && to !== SIN_ASIGNAR && to !== from) {
    throw new Error("Codificado no puede asignar Masivo/Premium sin permiso.");
  }
  void from;
}

export function statusLabel(status: OrderStatus): string {
  switch (status) {
    case "BORRADOR":
      return "Borrador";
    case "COMPLETA_CON_PENDIENTES":
      return "Completa con pendientes";
    case "DEVUELTA_PARA_CORRECCION":
      return "Devuelta para corrección";
    case "EN_PROCESO":
      return "En proceso";
    default:
      return status.replace(/_/g, " ");
  }
}
