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

/** Mantener Blob URL + <a> vivos (Safari pierde la ref si se revoca demasiado pronto). */
export const MP_LABEL_BLOB_URL_KEEPALIVE_MS = 120_000;

export type MpLabelDownloadResult = {
  filename: string;
  mode: "blob" | "ticket";
  /** Mensaje seguro: no afirma que el archivo quedó guardado. */
  toast: "Descarga iniciada";
};

export type MpLabelPreparedTicket = {
  downloadUrl: string;
  filename: string;
  expiresAt: number;
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
  return navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
}

/**
 * Prepara ticket firmado (llamar al abrir el modal en iOS).
 * Permite que el click de Descargar navegue en el mismo gesto del usuario.
 */
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

function ticketStillValid(ticket: MpLabelPreparedTicket | null | undefined): ticket is MpLabelPreparedTicket {
  if (!ticket?.downloadUrl) return false;
  // margen de 5s antes del vencimiento
  return Date.now() < ticket.expiresAt - 5_000;
}

/**
 * iOS: navega same-origin al GET del ticket (attachment PDF).
 * Debe llamarse desde el handler de click (gesto directo) si el ticket ya está listo.
 */
export function startMpAprobadoLabelTicketNavigation(
  ticket: MpLabelPreparedTicket
): MpLabelDownloadResult {
  const absoluteUrl = new URL(ticket.downloadUrl, window.location.origin).toString();
  const filename = ticket.filename.endsWith(".pdf")
    ? ticket.filename
    : `${ticket.filename}.pdf`;
  // Navegación same-origin: Safari usa el administrador nativo de descargas
  // gracias a Content-Disposition: attachment (no abre el visor).
  window.location.assign(absoluteUrl);
  return { filename, mode: "ticket", toast: "Descarga iniciada" };
}

/**
 * Descarga iOS: usa ticket prefetch si está vivo; si no, pide uno y navega.
 */
export async function downloadMpAprobadoLabelViaTicket(
  data: MpAprobadoLabelData,
  prepared?: MpLabelPreparedTicket | null
): Promise<MpLabelDownloadResult> {
  const ticket = ticketStillValid(prepared)
    ? prepared
    : await prepareMpAprobadoLabelTicket(data);
  return startMpAprobadoLabelTicketNavigation(ticket);
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

  const blob = new Blob([bytes], { type: MP_APROBADO_LABEL_MIME });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = resolvedName.endsWith(".pdf") ? resolvedName : `${resolvedName}.pdf`;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  keepBlobDownloadAlive(url, a);

  return { filename: a.download, mode: "blob", toast: "Descarga iniciada" };
}

/**
 * Descarga etiqueta:
 * - iOS → ticket firmado + location.assign (gesto; preferir ticket prefetch)
 * - resto → Blob PDF con keepalive 120s
 */
export async function downloadMpAprobadoLabelFromApi(
  data: MpAprobadoLabelData,
  preparedTicket?: MpLabelPreparedTicket | null
): Promise<MpLabelDownloadResult> {
  if (isIosDevice()) {
    return downloadMpAprobadoLabelViaTicket(data, preparedTicket);
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
