import type { OrderAssignedSector, OrderDocType } from "@/lib/orders/types";
import { SIN_ASIGNAR } from "@/lib/orders/empty-draft";

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
  assignedSector: OrderAssignedSector;
  templatesCount: number;
  dbUnavailable: boolean;
  /** Crear borrador vacío sin plantilla ni datos. */
  emptyDraft?: boolean;
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

  if (state.emptyDraft) {
    // Borrador vacío: solo exige DB. Sector puede quedar SIN_ASIGNAR.
    return {
      ok: disableReasons.length === 0,
      errors,
      disableReasons,
    };
  }

  if (state.templatesCount === 0) {
    errors.template =
      "No hay plantillas maestras disponibles. Podés crear un borrador vacío desde cero.";
    disableReasons.push("Falta plantilla");
  } else if (!state.templateId.trim()) {
    errors.template = "Falta plantilla.";
    disableReasons.push("Falta plantilla");
  }

  // Producto/código/cliente/lote son opcionales también con plantilla.
  if (type === "OA") {
    if (
      state.assignedSector !== "ENVASADO_MASIVO" &&
      state.assignedSector !== "ENVASADO_PREMIUM" &&
      state.assignedSector !== SIN_ASIGNAR
    ) {
      errors.sector = "Elegí Masivo, Premium o Sin asignar.";
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
  return "No hay plantillas maestras disponibles. Podés crear un borrador vacío desde cero o importar/crear una plantilla.";
}
