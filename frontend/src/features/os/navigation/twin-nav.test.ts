import { describe, expect, it } from "vitest";
import { historialSectorsForActor } from "./twin-nav";

describe("historialSectorsForActor — bug: Codificado invisible en Historial de Producción", () => {
  it("PRODUCCION debe ver el historial de Elaboración, Envasado (Masivo/Premium) y Codificado", () => {
    expect(historialSectorsForActor("PRODUCCION")).toEqual([
      "ELABORACION",
      "ENVASADO_MASIVO",
      "ENVASADO_PREMIUM",
      "CODIFICADO",
    ]);
  });

  it("MATERIA_PRIMA solo ve Elaboración", () => {
    expect(historialSectorsForActor("MATERIA_PRIMA")).toEqual(["ELABORACION"]);
  });

  it("cualquier otro sector solo ve su propio historial", () => {
    expect(historialSectorsForActor("CODIFICADO")).toEqual(["CODIFICADO"]);
    expect(historialSectorsForActor("CALIDAD")).toEqual(["CALIDAD"]);
  });
});
