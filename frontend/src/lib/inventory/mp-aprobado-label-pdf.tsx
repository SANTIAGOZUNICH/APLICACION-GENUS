import { pdf, renderToBuffer } from "@react-pdf/renderer";
import React from "react";
import { MpAprobadoLabelDocument } from "@/lib/inventory/mp-aprobado-label-document";
import {
  HERELABEL_OFFICIAL_STORE_URL,
  mapMpIngresoToLabelData,
  mpAprobadoLabelFilename,
  type MpAprobadoLabelData,
  type MpAprobadoLabelSource,
} from "@/lib/inventory/mp-aprobado-label";

export const MP_APROBADO_LABEL_MIME = "application/pdf";

export async function buildMpAprobadoLabelPdfBuffer(
  data: MpAprobadoLabelData
): Promise<Buffer> {
  const buffer = await renderToBuffer(
    <MpAprobadoLabelDocument data={data} />
  );
  return Buffer.from(buffer);
}

export async function buildMpAprobadoLabelPdfBlob(
  data: MpAprobadoLabelData
): Promise<Blob> {
  const instance = pdf(<MpAprobadoLabelDocument data={data} />);
  return instance.toBlob();
}

export function buildMpAprobadoLabelFromIngreso(ingreso: MpAprobadoLabelSource): {
  data: MpAprobadoLabelData;
  filename: string;
} {
  const data = mapMpIngresoToLabelData(ingreso);
  return { data, filename: mpAprobadoLabelFilename(data) };
}

export async function downloadMpAprobadoLabelPdf(
  blob: Blob,
  filename: string
): Promise<void> {
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
}

/**
 * Abre la página oficial de HereLabel (App Store).
 * No hay deep link documentado hacia “Importar PDF”.
 */
export function openHereLabelOfficialPage(): void {
  window.open(HERELABEL_OFFICIAL_STORE_URL, "_blank", "noopener,noreferrer");
}
