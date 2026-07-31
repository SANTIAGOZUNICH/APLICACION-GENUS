"use client";

import { getCurrentAuthSession } from "@/features/os/auth/lib/auth-session-helpers";
import {
  HERELABEL_OFFICIAL_STORE_URL,
  MP_APROBADO_LABEL_DOWNLOAD_PATH,
  MP_APROBADO_LABEL_MIME,
  mpAprobadoLabelFilename,
  type MpAprobadoLabelData,
} from "@/lib/inventory/mp-aprobado-label";
import {
  ACTOR_EMAIL_HEADER,
  ACTOR_SECTOR_HEADER,
} from "@/lib/orders/actor";

/** Mantener <a> / Blob URL vivos (Safari iOS). */
export const MP_LABEL_BLOB_URL_KEEPALIVE_MS = 120_000;

export type MpLabelDownloadResult = {
  filename: string;
  mode: "blob" | "ticket";
  toast: "Descarga iniciada";
};

export type MpLabelPreparedTicket = {
  downloadUrl: string;
  filename: string;
  expiresAt: number;
};

type PendingAnchor = {
  anchor: HTMLAnchorElement;
  blobUrl?: string;
  timer: number;
  onHide: () => void;
};

const pendingAnchors: PendingAnchor[] = [];

function cleanupPending(entry: PendingAnchor) {
  window.clearTimeout(entry.timer);
  window.removeEventListener("pagehide", entry.onHide);
  if (entry.blobUrl) {
    try {
      URL.revokeObjectURL(entry.blobUrl);
    } catch {
      /* ignore */
    }
  }
  try {
    entry.anchor.remove();
  } catch {
    /* ignore */
  }
  const idx = pendingAnchors.indexOf(entry);
  if (idx >= 0) pendingAnchors.splice(idx, 1);
}

function keepAnchorAlive(anchor: HTMLAnchorElement, blobUrl?: string) {
  const entry: PendingAnchor = {
    anchor,
    blobUrl,
    timer: 0,
    onHide: () => undefined,
  };
  entry.onHide = () => cleanupPending(entry);
  entry.timer = window.setTimeout(
    () => cleanupPending(entry),
    MP_LABEL_BLOB_URL_KEEPALIVE_MS
  );
  window.addEventListener("pagehide", entry.onHide);
  pendingAnchors.push(entry);
}

function getOrCreateDownloadIframe(): HTMLIFrameElement {
  const existing = document.querySelector<HTMLIFrameElement>(
    'iframe[data-mp-label-download="1"]'
  );
  if (existing) return existing;
  const iframe = document.createElement("iframe");
  iframe.setAttribute("data-mp-label-download", "1");
  iframe.setAttribute("aria-hidden", "true");
  iframe.tabIndex = -1;
  iframe.style.cssText =
    "position:fixed;width:0;height:0;border:0;opacity:0;pointer-events:none;left:0;top:0;";
  document.body.appendChild(iframe);
  return iframe;
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

export function isIosDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (/iPad|iPhone|iPod/i.test(ua)) return true;
  return navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
}

export async function prepareMpAprobadoLabelTicket(
  data: MpAprobadoLabelData
): Promise<MpLabelPreparedTicket> {
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
    expiresAt?: number;
  };
  if (!res.ok || !json.downloadUrl) {
    throw new Error(json.error ?? `No se pudo preparar la descarga (${res.status})`);
  }
  return {
    downloadUrl: json.downloadUrl,
    filename: json.filename || mpAprobadoLabelFilename(data),
    expiresAt: typeof json.expiresAt === "number" ? json.expiresAt : Date.now() + 60_000,
  };
}

function ticketStillValid(
  ticket: MpLabelPreparedTicket | null | undefined
): ticket is MpLabelPreparedTicket {
  if (!ticket?.downloadUrl) return false;
  return Date.now() < ticket.expiresAt - 5_000;
}

/**
 * iOS: descarga same-origin vía <a download> (+ iframe oculto si Safari ignora download).
 * Sin location.assign / location.href / window.open / target=_blank.
 */
export function startMpAprobadoLabelTicketDownload(
  ticket: MpLabelPreparedTicket
): MpLabelDownloadResult {
  const absoluteUrl = new URL(ticket.downloadUrl, window.location.origin).toString();
  const filename = ticket.filename.endsWith(".pdf")
    ? ticket.filename
    : `${ticket.filename}.pdf`;

  const a = document.createElement("a");
  a.href = absoluteUrl;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  // sin target — no abre pestaña ni navega el documento principal
  document.body.appendChild(a);
  a.click();
  keepAnchorAlive(a);

  // Fallback: iframe persistente con attachment
  const iframe = getOrCreateDownloadIframe();
  iframe.src = absoluteUrl;

  return { filename, mode: "ticket", toast: "Descarga iniciada" };
}

/** @deprecated alias — preferir startMpAprobadoLabelTicketDownload */
export const startMpAprobadoLabelTicketNavigation = startMpAprobadoLabelTicketDownload;

export async function downloadMpAprobadoLabelViaTicket(
  data: MpAprobadoLabelData,
  prepared?: MpLabelPreparedTicket | null
): Promise<MpLabelDownloadResult> {
  const ticket = ticketStillValid(prepared)
    ? prepared
    : await prepareMpAprobadoLabelTicket(data);
  return startMpAprobadoLabelTicketDownload(ticket);
}

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

  const blob = new Blob([bytes], { type: MP_APROBADO_LABEL_MIME });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = resolvedName.endsWith(".pdf") ? resolvedName : `${resolvedName}.pdf`;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  keepAnchorAlive(a, url);

  return { filename: a.download, mode: "blob", toast: "Descarga iniciada" };
}

export async function downloadMpAprobadoLabelFromApi(
  data: MpAprobadoLabelData,
  preparedTicket?: MpLabelPreparedTicket | null
): Promise<MpLabelDownloadResult> {
  if (isIosDevice()) {
    return downloadMpAprobadoLabelViaTicket(data, preparedTicket);
  }
  return downloadMpAprobadoLabelViaBlob(data);
}

export function openHereLabelOfficialPage(): void {
  window.open(HERELABEL_OFFICIAL_STORE_URL, "_blank", "noopener,noreferrer");
}
