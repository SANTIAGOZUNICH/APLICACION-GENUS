import { pdf, renderToBuffer } from "@react-pdf/renderer";
import React from "react";
import { MpAprobadoLabelDocument } from "@/lib/inventory/mp-aprobado-label-document";
import {
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
  return { data, filename: mpAprobadoLabelFilename(data.sourceId) };
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
 * Comparte / abre en apps (HereLabel vía hoja de compartir del SO).
 * Fallback: abre el PDF en una pestaña nueva.
 */
export async function shareOrOpenMpAprobadoLabelPdf(
  blob: Blob,
  filename: string
): Promise<"shared" | "opened"> {
  const file = new File([blob], filename, { type: MP_APROBADO_LABEL_MIME });
  const nav = typeof navigator !== "undefined" ? navigator : null;
  if (nav && typeof nav.share === "function") {
    try {
      const can =
        typeof nav.canShare !== "function" || nav.canShare({ files: [file] });
      if (can) {
        await nav.share({
          files: [file],
          title: filename,
          text: "Etiqueta APROBADO MATERIA PRIMA",
        });
        return "shared";
      }
    } catch (err) {
      // AbortError = usuario canceló; no tratar como fallo duro
      if (err instanceof DOMException && err.name === "AbortError") {
        return "shared";
      }
    }
  }

  const url = URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener,noreferrer");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return "opened";
}
