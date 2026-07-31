"use client";

import { getCurrentAuthSession } from "@/features/os/auth/lib/auth-session-helpers";
import {
  HERELABEL_OFFICIAL_STORE_URL,
  mpAprobadoLabelFilename,
  type MpAprobadoLabelData,
} from "@/lib/inventory/mp-aprobado-label";
import {
  MP_APROBADO_LABEL_DOWNLOAD_MIME,
  MP_APROBADO_LABEL_DOWNLOAD_PATH,
} from "@/lib/inventory/mp-aprobado-label-pdf";
import {
  ACTOR_EMAIL_HEADER,
  ACTOR_SECTOR_HEADER,
} from "@/lib/orders/actor";

/**
 * Descarga autenticada vía API (octet-stream + Content-Disposition attachment).
 * No usa window.open ni navega a la URL del PDF — crítico en Safari iPhone.
 */
export async function downloadMpAprobadoLabelFromApi(
  data: MpAprobadoLabelData
): Promise<{ filename: string }> {
  const session = getCurrentAuthSession();
  const email = session?.user.email?.trim() ?? "";
  const sector = session?.sector.id?.trim() ?? "";
  if (!email) {
    throw new Error("Sesión requerida para descargar la etiqueta.");
  }

  const filename = mpAprobadoLabelFilename(data);
  const res = await fetch(MP_APROBADO_LABEL_DOWNLOAD_PATH, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      [ACTOR_EMAIL_HEADER]: email,
      [ACTOR_SECTOR_HEADER]: sector,
    },
    body: JSON.stringify({
      id: data.sourceId,
      producto: data.producto,
      pccMeNro: data.pccMeNro,
      fecha: data.ingreso,
      remitoNro: data.remitoNro,
      cantidad: data.cantidad,
      proveedor: data.proveedor,
      bultos: data.bultos,
      lote: data.loteProveedor,
      filename,
    }),
    cache: "no-store",
  });

  const ct = res.headers.get("Content-Type") || "";
  if (!res.ok) {
    const body = ct.includes("application/json")
      ? ((await res.json().catch(() => ({}))) as { error?: string })
      : {};
    throw new Error(body.error ?? `Descarga falló (${res.status})`);
  }
  if (ct.includes("application/json")) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "La descarga devolvió JSON en lugar del archivo");
  }

  const bytes = await res.arrayBuffer();
  // Forzar octet-stream en el Blob para que Safari no abra el visor PDF.
  const blob = new Blob([bytes], { type: MP_APROBADO_LABEL_DOWNLOAD_MIME });

  const cd = res.headers.get("Content-Disposition") ?? "";
  const match = /filename\*=UTF-8''([^;]+)|filename="([^"]+)"/i.exec(cd);
  const rawName = match?.[1] || match?.[2];
  const resolvedName = rawName ? decodeURIComponent(rawName) : filename;

  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = resolvedName;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    URL.revokeObjectURL(url);
  }

  return { filename: resolvedName };
}

/**
 * Abre la página oficial de HereLabel (App Store).
 * No hay deep link documentado hacia “Importar PDF”.
 */
export function openHereLabelOfficialPage(): void {
  window.open(HERELABEL_OFFICIAL_STORE_URL, "_blank", "noopener,noreferrer");
}
