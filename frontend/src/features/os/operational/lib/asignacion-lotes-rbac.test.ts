import { describe, expect, it } from "vitest";
import type { SectorId } from "@/types/operational/sector";
import {
  canAccessAsignacionLotes,
  canMutateAsignacionLotes,
} from "./asignacion-lotes-rbac";

describe("asignacion-lotes-rbac", () => {
  it("habilita acceso y mutación solo para Calidad, Producción y Codificado", () => {
    const allowed: SectorId[] = ["CALIDAD", "PRODUCCION", "CODIFICADO"];
    const denied: Array<SectorId | null | undefined> = [
      "ELABORACION",
      "ENVASADO_MASIVO",
      "ENVASADO_PREMIUM",
      "MATERIA_PRIMA",
      "DEPOSITO",
      "DIRECCION",
      null,
      undefined,
    ];

    for (const sector of allowed) {
      expect(canAccessAsignacionLotes(sector)).toBe(true);
      expect(canMutateAsignacionLotes(sector)).toBe(true);
    }

    for (const sector of denied) {
      expect(canAccessAsignacionLotes(sector)).toBe(false);
      expect(canMutateAsignacionLotes(sector)).toBe(false);
    }
  });
});
