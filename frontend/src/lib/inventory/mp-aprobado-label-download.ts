"use client";

import { getCurrentAuthSession } from "@/features/os/auth/lib/auth-session-helpers";
import {
  HERELABEL_OFFICIAL_STORE_URL,
  mpAprobadoLabelFilename,
  type MpAprobadoLabelData,
} from "@/lib/inventory/mp-aprobado-label";
import {
  MP_APROBADO_LABEL_DOWNLOAD_PATH,
  MP_APROBADO_LABEL_MIME,
} from "@/lib/inventory/mp-aprobado-label-pdf";
import {
  ACTOR_EMAIL_HEADER,
  ACTOR_SECTOR_HEADER,
} from "@/lib/orders/actor";

/** Mantener Blob URL + <a> vivos (Safari iOS pierde la ref si se revoca demasiado pronto). */
export const MP_LABEL_BLOB_URL_KEEPALIVE_MS = 120_000;

export type MpLabelDownloadResult = {
  filename: string;
  mode: "blob" | "ticket";
  /** Mensaje seguro: no afirma que el archivo quedó guardado. */
  toast: "Descarga iniciada";
};

type PendingBlobDownload = {
  url: string;
  anchor: HTMLAnchorElement;
  timer: number;
  onHide: () => void;
};

const pendingBlobDownloads: PendingBlobDownload[] = [];

function cleanupPending(entry: PendingBlobDownload) {
  window.clearTimeout(entry.timer);
  window.removeEventListener("pagehide", entry.onHide);
  try {
    URL.revokeObjectURL(entry.url);
  } catch {
    /* ignore */
  }
  try {
    entry.anchor.remove();
  } catch {
    /* ignore */
  }
  const idx = pendingBlobDownloads.indexOf(entry);
  if (idx >= 0) pendingBlobDownloads.splice(idx, 1);
}

function keepBlobDownloadAlive(url: string, anchor: HTMLAnchorElement) {
  const entry: PendingBlobDownload = {
    url,
    anchor,
    timer: 0,
    onHide: () => undefined,
  };
  entry.onHide = () => cleanupPending(entry);
  entry.timer = window.setTimeout(
    () => cleanupPending(entry),
    MP_LABEL_BLOB_URL_KEEPALIVE_MS
  );
  window.addEventListener("pagehide", entry.onHide);
  pendingBlobDownloads.push(entry);
}

function actorAuthHeaders(): HeadersInit {
  const session = getCurrentAuthSession();
  const email = session?.user.email?.trim() ?? "";
  const sector = session?.sector.id?.trim() ?? "";
  if (!email) {
    throw new Error("Sesión requerida para descargar la etiqueta.");
  }
  return {
    "Content-Type": "application/json",
    [ACTOR_EMAIL_HEADER]: email,
    [ACTOR_SECTOR_HEADER]: sector,
  };
}

function labelRequestBody(data: MpAprobadoLabelData, mode?: "ticket") {
  const filename = mpAprobadoLabelFilename(data);
  return {
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
    ...(mode ? { mode } : {}),
  };
}

/** iPhone / iPad (incl. iPadOS desktop UA). */
export function isIosDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (/iPad|iPhone|iPod/i.test(ua)) return true;
  // iPadOS 13+ puede reportar MacIntel con touch
  return navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
}

/**
 * Descarga nativa Safari iOS: ticket firmado + navegación same-origin a GET attachment.
 * Evita Blob URL (Safari inicia la descarga visualmente pero no persiste el archivo).
 */
async function downloadMpAprobadoLabelViaTicket(
  data: MpAprobadoLabelData
): Promise<MpLabelDownloadResult> {
  // Crear el iframe antes del await para no depender solo del gesto post-fetch.
  const iframe = document.createElement("iframe");
  iframe.setAttribute("data-mp-label-download", "1");
  iframe.setAttribute("aria-hidden", "true");
  iframe.tabIndex = -1;
  iframe.style.cssText =
    "position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;left:-9999px;top:0;";
  document.body.appendChild(iframe);

  const a = document.createElement("a");
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);

  try {
    const res = await fetch(MP_APROBADO_LABEL_DOWNLOAD_PATH, {
      method: "POST",
      headers: actorAuthHeaders(),
      body: JSON.stringify(labelRequestBody(data, "ticket")),
      cache: "no-store",
    });
    const json = (await res.json().catch(() => ({}))) as {
      error?: string;
      downloadUrl?: string;
      filename?: string;
    };
    if (!res.ok || !json.downloadUrl) {
      throw new Error(json.error ?? `No se pudo preparar la descarga (${res.status})`);
    }

    const filename = json.filename || mpAprobadoLabelFilename(data);
    const absoluteUrl = new URL(json.downloadUrl, window.location.origin).toString();

    a.href = absoluteUrl;
    a.download = filename.endsWith(".pdf") ? filename : `${filename}.pdf`;
    iframe.src = absoluteUrl;
    a.click();

    window.setTimeout(() => {
      try {
        iframe.remove();
      } catch {
        /* ignore */
      }
      try {
        a.remove();
      } catch {
        /* ignore */
      }
    }, MP_LABEL_BLOB_URL_KEEPALIVE_MS);

    return { filename: a.download, mode: "ticket", toast: "Descarga iniciada" };
  } catch (err) {
    try {
      iframe.remove();
    } catch {
      /* ignore */
    }
    try {
      a.remove();
    } catch {
      /* ignore */
    }
    throw err;
  }
}

/**
 * Desktop / no-iOS: fetch → Blob application/pdf → <a download>.
 * Mantiene URL + ancla vivos ≥ 120s (y pagehide).
 */
async function downloadMpAprobadoLabelViaBlob(
  data: MpAprobadoLabelData
): Promise<MpLabelDownloadResult> {
  const filename = mpAprobadoLabelFilename(data);
  const res = await fetch(MP_APROBADO_LABEL_DOWNLOAD_PATH, {
    method: "POST",
    headers: actorAuthHeaders(),
    body: JSON.stringify(labelRequestBody(data)),
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
  if (bytes.byteLength < 5) {
    throw new Error("El archivo descargado está vacío.");
  }
  const magic = new TextDecoder().decode(bytes.slice(0, 4));
  if (magic !== "%PDF") {
    throw new Error("La respuesta no es un PDF válido.");
  }

  const cd = res.headers.get("Content-Disposition") ?? "";
  const match = /filename\*=UTF-8''([^;]+)|filename="([^"]+)"/i.exec(cd);
  const rawName = match?.[1] || match?.[2];
  const resolvedName = rawName ? decodeURIComponent(rawName) : filename;

  // type application/pdf aunque el HTTP haya sido octet-stream
  const blob = new Blob([bytes], { type: MP_APROBADO_LABEL_MIME });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = resolvedName.endsWith(".pdf") ? resolvedName : `${resolvedName}.pdf`;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  // NO revoke ni remove inmediato — Safari necesita la ref viva.
  keepBlobDownloadAlive(url, a);

  return { filename: a.download, mode: "blob", toast: "Descarga iniciada" };
}

/**
 * Descarga etiqueta:
 * - iOS → ticket firmado + GET nativo (attachment PDF)
 * - resto → Blob PDF con keepalive 120s
 * No usa window.open hacia el PDF.
 */
export async function downloadMpAprobadoLabelFromApi(
  data: MpAprobadoLabelData
): Promise<MpLabelDownloadResult> {
  if (isIosDevice()) {
    return downloadMpAprobadoLabelViaTicket(data);
  }
  return downloadMpAprobadoLabelViaBlob(data);
}

/**
 * Abre la página oficial de HereLabel (App Store).
 * No hay deep link documentado hacia “Importar PDF”.
 */
export function openHereLabelOfficialPage(): void {
  window.open(HERELABEL_OFFICIAL_STORE_URL, "_blank", "noopener,noreferrer");
}
