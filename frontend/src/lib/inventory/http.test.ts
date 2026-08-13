import { describe, expect, it } from "vitest";
import { AuthUnauthorizedError } from "@/lib/auth/types";
import { inventoryErrorResponse } from "@/lib/inventory/http";
import { InventoryForbiddenError, InventoryValidationError } from "@/lib/inventory/inventory-service";

/**
 * Regresión: resolveInventoryActor convertía un AuthUnauthorizedError real
 * (401 = no autenticado) en InventoryForbiddenError (403 = autenticado sin
 * permiso) — la sesión ausente/vencida se reportaba como si el usuario
 * estuviera logueado pero sin permisos.
 */
describe("inventoryErrorResponse — semántica 401 vs 403 vs 400", () => {
  it("AuthUnauthorizedError → 401, no 403", async () => {
    const res = inventoryErrorResponse(new AuthUnauthorizedError());
    const body = await res.json();
    expect(res.status).toBe(401);
    expect(body.code).toBe("AUTH_UNAUTHORIZED");
  });

  it("InventoryForbiddenError sigue siendo 403 (autenticado sin permiso)", async () => {
    const res = inventoryErrorResponse(new InventoryForbiddenError("Sector no autorizado."));
    expect(res.status).toBe(403);
  });

  it("InventoryValidationError sigue siendo 400 (request inválida, no auth)", async () => {
    const res = inventoryErrorResponse(new InventoryValidationError("Cantidad inválida."));
    expect(res.status).toBe(400);
  });
});
