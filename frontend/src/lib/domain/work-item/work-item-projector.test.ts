import { describe, expect, it } from "vitest";
import { createEmptyDomainWorkItem } from "@/lib/domain/work-item/domain-work-item";
import { projectDomainWorkItem } from "@/lib/domain/work-item/work-item-projector";

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
