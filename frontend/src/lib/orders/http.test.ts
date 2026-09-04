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

/**
 * Regresión (Procedimientos, carga de archivos): un Error plano no sensible
 * (ej. "Almacenamiento privado de archivos no configurado.", lanzado por
 * assertPrivateFileStorageConfigured) se sanitizaba SIEMPRE al mensaje
 * genérico "No se pudo completar la operación. Reintentá." — el chequeo
 * `sensitive` solo decidía qué se logueaba server-side, nunca qué viajaba en
 * la respuesta. Resultado: la UI nunca podía mostrar el error real, sin
 * importar cuán seguro fuera exponerlo (mismo texto que ya expone el
 * diagnóstico público /api/v1/storage/health). Un Error con datos internos
 * (SQL, DATABASE_URL, stack) debe seguir sanitizado.
 */
describe("ordersErrorResponse — mensajes no sensibles pasan, los sensibles se sanitizan", () => {
  it("un Error plano no sensible se expone tal cual (antes se ocultaba siempre)", async () => {
    const res = ordersErrorResponse(new Error("Almacenamiento privado de archivos no configurado."));
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(body.error).toBe("Almacenamiento privado de archivos no configurado.");
    expect(body.code).toBe("ORDERS_FAILED");
  });

  it("un Error con datos internos (SQL/DATABASE_URL/stack) se sigue sanitizando", async () => {
    const res = ordersErrorResponse(new Error("failed query: insert into orders ... DATABASE_URL leaked"));
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(body.error).toBe("No se pudo completar la operación. Reintentá.");
  });

  it("un valor no-Error (sin mensaje) se sigue sanitizando", async () => {
    const res = ordersErrorResponse("boom");
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(body.error).toBe("No se pudo completar la operación. Reintentá.");
  });
});
