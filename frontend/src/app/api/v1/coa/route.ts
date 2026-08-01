import { NextResponse } from "next/server";
import { getCoaService } from "@/lib/coa/coa-service";
import { isFeatureSchemaReady } from "@/lib/db/feature-schema";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { ordersErrorResponse } from "@/lib/orders/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor = await resolveOrdersActor(request);
    const url = new URL(request.url);
    const parentId = url.searchParams.get("parentId");
    const fileId = url.searchParams.get("fileId");
    const includeArchived = url.searchParams.get("includeArchived") === "true";
    const persistenceReady = await isFeatureSchemaReady();
    const svc = getCoaService();
    const a = { email: actor.email, sector: actor.sector };

    if (fileId) {
      const versions = await svc.listVersions(a, fileId);
      const file = await svc.getFile(fileId, { includeArchived: true });
      return NextResponse.json({
        file,
        versions,
        persistenceReady,
        schemaPending: !persistenceReady,
      });
    }

    const data = await svc.list(a, parentId, { includeArchived });
    return NextResponse.json({
      ...data,
      persistenceReady,
      schemaPending: !persistenceReady,
    });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await resolveOrdersActor(request);
    const contentType = request.headers.get("content-type") ?? "";
    const svc = getCoaService();
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
        const replaceFileId = form.get("replaceFileId");
        const record = await svc.upload(a, {
          folderId,
          fileName: file.name,
          mimeType: file.type || "application/octet-stream",
          bytes: buf,
          replaceFileId: replaceFileId ? String(replaceFileId) : undefined,
        });
        return NextResponse.json({ file: record }, { status: 201 });
      }
    }

    const body = (await request.json()) as {
      action?: string;
      name?: string;
      parentId?: string | null;
      folderId?: string;
      fileId?: string;
      version?: number;
      reason?: string;
    };
    if (body.action === "mkdir") {
      const folder = await svc.createFolder(
        a,
        String(body.name ?? ""),
        body.parentId ?? null
      );
      return NextResponse.json({ folder }, { status: 201 });
    }
    if (body.action === "rename_folder") {
      const folder = await svc.renameFolder(
        a,
        String(body.folderId ?? ""),
        String(body.name ?? "")
      );
      return NextResponse.json({ folder });
    }
    if (body.action === "archive_folder") {
      await svc.archiveFolder(a, String(body.folderId ?? ""));
      return NextResponse.json({ ok: true });
    }
    if (body.action === "delete_folder") {
      await svc.hardDeleteFolder(a, String(body.folderId ?? ""));
      return NextResponse.json({ ok: true });
    }
    if (body.action === "restore_folder") {
      const folder = await svc.restoreFolder(a, String(body.folderId ?? ""));
      return NextResponse.json({ folder });
    }
    if (body.action === "archive_file") {
      await svc.softArchiveFile(
        a,
        String(body.fileId ?? ""),
        body.reason
      );
      return NextResponse.json({ ok: true });
    }
    if (body.action === "delete_file") {
      const result = await svc.hardDeleteFile(
        a,
        String(body.fileId ?? ""),
        body.reason
      );
      return NextResponse.json(result);
    }
    if (body.action === "restore_file") {
      const file = await svc.restoreFile(a, String(body.fileId ?? ""));
      return NextResponse.json({ file });
    }
    if (body.action === "delete_version") {
      const version = Number(body.version);
      if (!Number.isFinite(version) || version < 1) {
        return NextResponse.json({ error: "version inválida" }, { status: 400 });
      }
      const result = await svc.deleteVersion(
        a,
        String(body.fileId ?? ""),
        version,
        body.reason
      );
      return NextResponse.json(result);
    }
    return NextResponse.json({ error: "action inválida" }, { status: 400 });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}
