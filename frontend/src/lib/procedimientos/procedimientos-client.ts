import {
  ACTOR_EMAIL_HEADER,
  ACTOR_SECTOR_HEADER,
} from "@/lib/orders/actor";
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
    headers: jsonHeaders(session),
    body: JSON.stringify({ action, ...payload }),
  });
  const body = (await res.json()) as { error?: string; schemaPending?: boolean };
  if (!res.ok) throw new Error(body.error ?? "Acción fallida");
  return body;
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
