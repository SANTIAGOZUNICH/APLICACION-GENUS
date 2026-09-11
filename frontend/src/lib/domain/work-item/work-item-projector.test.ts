import { describe, expect, it } from "vitest";
import { createEmptyDomainWorkItem } from "@/lib/domain/work-item/domain-work-item";
import {
  projectDomainWorkItem,
  projectQualityItemsFromDomain,
} from "@/lib/domain/work-item/work-item-projector";
import type { AttributeSource } from "@/lib/domain/work-item/attribute-sources";

describe("work-item-projector", () => {
  it("atribuye source asignacion_lotes_2026 cuando no hay SEMANAS ni PEDIDOS", () => {
    const domain = {
      ...createEmptyDomainWorkItem("lote-only:1"),
      sector: "CALIDAD" as const,
      ownerSector: "CALIDAD" as const,
      loteRef: "A12345",
      product: "SERUM TEST",
      client: "LAB TEST",
      enrichmentSources: ["asignacion_lotes_2026"] as const,
      sourceFileIds: { asignacion_lotes_2026: "file-lotes" },
      sourceRanges: { asignacion_lotes_2026: "JULIO!A12345" },
    };

    const projected = projectDomainWorkItem(domain);
    expect(projected?.source).toBe("asignacion_lotes_2026");
    expect(projected?.sourceSheet).toBe("JULIO");
  });
});

/**
 * TRIPWIRE (auditoría de integridad end-to-end del WorkItem) —
 * projectQualityItemsFromDomain() es el proyector del modo LEGACY "sheets"
 * (sin DATABASE_URL): DomainWorkItem nunca tuvo packagingLote/packagingVto/
 * packingGroups/sampleUnits/deliverableUnits/pedidoOp, así que este
 * proyector JAMÁS debe fingir tenerlos. Si esta prueba empieza a fallar
 * porque alguien agregó esas claves acá, es una señal de que hay que leer
 * el comentario en work-item-projector.ts antes de seguir — el pipeline de
 * Sheets (load-operational-pipeline.ts) todavía no provee esos datos de
 * verdad, así que "agregar la clave" sin más inventaría información.
 *
 * El proyector completo para el modo nativo (el que corre en Production)
 * es projectQualityItem() en native-projector.ts — ver su propio test.
 */
describe("projectQualityItemsFromDomain — contrato legacy incompleto A PROPÓSITO (tripwire)", () => {
  it("nunca declara vto/packingGroups/packedUnits/sampleUnits/pedidoOp — DomainWorkItem no tiene de dónde sacarlos", () => {
    const domain = {
      ...createEmptyDomainWorkItem("legacy:1"),
      sector: "CALIDAD" as const,
      loteRef: "L26055",
      product: "SERUM TEST",
      client: "LAB TEST",
      oaRef: "OA-2026-000150",
      enrichmentSources: ["asignacion_lotes_2026"] as AttributeSource[],
    };

    const [item] = projectQualityItemsFromDomain([domain]);
    expect(item).toBeTruthy();
    expect(item).not.toHaveProperty("vto");
    expect(item).not.toHaveProperty("packingGroups");
    expect(item).not.toHaveProperty("packedUnits");
    expect(item).not.toHaveProperty("sampleUnits");
    expect(item).not.toHaveProperty("pedidoOp");
    // Lo único que este modo puede garantizar de verdad.
    expect(item!.lote).toBe("L26055");
    expect(item!.oa).toBe("OA-2026-000150");
  });
});
