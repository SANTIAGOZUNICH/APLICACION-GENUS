import type { OrderDocType } from "@/lib/orders/types";
import type { SectorId } from "@/types/operational/sector";

export type CreateOrderFieldErrors = {
  template?: string;
  product?: string;
  code?: string;
  client?: string;
  lot?: string;
  sector?: string;
  database?: string;
};

export type CreateOrderFormState = {
  templateId: string;
  product: string;
  code: string;
  client: string;
  lot: string;
  assignedSector: SectorId;
  templatesCount: number;
  dbUnavailable: boolean;
};

export function validateCreateOrderForm(
  type: OrderDocType,
  state: CreateOrderFormState
): { ok: boolean; errors: CreateOrderFieldErrors; disableReasons: string[] } {
  const errors: CreateOrderFieldErrors = {};
  const disableReasons: string[] = [];

  if (state.dbUnavailable) {
    errors.database =
      "La base de datos no está configurada. Podés ver la plantilla, pero no crear ni guardar órdenes todavía.";
    disableReasons.push("Falta base de datos");
  }
  if (state.templatesCount === 0) {
    errors.template =
      "No hay plantillas maestras disponibles. Primero debés crear o importar una plantilla.";
    disableReasons.push("Falta plantilla");
  } else if (!state.templateId.trim()) {
    errors.template = "Falta plantilla.";
    disableReasons.push("Falta plantilla");
  }
  if (!state.product.trim()) {
    errors.product = "Falta producto.";
    disableReasons.push("Falta producto");
  }
  if (!state.code.trim()) {
    errors.code = "Falta código.";
    disableReasons.push("Falta código");
  }
  if (!state.client.trim()) {
    errors.client = "Falta cliente.";
    disableReasons.push("Falta cliente");
  }
  if (!state.lot.trim()) {
    errors.lot = "Falta lote.";
    disableReasons.push("Falta lote");
  }
  if (type === "OA") {
    if (
      state.assignedSector !== "ENVASADO_MASIVO" &&
      state.assignedSector !== "ENVASADO_PREMIUM"
    ) {
      errors.sector = "Falta sector.";
      disableReasons.push("Falta sector");
    }
  }

  return {
    ok: disableReasons.length === 0,
    errors,
    disableReasons,
  };
}

export function emptyTemplatesExplanation(): string {
  return "No hay plantillas maestras disponibles. Primero debés crear o importar una plantilla.";
}
