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
} from "@/lib/auth/header-names";

/** Mantener Blob URL + <a> vivos en desktop. */
export const MP_LABEL_BLOB_URL_KEEPALIVE_MS = 120_000;

export type MpLabelDownloadResult = {
  filename: string;
  mode: "blob" | "share";
  /** Mensaje seguro: no afirma que el archivo quedó guardado. */
  toast: "Descarga iniciada" | "Hoja de compartir abierta";
};

export type MpLabelPreparedFile = {
  file: File;
  filename: string;
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

function labelRequestBody(data: MpAprobadoLabelData) {
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
  };
}

export function isIosDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (/iPad|iPhone|iPod/i.test(ua)) return true;
  return navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
}

export function canUseWebShareFiles(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.share === "function" &&
    typeof navigator.canShare === "function"
  );
}

/**
 * Fetch autenticado del PDF (POST bytes). No navega.
 */
export async function fetchMpAprobadoLabelPdfFile(
  data: MpAprobadoLabelData
): Promise<MpLabelPreparedFile> {
  const filename = mpAprobadoLabelFilename(data);
  const res = await fetch(MP_APROBADO_LABEL_DOWNLOAD_PATH, {
    method: "POST",
    credentials: "include",
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
  const resolvedName = rawName
    ? decodeURIComponent(rawName)
    : filename.endsWith(".pdf")
      ? filename
      : `${filename}.pdf`;

  const file = new File([bytes], resolvedName, { type: MP_APROBADO_LABEL_MIME });
  return { file, filename: resolvedName };
}

/**
 * iPhone/iPad: hoja nativa Share Sheet sobre Genus OS.
 * Debe ejecutarse en el gesto del usuario con File ya preparado (sin fetch largo).
 */
export async function shareMpAprobadoLabelFile(
  prepared: MpLabelPreparedFile
): Promise<MpLabelDownloadResult> {
  const { file, filename } = prepared;
  if (!canUseWebShareFiles()) {
    throw new Error("Este dispositivo no soporta compartir archivos.");
  }
  const shareData: ShareData = { files: [file], title: filename };
  if (!navigator.canShare(shareData)) {
    throw new Error("No se puede compartir este PDF desde Safari.");
  }
  await navigator.share(shareData);
  return { filename, mode: "share", toast: "Hoja de compartir abierta" };
}

/**
 * Desktop / Android compatible: <a download> con Blob.
 * Sin location.assign, iframe, window.open ni pestaña nueva.
 */
export async function downloadMpAprobadoLabelViaBlob(
  data: MpAprobadoLabelData,
  prepared?: MpLabelPreparedFile | null
): Promise<MpLabelDownloadResult> {
  const ready =
    prepared ?? (await fetchMpAprobadoLabelPdfFile(data));
  const { file, filename } = ready;
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  keepAnchorAlive(a, url);
  return { filename, mode: "blob", toast: "Descarga iniciada" };
}

/**
 * Acción principal según plataforma.
 * iOS requiere `prepared` listo (prefetch al abrir modal).
 */
export async function saveOrDownloadMpAprobadoLabel(
  data: MpAprobadoLabelData,
  prepared?: MpLabelPreparedFile | null
): Promise<MpLabelDownloadResult> {
  if (isIosDevice()) {
    if (!prepared?.file) {
      throw new Error("La etiqueta aún se está preparando.");
    }
    return shareMpAprobadoLabelFile(prepared);
  }
  return downloadMpAprobadoLabelViaBlob(data, prepared);
}

/** AquíLabel App Store — acción separada (no es la descarga). */
export function openHereLabelOfficialPage(): void {
  window.open(HERELABEL_OFFICIAL_STORE_URL, "_blank", "noopener,noreferrer");
}
