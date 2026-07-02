import { describe, expect, it } from "vitest";
import {
  detectElaboradorLabel,
  detectLineLabel,
  detectPackagingTier,
  detectSemanasBlocks,
  normalizeLineLabel,
} from "@/lib/mappers/semanas-block-parser";
import {
  SEMANAS_ELABORACION_FIXTURE,
  SEMANAS_ENVASADO_FIXTURE,
} from "@/lib/mappers/__fixtures__/semanas-visual.fixture";

describe("semanas-block-parser", () => {
  describe("detectElaboradorLabel", () => {
    it("normaliza nombres de elaborador en bloques visuales", () => {
      expect(detectElaboradorLabel(["CRISTIAN"])).toBe("Cristian");
      expect(detectElaboradorLabel(["NICOLÁS"])).toBe("Nicolás");
    });

    it("rechaza headers de tabla y bloques de sección", () => {
      expect(detectElaboradorLabel(["Cliente", "Producto", "Kg"])).toBeNull();
      expect(detectElaboradorLabel(["ELABORACIÓN"])).toBeNull();
    });

    it("documenta que filas cortas tipo cliente pueden confundirse con elaborador", () => {
      // Edge case conocido: filas de 3 celdas con nombre corto en col 1.
      // El mapper completo usa contexto de bloque ELABORACION para filtrar.
      expect(detectElaboradorLabel(["Icono", "Serum", "120"])).toBe("Icono");
    });
  });

  describe("detectLineLabel", () => {
    it("detecta líneas de envasado masivo y premium", () => {
      expect(detectLineLabel(["LÍNEA 1"])).toBe("LÍNEA 1");
      expect(detectLineLabel(["LÍNEA 2"])).toBe("LÍNEA 2");
      expect(detectLineLabel(["PREMIUM A"])).toBe("PREMIUM A");
      expect(detectLineLabel(["PREMIUM B"])).toBe("PREMIUM B");
    });

    it("rechaza filas con datos de producto", () => {
      expect(detectLineLabel(["Thelma", "Exfoliante Arroz", "3300"])).toBeNull();
    });
  });

  describe("detectPackagingTier", () => {
    it("identifica tier masivo y premium en bloques SEMANAS", () => {
      expect(detectPackagingTier(["ACONDICIONAMIENTO MASIVO"])).toBe("masivo");
      expect(detectPackagingTier(["ACONDICIONAMIENTO PREMIUM"])).toBe("premium");
    });
  });

  describe("normalizeLineLabel", () => {
    it("preserva etiquetas de línea canónicas", () => {
      expect(normalizeLineLabel("linea 1")).toBe("LÍNEA 1");
      expect(normalizeLineLabel("PREMIUM A")).toBe("PREMIUM A");
    });
  });

  describe("detectSemanasBlocks", () => {
    it("detecta bloque ELABORACIÓN al inicio del fixture", () => {
      const blocks = detectSemanasBlocks(SEMANAS_ELABORACION_FIXTURE);
      expect(blocks[0]?.kind).toBe("ELABORACION");
    });

    it("segmenta bloques de acondicionamiento masivo y premium", () => {
      const envasadoBlocks = detectSemanasBlocks(SEMANAS_ENVASADO_FIXTURE);
      const kinds = envasadoBlocks.map((b) => b.kind);
      expect(kinds).toContain("ACONDICIONAMIENTO");
      expect(envasadoBlocks.length).toBeGreaterThanOrEqual(2);
    });
  });
});
