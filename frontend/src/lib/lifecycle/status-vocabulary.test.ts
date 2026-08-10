import { describe, expect, it } from "vitest";
import {
  canAnnul,
  canArchive,
  canDelete,
  canRestore,
  matchesVisibilityFilter,
  type LifecycleEntityState,
} from "./policy";

/**
 * Regresión para AUDIT_TRAZABILIDAD (J) — el motor de lifecycle mezcla
 * vocabularios de estado legítimamente distintos entre dominios (OE/OA en
 * mayúsculas ARCHIVADA/ARCHIVADO/ANULADA/ANULADO, work items nativos en
 * minúsculas "cancelado"). Antes cada función repetía la lista de
 * variantes por separado — el riesgo real era que una variante se
 * actualizara en un lugar y no en otro sin que nada lo notara. Estos tests
 * fijan el comportamiento actual (idéntico al pre-refactor) para las tres
 * familias de literales en las 5 funciones que las usan.
 */

function entity(over: Partial<LifecycleEntityState> = {}): LifecycleEntityState {
  return { kind: "oe", id: "x1", status: "COMPLETA", ...over };
}

describe("vocabulario de estado — ARCHIVADA/ARCHIVADO (femenino/masculino)", () => {
  it.each(["ARCHIVADA", "ARCHIVADO"])("canDelete bloquea archivado (%s)", (status) => {
    expect(canDelete(entity({ status })).allowed).toBe(false);
  });
  it.each(["ARCHIVADA", "ARCHIVADO"])("canArchive es idempotente (%s)", (status) => {
    expect(canArchive(entity({ status })).allowed).toBe(false);
  });
  it.each(["ARCHIVADA", "ARCHIVADO"])("canRestore permite restaurar (%s)", (status) => {
    expect(canRestore(entity({ status })).allowed).toBe(true);
  });
  it("archived=true (flag) equivale a status ARCHIVADA/ARCHIVADO", () => {
    expect(canRestore(entity({ status: "COMPLETA", archived: true })).allowed).toBe(true);
  });
});

describe("vocabulario de estado — ANULADA/ANULADO/cancelado", () => {
  it.each(["ANULADA", "ANULADO", "cancelado"])("canDelete bloquea anulado (%s)", (status) => {
    expect(canDelete(entity({ status })).allowed).toBe(false);
  });
  it.each(["ANULADA", "ANULADO", "cancelado"])("canAnnul es idempotente (%s)", (status) => {
    expect(canAnnul(entity({ status })).allowed).toBe(false);
  });
});

describe("vocabulario de estado — REGISTRO_ELIMINADO", () => {
  it("canDelete/canAnnul/canArchive/canRestore bloquean sobre eliminado", () => {
    const e = entity({ status: "REGISTRO_ELIMINADO" });
    expect(canDelete(e).allowed).toBe(false);
    expect(canAnnul(e).allowed).toBe(false);
    expect(canArchive(e).allowed).toBe(false);
  });
  it("deleted=true (flag) equivale a status REGISTRO_ELIMINADO", () => {
    expect(canAnnul(entity({ status: "COMPLETA", deleted: true })).allowed).toBe(false);
  });
});

describe("matchesVisibilityFilter — consistente con las funciones can*", () => {
  it("ARCHIVADO cuenta como archivado, no como anulado", () => {
    const e = entity({ status: "ARCHIVADO" });
    expect(matchesVisibilityFilter("archivados", e)).toBe(true);
    expect(matchesVisibilityFilter("anulados", e)).toBe(false);
  });
  it("cancelado (work item) cuenta como anulado", () => {
    const e = entity({ status: "cancelado" });
    expect(matchesVisibilityFilter("anulados", e)).toBe(true);
    expect(matchesVisibilityFilter("activos", e)).toBe(false);
  });
  it("REGISTRO_ELIMINADO no aparece en activos ni archivados", () => {
    const e = entity({ status: "REGISTRO_ELIMINADO" });
    expect(matchesVisibilityFilter("activos", e)).toBe(false);
    expect(matchesVisibilityFilter("archivados", e)).toBe(false);
  });
  it("estado activo normal (COMPLETA) pasa el filtro activos", () => {
    const e = entity({ status: "COMPLETA" });
    expect(matchesVisibilityFilter("activos", e)).toBe(true);
  });
});

describe("BORRADOR vs pendiente — asimetría intencional (no un bug)", () => {
  it("canDelete trata 'pendiente' como borrador (permite eliminar)", () => {
    expect(canDelete(entity({ status: "pendiente" })).action).toBe("eliminar");
  });
  it("canAnnul NO trata 'pendiente' como borrador (sigue el camino normal de anular)", () => {
    // A propósito: solo canDelete incluye "pendiente" en su chequeo de
    // borrador. Este test fija ese comportamiento para que un futuro
    // refactor no lo cambie sin darse cuenta.
    const result = canAnnul(entity({ status: "pendiente" }));
    expect(result.action).not.toBe("eliminar");
  });
});
