import { describe, expect, it } from "vitest";
import { AuthUnauthorizedError } from "@/lib/auth/types";
import { ordersErrorResponse } from "@/lib/orders/http";
import { OrdersForbiddenError, OrdersValidationError } from "@/lib/orders/types";

/**
 * Regresión: resolveOrdersActor convertía un AuthUnauthorizedError real
 * (401 = no autenticado) en OrdersValidationError (400), reportando "no hay
 * sesión" como si fuera una request mal formada. No mezclar 401 (no
 * autenticado) / 403 (autenticado sin permiso) / 400 (request inválida).
 */
describe("ordersErrorResponse — semántica 401 vs 403 vs 400", () => {
  it("AuthUnauthorizedError → 401, no 400", async () => {
    const res = ordersErrorResponse(new AuthUnauthorizedError());
    const body = await res.json();
    expect(res.status).toBe(401);
    expect(body.code).toBe("AUTH_UNAUTHORIZED");
  });

  it("OrdersForbiddenError sigue siendo 403 (autenticado sin permiso)", async () => {
    const res = ordersErrorResponse(new OrdersForbiddenError("Sector no autorizado."));
    expect(res.status).toBe(403);
  });

  it("OrdersValidationError sigue siendo 400 (request inválida, no auth)", async () => {
    const res = ordersErrorResponse(new OrdersValidationError("Campo requerido faltante."));
    expect(res.status).toBe(400);
  });
});
