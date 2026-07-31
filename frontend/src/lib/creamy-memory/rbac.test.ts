import { describe, expect, it } from "vitest";
import {
  canMutateUserMemory,
  canReadOperationalMemory,
  canReadUserMemory,
  canReportOperationalMemory,
  canValidateOperationalMemory,
} from "@/lib/creamy-memory/rbac";

describe("creamy-memory rbac", () => {
  it("cualquier sector operativo reconocido puede reportar hechos operativos", () => {
    expect(canReportOperationalMemory("ELABORACION")).toBe(true);
    expect(canReportOperationalMemory("ENVASADO_MASIVO")).toBe(true);
    expect(canReportOperationalMemory("CALIDAD")).toBe(true);
    expect(canReportOperationalMemory("no-es-un-sector")).toBe(false);
    expect(canReportOperationalMemory(null)).toBe(false);
  });

  it("solo Calidad, Producción o Dirección pueden validar/revocar hechos operativos", () => {
    expect(canValidateOperationalMemory("CALIDAD")).toBe(true);
    expect(canValidateOperationalMemory("PRODUCCION")).toBe(true);
    expect(canValidateOperationalMemory("DIRECCION")).toBe(true);
    expect(canValidateOperationalMemory("ELABORACION")).toBe(false);
    expect(canValidateOperationalMemory("ENVASADO_MASIVO")).toBe(false);
    expect(canValidateOperationalMemory("MATERIA_PRIMA")).toBe(false);
  });

  it("la memoria operativa es de lectura compartida entre sectores reconocidos", () => {
    expect(canReadOperationalMemory("ELABORACION")).toBe(true);
    expect(canReadOperationalMemory("DIRECCION")).toBe(true);
    expect(canReadOperationalMemory("invalido")).toBe(false);
  });

  it("la memoria personal solo puede leerse/mutarse por el mismo email", () => {
    expect(canReadUserMemory("ana@genus.com", "ana@genus.com")).toBe(true);
    expect(canReadUserMemory("Ana@Genus.com", " ana@genus.com ")).toBe(true);
    expect(canReadUserMemory("ana@genus.com", "beto@genus.com")).toBe(false);
    expect(canReadUserMemory("", "")).toBe(false);

    expect(canMutateUserMemory("ana@genus.com", "ana@genus.com")).toBe(true);
    expect(canMutateUserMemory("ana@genus.com", "beto@genus.com")).toBe(false);
  });
});
