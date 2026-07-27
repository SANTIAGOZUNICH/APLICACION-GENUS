import { NextResponse } from "next/server";
import { getProcedimientosService } from "@/lib/procedimientos/procedimientos-service";
import { canAccessProcedimientos } from "@/lib/procedimientos/types";
import type { VersionUploadMode } from "@/lib/procedimientos/types";
import {
  isProcedureMetricsSchemaReady,
  procedureMetricsSchemaPendingResponse,
  ProcedureMetricsSchemaPendingError,
} from "@/lib/db/procedure-metrics-schema";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { ordersErrorResponse } from "@/lib/orders/http";
import { OrdersForbiddenError } from "@/lib/orders/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(err: unknown) {
  if (err instanceof ProcedureMetricsSchemaPendingError) {
    return NextResponse.json(procedureMetricsSchemaPendingResponse(), { status: 503 });
  }
  return ordersErrorResponse(err);
}

export async function GET(request: Request) {
  try {
    const actor = resolveOrdersActor(request);
    if (!canAccessProcedimientos(actor.sector)) {
      throw new OrdersForbiddenError("Sin acceso a Procedimientos.");
    }
    const url = new URL(request.url);
    const q = url.searchParams.get("q");
    const parentId = url.searchParams.get("parentId");
    const mimeFilter = url.searchParams.get("mimeFilter") ?? undefined;
    const includeArchived = url.searchParams.get("includeArchived") === "1";
    const persistenceReady = await isProcedureMetricsSchemaReady();
    const svc = getProcedimientosService();
    const a = { email: actor.email, sector: actor.sector };

    const data = q
      ? await svc.search(a, q, mimeFilter)
      : await svc.list(a, parentId, { q: q ?? undefined, mimeFilter, includeArchived });

    return NextResponse.json({
      ...data,
      persistenceReady,
      schemaPending: !persistenceReady,
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const actor = resolveOrdersActor(request);
    if (!canAccessProcedimientos(actor.sector)) {
      throw new OrdersForbiddenError("Sin acceso a Procedimientos.");
    }
    const contentType = request.headers.get("content-type") ?? "";
    const svc = getProcedimientosService();
    const a = { email: actor.email, sector: actor.sector };

    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const action = String(form.get("action") ?? "upload");
      if (action === "upload") {
        const folderId = String(form.get("folderId") ?? "");
        const file = form.get("file");
        if (!(file instanceof File)) {
          return NextResponse.json({ error: "file requerido" }, { status: 400 });
        }
        const buf = Buffer.from(await file.arrayBuffer());
        const record = await svc.upload(a, {
          folderId,
          fileName: file.name,
          mimeType: file.type || "application/octet-stream",
          bytes: buf,
          relativePath: form.get("relativePath") ? String(form.get("relativePath")) : undefined,
          mode: form.get("mode") ? (String(form.get("mode")) as VersionUploadMode) : undefined,
          existingFileId: form.get("existingFileId") ? String(form.get("existingFileId")) : undefined,
          changeReason: form.get("changeReason") ? String(form.get("changeReason")) : undefined,
        });
        return NextResponse.json({ file: record }, { status: 201 });
      }
      return NextResponse.json({ error: "action desconocida" }, { status: 400 });
    }

    const body = (await request.json()) as {
      action?: string;
      name?: string;
      parentId?: string | null;
      folderId?: string;
      fileId?: string;
      displayName?: string;
      segments?: unknown[];
      path?: string;
    };

    if (body.action === "mkdir") {
      const folder = await svc.createFolder(a, String(body.name ?? ""), body.parentId ?? null);
      return NextResponse.json({ folder }, { status: 201 });
    }
    if (body.action === "ensure_path") {
      const segments = Array.isArray(body.segments)
        ? body.segments.map((s: unknown) => String(s))
        : String(body.path ?? "")
            .replace(/\\/g, "/")
            .split("/")
            .filter(Boolean);
      const folder = await svc.ensureFolderPath(a, body.parentId ?? null, segments);
      return NextResponse.json({ folder }, { status: folder ? 200 : 200 });
    }
    if (body.action === "rename_folder") {
      const folder = await svc.renameFolder(a, String(body.folderId ?? ""), String(body.name ?? ""));
      return NextResponse.json({ folder });
    }
    if (body.action === "rename_file") {
      const file = await svc.renameFile(a, String(body.fileId ?? ""), String(body.displayName ?? ""));
      return NextResponse.json({ file });
    }
    if (body.action === "archive_folder") {
      await svc.archiveFolder(a, String(body.folderId ?? ""));
      return NextResponse.json({ ok: true });
    }
    if (body.action === "restore_folder") {
      await svc.restoreFolder(a, String(body.folderId ?? ""));
      return NextResponse.json({ ok: true });
    }
    if (body.action === "delete_folder") {
      await svc.deleteFolder(a, String(body.folderId ?? ""));
      return NextResponse.json({ ok: true });
    }
    if (body.action === "archive_file") {
      await svc.archiveFile(a, String(body.fileId ?? ""));
      return NextResponse.json({ ok: true });
    }
    if (body.action === "restore_file") {
      await svc.restoreFile(a, String(body.fileId ?? ""));
      return NextResponse.json({ ok: true });
    }
    if (body.action === "delete_file") {
      await svc.deleteFile(a, String(body.fileId ?? ""));
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "action desconocida" }, { status: 400 });
  } catch (err) {
    return errorResponse(err);
  }
}
