import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LegalOrderPreview } from "@/features/os/operational/components/legal-order-preview";
import { buildSerumAntiageOeTemplateContent, buildCremaFacialLaudeOaTemplateContent } from "@/lib/orders/seed-templates";
import type { OperationalOrderRecord } from "@/lib/orders/types";

function sampleOrder(
  type: "OE" | "OA",
  formData: OperationalOrderRecord["formData"]
): OperationalOrderRecord {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    orderNumber: type === "OE" ? "OE-2026-000001" : "OA-2026-000001",
    type,
    templateId: "tmpl",
    templateVersion: 1,
    templateSnapshot: formData,
    product: formData.kind === "OE" ? formData.header.productName : formData.header.productName,
    client: formData.kind === "OE" ? formData.header.client : formData.header.client,
    code: formData.kind === "OE" ? formData.header.code : formData.header.productCode,
    lot: formData.kind === "OE" ? formData.header.lot : formData.header.lot,
    assignedSector: type === "OE" ? "ELABORACION" : "ENVASADO_MASIVO",
    formulaProductId: null,
    formulaVersionId: null,
    formulaVersionHash: null,
    status: "COMPLETA",
    formData,
    completionPercentage: 100,
    revision: 1,
    version: 1,
    linkedWorkItemId: null,
    reviewedAt: null,
    reviewedBy: null,
    completedAt: null,
    completedBy: null,
    createdBy: "test",
    updatedBy: "test",
    createdAt: "2026-07-20T12:00:00.000Z",
    updatedAt: "2026-07-20T12:00:00.000Z",
  };
}

describe("legal print layout snapshots", () => {
  it("OE serum conserva secciones y firmas en blanco", () => {
    const html = renderToStaticMarkup(
      <LegalOrderPreview order={sampleOrder("OE", buildSerumAntiageOeTemplateContent())} />
    );
    expect(html).toContain("OE");
    expect(html).toContain("SERUM FACIAL ANTIAGE");
    expect(html).toContain("MATERIAS PRIMAS");
    expect(html).toContain("PROCEDIMIENTO DE ELABORACIÓN");
    expect(html).toContain("Firma Producción");
    expect(html).toContain("Firma Control de Calidad");
    expect(html).toContain("Firma Dirección Técnica");
    expect(html).not.toContain("Completado:");
    expect(html).not.toMatch(/data:image\/.*signature/i);
  });

  it("OA Laude conserva texto legal de etiquetado y autorizaciones vacías", () => {
    const content = buildCremaFacialLaudeOaTemplateContent();
    if (content.kind !== "OA") throw new Error("expected OA");
    // Cliente de ejemplo vive en metadatos de plantilla (brandClient), no como dato fijo del contenido.
    const order = sampleOrder("OA", {
      ...content,
      header: { ...content.header, client: "LAUDE" },
    });
    const html = renderToStaticMarkup(<LegalOrderPreview order={order} />);
    expect(html).toContain("ORDEN DE ACONDICIONAMIENTO");
    expect(html).toContain("CREMA FACIAL");
    expect(html).toContain("LAUDE");
    expect(html).toContain(
      "Codificar en la hoja lote y vencimiento, como se realiza en el envase y firmar fecha del responsable."
    );
    expect(html).toContain("AUTORIZACION PRODUCCION");
    expect(html).toContain("AUTORIZACION CONTROL CALIDAD");
    expect(html).toContain("AUTORIZACION DIRECCION TECNICA");
    expect(html).toContain("ENVASE");
    expect(html).not.toContain("Completado:");
  });
});
