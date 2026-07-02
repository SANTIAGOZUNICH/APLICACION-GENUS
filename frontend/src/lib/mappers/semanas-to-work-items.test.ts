import { describe, expect, it } from "vitest";
import { detectSemanasBlocks } from "@/lib/mappers/semanas-block-parser";
import { semanasRowsToWorkItems } from "@/lib/mappers/semanas-to-work-items";
import {
  SEMANAS_ELABORACION_FIXTURE,
  SEMANAS_ENVASADO_FIXTURE,
} from "@/lib/mappers/__fixtures__/semanas-visual.fixture";
import {
  TEST_ELABORACION_ENTREGA_HEADER_ROWS,
  TEST_ELABORACION_ROWS,
  TEST_ENVASADO_ROWS,
} from "@/lib/mappers/__fixtures__/semanas-test-rows.fixture";

const FIXTURE_FILE_ID = "test-semanas-file";

function mapRows(tab: string, rows: string[][]) {
  const blocks = detectSemanasBlocks(rows);
  return semanasRowsToWorkItems({ fileId: FIXTURE_FILE_ID, tab, rows, blocks });
}

describe("semanasRowsToWorkItems — F10.1 bloques visuales", () => {
  describe("Elaboración", () => {
    it("asigna ownerPerson por bloque de elaborador", () => {
      const { workItems } = mapRows("SEMANAS", TEST_ELABORACION_ROWS);

      const cristianItems = workItems.filter((item) => item.ownerPerson === "Cristian");
      const nicolasItems = workItems.filter((item) => item.ownerPerson === "Nicolás");

      expect(cristianItems).toHaveLength(3);
      expect(nicolasItems).toHaveLength(2);
      expect(cristianItems.every((item) => item.sector === "ELABORACION")).toBe(true);
      expect(nicolasItems.every((item) => item.sector === "ELABORACION")).toBe(true);
    });

    it("preserva referencias OE y producto del bloque visual", () => {
      const { workItems } = mapRows("SEMANAS", TEST_ELABORACION_ROWS);

      const serum = workItems.find((item) => item.product === "Serum Niacinamida");
      expect(serum).toMatchObject({
        ownerPerson: "Cristian",
        client: "Icono",
        oeRef: "OE-101",
        actionLabel: "Abrir OE",
      });
    });
  });

  describe("Envasado", () => {
    it("organiza masivo por línea y premium por tier", () => {
      const { workItems } = mapRows("SEMANAS", TEST_ENVASADO_ROWS);

      const masivo = workItems.filter((item) => item.sector === "ENVASADO_MASIVO");
      const premium = workItems.filter((item) => item.sector === "ENVASADO_PREMIUM");

      expect(masivo).toHaveLength(2);
      expect(premium).toHaveLength(2);

      expect(masivo.find((item) => item.line === "LÍNEA 1")).toMatchObject({
        client: "Thelma",
        product: "Exfoliante Arroz",
        oaRef: "OA-301",
      });

      expect(premium.find((item) => item.line === "PREMIUM A")).toMatchObject({
        client: "Natura",
        product: "Serum Vitamina C",
      });
    });

    it("no mezcla sectores masivo y premium", () => {
      const { workItems } = mapRows("SEMANAS", TEST_ENVASADO_ROWS);

      for (const item of workItems) {
        expect(["ENVASADO_MASIVO", "ENVASADO_PREMIUM"]).toContain(item.sector);
      }
    });
  });

  describe("Modelo operativo Trabajo → Datos", () => {
    it("genera WorkItems con trazabilidad de origen SEMANAS", () => {
      const { workItems } = mapRows("SEMANAS", TEST_ELABORACION_ROWS);

      for (const item of workItems) {
        expect(item.source).toBe("semanas_2026");
        expect(item.sourceFileId).toBe(FIXTURE_FILE_ID);
        expect(item.status).toBe("pendiente");
        expect(item.id).toMatch(/^semanas:/);
        expect(item.createdFrom).toContain("SEMANAS 2026");
      }
    });
  });

  describe("Regresión — fixture visual original", () => {
    it("procesa el fixture semanas-visual sin lanzar errores", () => {
      const elaboracion = mapRows("SEMANAS", SEMANAS_ELABORACION_FIXTURE);
      const envasado = mapRows("SEMANAS", SEMANAS_ENVASADO_FIXTURE);

      expect(elaboracion.workItems.length + envasado.workItems.length).toBeGreaterThan(0);
    });

    it("documenta edge case: header con columna Entrega fragmenta bloques", () => {
      const blocks = detectSemanasBlocks(TEST_ELABORACION_ENTREGA_HEADER_ROWS);
      const entregasBlocks = blocks.filter((b) => b.kind === "ENTREGAS");
      expect(entregasBlocks.length).toBeGreaterThan(0);
    });
  });
});
