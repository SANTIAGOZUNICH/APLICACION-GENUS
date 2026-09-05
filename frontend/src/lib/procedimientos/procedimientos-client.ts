import {
  ACTOR_EMAIL_HEADER,
  ACTOR_SECTOR_HEADER,
} from "@/lib/auth/header-names";
import type { OrdersClientSession } from "@/lib/orders/orders-client";
import type {
  ProcedureFileRecord,
  ProcedureFolderRecord,
  ProcedureListFilters,
  ProcedureVersionRecord,
  VersionUploadMode,
} from "./types";

function jsonHeaders(session: OrdersClientSession): HeadersInit {
  return {
    "Content-Type": "application/json",
    [ACTOR_EMAIL_HEADER]: session.email,
    [ACTOR_SECTOR_HEADER]: session.sector,
  };
}

function actorHeaders(session: OrdersClientSession): HeadersInit {
  return {
    [ACTOR_EMAIL_HEADER]: session.email,
    [ACTOR_SECTOR_HEADER]: session.sector,
  };
}

export async function fetchProcedimientosApi(
  session: OrdersClientSession,
  parentId: string | null,
  filters: ProcedureListFilters = {}
): Promise<{
  folders: ProcedureFolderRecord[];
  files: ProcedureFileRecord[];
  schemaPending: boolean;
}> {
  const qs = new URLSearchParams();
  if (parentId) qs.set("parentId", parentId);
  if (filters.q) qs.set("q", filters.q);
  if (filters.mimeFilter) qs.set("mimeFilter", filters.mimeFilter);
  if (filters.includeArchived) qs.set("includeArchived", "1");
  const res = await fetch(`/api/v1/procedimientos?${qs}`, {
    credentials: "include",
    headers: jsonHeaders(session),
  });
  const body = (await res.json()) as {
    folders?: ProcedureFolderRecord[];
    files?: ProcedureFileRecord[];
    error?: string;
    schemaPending?: boolean;
  };
  if (!res.ok) throw new Error(body.error ?? "Error al cargar procedimientos");
  return {
    folders: body.folders ?? [],
    files: body.files ?? [],
    schemaPending: Boolean(body.schemaPending),
  };
}

export async function searchProcedimientosApi(
  session: OrdersClientSession,
  q: string,
  mimeFilter?: string
): Promise<{ folders: ProcedureFolderRecord[]; files: ProcedureFileRecord[]; schemaPending: boolean }> {
  const qs = new URLSearchParams({ q });
  if (mimeFilter) qs.set("mimeFilter", mimeFilter);
  const res = await fetch(`/api/v1/procedimientos?${qs}`, {
    credentials: "include",
    headers: jsonHeaders(session),
  });
  const body = (await res.json()) as {
    folders?: ProcedureFolderRecord[];
    files?: ProcedureFileRecord[];
    schemaPending?: boolean;
    error?: string;
  };
  if (!res.ok) throw new Error(body.error ?? "Error en búsqueda");
  return {
    folders: body.folders ?? [],
    files: body.files ?? [],
    schemaPending: Boolean(body.schemaPending),
  };
}

export async function procedimientosActionApi(
  session: OrdersClientSession,
  action: string,
  payload: Record<string, unknown> = {}
): Promise<unknown> {
  const res = await fetch("/api/v1/procedimientos", {
    method: "POST",
    credentials: "include",
    headers: jsonHeaders(session),
    body: JSON.stringify({ action, ...payload }),
  });
  const body = (await res.json()) as { error?: string; schemaPending?: boolean };
  if (!res.ok) throw new Error(body.error ?? "Acción fallida");
  return body;
}

/**
 * Por encima de esto, el archivo va directo cliente→Blob (bypassa el
 * límite de payload de las funciones serverless de Vercel, ~4.5MB, que corta
 * el upload ANTES de que nuestro código corra — confirmado en Production con
 * FUNCTION_PAYLOAD_TOO_LARGE al subir 6MB por el camino multipart de
 * siempre). Margen de seguridad bajo 4.5MB para el overhead de
 * multipart/form-data + headers.
 */
const DIRECT_BLOB_UPLOAD_THRESHOLD_BYTES = 4 * 1024 * 1024;

async function uploadProcedimientoFileDirectToBlob(
  session: OrdersClientSession,
  params: {
    folderId: string;
    file: File;
    relativePath?: string;
    mode?: VersionUploadMode;
    existingFileId?: string;
    changeReason?: string;
  }
): Promise<{ file: ProcedureFileRecord; schemaPending?: boolean }> {
  const { put } = await import("@vercel/blob/client");

  const tokenRes = await fetch("/api/v1/procedimientos/blob-upload-token", {
    method: "POST",
    credentials: "include",
    headers: jsonHeaders(session),
    body: JSON.stringify({
      folderId: params.folderId,
      fileName: params.file.name,
      mimeType: params.file.type || "application/octet-stream",
      sizeBytes: params.file.size,
      mode: params.mode,
      existingFileId: params.existingFileId,
    }),
  });
  const tokenBody = (await tokenRes.json()) as {
    fileId?: string;
    version?: number;
    storageKey?: string;
    token?: string;
    error?: string;
  };
  if (!tokenRes.ok || !tokenBody.token || !tokenBody.storageKey) {
    throw new Error(tokenBody.error ?? "Error al preparar la subida");
  }

  const bytes = await params.file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const sha256 = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  await put(tokenBody.storageKey, params.file, {
    access: "private",
    token: tokenBody.token,
    contentType: params.file.type || "application/octet-stream",
  });

  const res = await fetch("/api/v1/procedimientos", {
    method: "POST",
    credentials: "include",
    headers: jsonHeaders(session),
    body: JSON.stringify({
      action: "complete_blob_upload",
      folderId: params.folderId,
      fileId: tokenBody.fileId,
      version: tokenBody.version,
      fileName: params.file.name,
      mimeType: params.file.type || "application/octet-stream",
      storageKey: tokenBody.storageKey,
      sizeBytes: params.file.size,
      sha256,
      relativePath: params.relativePath,
      mode: params.mode,
      existingFileId: params.existingFileId,
      changeReason: params.changeReason,
    }),
  });
  const body = (await res.json()) as {
    file?: ProcedureFileRecord;
    error?: string;
    schemaPending?: boolean;
  };
  if (!res.ok) throw new Error(body.error ?? "Error al subir archivo");
  return { file: body.file!, schemaPending: body.schemaPending };
}

export async function uploadProcedimientoFileApi(
  session: OrdersClientSession,
  params: {
    folderId: string;
    file: File;
    relativePath?: string;
    mode?: VersionUploadMode;
    existingFileId?: string;
    changeReason?: string;
  }
): Promise<{ file: ProcedureFileRecord; schemaPending?: boolean }> {
  if (params.file.size > DIRECT_BLOB_UPLOAD_THRESHOLD_BYTES) {
    return uploadProcedimientoFileDirectToBlob(session, params);
  }

  const form = new FormData();
  form.set("action", "upload");
  form.set("folderId", params.folderId);
  form.append("file", params.file);
  if (params.relativePath) form.set("relativePath", params.relativePath);
  if (params.mode) form.set("mode", params.mode);
  if (params.existingFileId) form.set("existingFileId", params.existingFileId);
  if (params.changeReason) form.set("changeReason", params.changeReason);

  const res = await fetch("/api/v1/procedimientos", {
    method: "POST",
    credentials: "include",
    headers: actorHeaders(session),
    body: form,
  });
  const body = (await res.json()) as {
    file?: ProcedureFileRecord;
    error?: string;
    schemaPending?: boolean;
  };
  if (!res.ok) throw new Error(body.error ?? "Error al subir archivo");
  return { file: body.file!, schemaPending: body.schemaPending };
}

export async function fetchProcedimientoVersionsApi(
  session: OrdersClientSession,
  fileId: string
): Promise<{ versions: ProcedureVersionRecord[]; file: ProcedureFileRecord | null; schemaPending: boolean }> {
  const res = await fetch(`/api/v1/procedimientos/${fileId}?versions=1`, {
    credentials: "include",
    headers: jsonHeaders(session),
  });
  const body = (await res.json()) as {
    versions?: ProcedureVersionRecord[];
    file?: ProcedureFileRecord;
    schemaPending?: boolean;
    error?: string;
  };
  if (!res.ok) throw new Error(body.error ?? "Error al cargar versiones");
  return {
    versions: body.versions ?? [],
    file: body.file ?? null,
    schemaPending: Boolean(body.schemaPending),
  };
}

export function procedimientoDownloadUrl(
  session: OrdersClientSession,
  fileId: string,
  version?: number,
  preview?: boolean
): string {
  const qs = new URLSearchParams({ fileId });
  if (version != null) qs.set("version", String(version));
  if (preview) qs.set("preview", "1");
  return `/api/v1/procedimientos/download?${qs}`;
}

export function procedimientoDownloadHeaders(session: OrdersClientSession): HeadersInit {
  return actorHeaders(session);
}
