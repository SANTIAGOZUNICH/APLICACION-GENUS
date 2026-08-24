import { describe, expect, it } from "vitest";
import { isEnvasadoWorkPending } from "./envasado-pending";

/** Casos 1/2 obligatorios — Masivo y Premium comparten el mismo predicado. */
describe("isEnvasadoWorkPending", () => {
  it.each(["pendiente", "en_curso", "bloqueado"])(
    "trabajo activo (%s) aparece en Pendientes",
    (status) => {
      expect(isEnvasadoWorkPending({ status })).toBe(true);
    }
  );

  it("devuelto por Rehacer (vuelve a pendiente/en_curso) sigue apareciendo", () => {
    expect(isEnvasadoWorkPending({ status: "pendiente" })).toBe(true);
    expect(isEnvasadoWorkPending({ status: "en_curso" })).toBe(true);
  });

  it.each(["completo", "revision", "entregado", "cancelado", "en_codificado", "codificado_completo"])(
    "trabajo finalizado/transferido (%s) NO aparece en Pendientes",
    (status) => {
      expect(isEnvasadoWorkPending({ status })).toBe(false);
    }
  );
});
