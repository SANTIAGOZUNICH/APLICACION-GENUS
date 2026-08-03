import { describe, expect, it } from "vitest";
import {
  WORK_MUTATION_DENIED_MESSAGE,
  WORK_MUTATION_MISSING_ACTOR_MESSAGE,
  canMutateAssignedWork,
  gateWorkMutation,
  validateWorkMutationActor,
} from "./work-mutation-rbac";

describe("work-mutation-rbac", () => {
  it("solo PRODUCCION puede mutar trabajos asignados", () => {
    expect(canMutateAssignedWork("PRODUCCION")).toBe(true);
    expect(canMutateAssignedWork("ELABORACION")).toBe(false);
    expect(canMutateAssignedWork("ENVASADO_MASIVO")).toBe(false);
    expect(canMutateAssignedWork("ENVASADO_PREMIUM")).toBe(false);
    expect(canMutateAssignedWork(null)).toBe(false);
    expect(canMutateAssignedWork(undefined)).toBe(false);
  });

  it("gateWorkMutation devuelve errores claros para actor ausente o no autorizado", () => {
    expect(gateWorkMutation("PRODUCCION")).toEqual({ ok: true });

    const missing = gateWorkMutation(null);
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.error).toBe(WORK_MUTATION_MISSING_ACTOR_MESSAGE);
      expect(missing.code).toBe("WORK_MUTATION_MISSING_ACTOR");
    }

    const denied = gateWorkMutation("ELABORACION");
    expect(denied.ok).toBe(false);
    if (!denied.ok) {
      expect(denied.error).toBe(WORK_MUTATION_DENIED_MESSAGE);
      expect(denied.code).toBe("WORK_MUTATION_FORBIDDEN");
    }
  });

  it("validateWorkMutationActor marca ausente e inválido con códigos que el route mapea a 403", () => {
    const absent = validateWorkMutationActor(undefined);
    expect(absent.ok).toBe(false);
    if (!absent.ok) {
      expect(absent.code).toBe("WORK_MUTATION_MISSING_ACTOR");
      expect(absent.error).toBe(WORK_MUTATION_MISSING_ACTOR_MESSAGE);
    }

    const blank = validateWorkMutationActor("");
    expect(blank.ok).toBe(false);
    if (!blank.ok) {
      expect(blank.code).toBe("WORK_MUTATION_MISSING_ACTOR");
    }

    const invalid = validateWorkMutationActor("ENVASADO_MASIVO");
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) {
      expect(invalid.code).toBe("WORK_MUTATION_FORBIDDEN");
      expect(invalid.error).toBe(WORK_MUTATION_DENIED_MESSAGE);
    }
  });
});
