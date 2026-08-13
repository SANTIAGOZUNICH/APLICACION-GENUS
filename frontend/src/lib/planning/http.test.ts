import { describe, expect, it } from "vitest";
import { AuthUnauthorizedError } from "@/lib/auth/types";
import { planningErrorResponse } from "@/lib/planning/http";
import { PlanningForbiddenError, PlanningValidationError } from "@/lib/planning/types";

/**
 * Regresión: resolvePlanningActor convertía AuthUnauthorizedError (401 real)
 * en PlanningValidationError, y planningErrorResponse solo lo recuperaba
 * como 401 vía un regex frágil sobre el texto del mensaje ("sesión"),
 * que podía confundirse con un mensaje de negocio legítimo. Ahora se
 * verifica por tipo.
 */
describe("planningErrorResponse — semántica 401 vs 403 vs 400", () => {
  it("AuthUnauthorizedError → 401, verificado por tipo", async () => {
    const res = planningErrorResponse(new AuthUnauthorizedError(), "op-1");
    const body = await res.json();
    expect(res.status).toBe(401);
    expect(body.code).toBe("AUTH_UNAUTHORIZED");
  });

  it("PlanningForbiddenError sigue siendo 403 (autenticado sin permiso)", async () => {
    const res = planningErrorResponse(new PlanningForbiddenError("Sector no autorizado."), "op-2");
    expect(res.status).toBe(403);
  });

  it("PlanningValidationError con 'sesión' en el mensaje de negocio no se confunde con 401", async () => {
    // Antes del fix, un mensaje de validación que mencionara "sesión" por
    // coincidencia textual (no por ser un problema de auth) también hubiera
    // disparado el regex y devuelto 401 incorrectamente.
    const res = planningErrorResponse(
      new PlanningValidationError("La sesión de trabajo seleccionada no tiene turnos cargados."),
      "op-3"
    );
    expect(res.status).toBe(400);
  });
});
