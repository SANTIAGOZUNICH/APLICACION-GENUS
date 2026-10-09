/**
 * Bug de Production (Asignación de lotes tras el PR #112): sin la migración 0043 la API respondía un 500 genérico y
 * la pantalla caía en silencio a la caché local. Ahora se reconoce el error de esquema y se responde 503 con el motivo.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { isMissingSchemaError, sqlStateOf } from "@/lib/db/missing-schema";
import {
  LOCAL_EDITS_SCHEMA_PENDING_MESSAGE,
  asignacionLotesErrorResponse,
  missingLocalEditsObjects,
  serverBuildSha,
} from "@/lib/asignacion-lotes/schema-status";
import { ordersErrorResponse } from "@/lib/orders/http";
import { OrdersForbiddenError } from "@/lib/orders/types";

/** Como lo entrega Drizzle: DrizzleQueryError("Failed query: …") con el error del driver Neon en `cause`. */
function drizzleError(code: string) {
  const driver = Object.assign(new Error('column "source_lote" does not exist'), { code });
  return Object.assign(new Error('Failed query: select "source_lote" from "asignacion_lotes"'), { cause: driver });
}

describe("detección de esquema pendiente", () => {
  it("columna o tabla inexistente (42703 / 42P01), también envuelta por Drizzle", () => {
    expect(isMissingSchemaError(drizzleError("42703"))).toBe(true);
    expect(isMissingSchemaError(drizzleError("42P01"))).toBe(true);
    expect(sqlStateOf(drizzleError("42703"))).toBe("42703");
  });
  it("otros errores no son esquema pendiente", () => {
    expect(isMissingSchemaError(drizzleError("23505"))).toBe(false);
    expect(isMissingSchemaError(new Error("timeout"))).toBe(false);
    expect(isMissingSchemaError(null)).toBe(false);
  });
  it("faltantes de 0043 a partir de information_schema", () => {
    expect(missingLocalEditsObjects(["asignacion_lotes.source_lote"])).toEqual([
      "asignacion_lotes.source_codigo",
      "asignacion_lotes.source_producto",
      "asignacion_lotes_cell_audit.reason",
      "asignacion_lotes_local_edits",
    ]);
    expect(
      missingLocalEditsObjects([
        "asignacion_lotes.source_lote",
        "asignacion_lotes.source_codigo",
        "asignacion_lotes.source_producto",
        "asignacion_lotes_cell_audit.reason",
        "asignacion_lotes_local_edits",
      ])
    ).toEqual([]);
  });
});

describe("respuestas de error", () => {
  it("Asignación de lotes sin 0043 → 503 con motivo explícito (nunca 500 genérico)", async () => {
    const res = await asignacionLotesErrorResponse(drizzleError("42703"));
    expect(res.status).toBe(503);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      code: "ASIGNACION_LOTES_SCHEMA_PENDING",
      schemaPending: true,
      migration: "0043_asignacion_lotes_local_edits",
      error: LOCAL_EDITS_SCHEMA_PENDING_MESSAGE,
    });
    expect(String(body.error)).not.toMatch(/select|asignacion_lotes"/);
  });
  it("el resto de los errores conserva su respuesta (permiso → 403)", async () => {
    const res = await asignacionLotesErrorResponse(new OrdersForbiddenError("sin permiso"));
    expect(res.status).toBe(403);
  });
  it("manejador genérico: esquema pendiente → 503 SCHEMA_PENDING sin filtrar SQL", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = ordersErrorResponse(drizzleError("42P01"));
    expect(res.status).toBe(503);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe("SCHEMA_PENDING");
    expect(String(body.error)).not.toMatch(/Failed query|source_lote/);
    expect(spy.mock.calls.flat().join(" ")).toMatch(/SQLSTATE 42P01/);
    spy.mockRestore();
  });
});

describe("commit desplegado", () => {
  const prev = process.env.VERCEL_GIT_COMMIT_SHA;
  afterEach(() => {
    if (prev === undefined) delete process.env.VERCEL_GIT_COMMIT_SHA;
    else process.env.VERCEL_GIT_COMMIT_SHA = prev;
  });
  it("usa VERCEL_GIT_COMMIT_SHA en runtime", () => {
    process.env.VERCEL_GIT_COMMIT_SHA = "abc1234def";
    expect(serverBuildSha()).toBe("abc1234def");
  });
});
