/**
 * Generación PDF server-only (PDFKit + pdf-lib).
 * No importar desde Client Components.
 */
import type { MpAprobadoLabelData } from "@/lib/inventory/mp-aprobado-label";
import { buildMpAprobadoLabelPdfBufferPdfKit } from "@/lib/inventory/mp-aprobado-label-pdfkit";

export {
  MP_APROBADO_LABEL_MIME,
  MP_APROBADO_LABEL_DOWNLOAD_MIME,
  MP_APROBADO_LABEL_DOWNLOAD_PATH,
  buildMpAprobadoLabelFromIngreso,
} from "@/lib/inventory/mp-aprobado-label";

/**
 * PDF definitivo 75×50 mm (PDFKit + cajas normalizadas).
 * Una sola página horizontal; MediaBox/CropBox/TrimBox/BleedBox alineados; Rotate=0.
 */
export async function buildMpAprobadoLabelPdfBuffer(
  data: MpAprobadoLabelData
): Promise<Buffer> {
  return buildMpAprobadoLabelPdfBufferPdfKit(data);
}

export async function buildMpAprobadoLabelPdfBlob(
  data: MpAprobadoLabelData
): Promise<Blob> {
  const { MP_APROBADO_LABEL_MIME } = await import("@/lib/inventory/mp-aprobado-label");
  const buf = await buildMpAprobadoLabelPdfBuffer(data);
  return new Blob([new Uint8Array(buf)], { type: MP_APROBADO_LABEL_MIME });
}
