import { describe, expect, it } from "vitest";
import {
  DELIVERY_MUTATION_DENIED_MESSAGE,
  DELIVERY_MUTATION_MISSING_ACTOR_MESSAGE,
  canMutateDeliveries,
  canViewDeliveries,
  gateDeliveryMutation,
  validateDeliveryMutationActor,
} from "./delivery-rbac";

describe("delivery-rbac", () => {
  it("solo PRODUCCION puede mutar entregas", () => {
    expect(canMutateDeliveries("PRODUCCION")).toBe(true);
    expect(canMutateDeliveries("CALIDAD")).toBe(false);
    expect(canMutateDeliveries(null)).toBe(false);
    expect(canMutateDeliveries(undefined)).toBe(false);
  });

  it("permite consultar entregas a sectores operativos relevantes", () => {
    expect(canViewDeliveries("PRODUCCION")).toBe(true);
    expect(canViewDeliveries("CALIDAD")).toBe(true);
    expect(canViewDeliveries("DIRECCION")).toBe(true);
    expect(canViewDeliveries("ELABORACION")).toBe(true);
    expect(canViewDeliveries("COMERCIAL")).toBe(false);
  });

  it("devuelve errores claros para actor faltante o no autorizado", () => {
    expect(gateDeliveryMutation("PRODUCCION")).toEqual({ ok: true });

    const missing = gateDeliveryMutation(null);
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.error).toBe(DELIVERY_MUTATION_MISSING_ACTOR_MESSAGE);
      expect(missing.code).toBe("DELIVERY_MUTATION_MISSING_ACTOR");
    }

    const denied = validateDeliveryMutationActor("CALIDAD");
    expect(denied.ok).toBe(false);
    if (!denied.ok) {
      expect(denied.error).toBe(DELIVERY_MUTATION_DENIED_MESSAGE);
      expect(denied.code).toBe("DELIVERY_MUTATION_FORBIDDEN");
    }
  });
});
