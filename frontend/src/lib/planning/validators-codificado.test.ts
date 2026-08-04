import { describe, expect, it } from "vitest";
import { assertSectorAssignment } from "./validators";
import { PlanningValidationError } from "./types";

describe("assertSectorAssignment CODIFICADO", () => {
  it("acepta CODIFICADO sin line ni branchOwner", () => {
    expect(assertSectorAssignment("CODIFICADO", null, null)).toEqual({
      line: null,
      branchOwner: null,
    });
  });

  it("rechaza line o branchOwner en CODIFICADO", () => {
    expect(() => assertSectorAssignment("CODIFICADO", "Línea 1", null)).toThrow(
      PlanningValidationError
    );
    expect(() => assertSectorAssignment("CODIFICADO", null, "Cristian")).toThrow(
      PlanningValidationError
    );
  });
});
