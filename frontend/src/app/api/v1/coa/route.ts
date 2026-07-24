import { NextResponse } from "next/server";
import { getCoaService } from "@/lib/coa/coa-service";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { ordersErrorResponse } from "@/lib/orders/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor = resolveOrdersActor(request);
    const url = new URL(request.url);
    const parentId = url.searchParams.get("parentId");
    const data = await getCoaService().list(
      { email: actor.email, sector: actor.sector },
      parentId
    );
    return NextResponse.json(data);
  } catch (err) {
    return ordersErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const actor = resolveOrdersActor(request);
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
    };
    if (body.action === "mkdir") {
      const folder = await svc.createFolder(
        a,
        String(body.name ?? ""),
        body.parentId ?? null
      );
      return NextResponse.json({ folder }, { status: 201 });
    }
    return NextResponse.json({ error: "action inválida" }, { status: 400 });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}
