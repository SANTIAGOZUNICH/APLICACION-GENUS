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
export const MP_APROBADO_LABEL_DOWNLOAD_MIME = "application/octet-stream";
export const MP_APROBADO_LABEL_DOWNLOAD_PATH =
  "/api/v1/mp-labels/aprobado/download";

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
