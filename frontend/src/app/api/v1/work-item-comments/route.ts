import { NextResponse } from "next/server";
import { resolveAuthenticatedActor } from "@/lib/auth/resolve-authenticated-actor";
import { authErrorResponse } from "@/lib/auth/http";
import { isDatabaseConfigured } from "@/lib/db/client";
import { isMissingSchemaError } from "@/lib/db/missing-schema";
import {
  CommentForbiddenError,
  CommentNotFoundError,
  CommentValidationError,
  listWorkItemComments,
  postWorkItemComment,
} from "@/lib/work-item-comments/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function failure(err: unknown) {
  if (err instanceof CommentForbiddenError) return NextResponse.json({ error: err.message, code: "COMMENT_FORBIDDEN" }, { status: 403 });
  if (err instanceof CommentNotFoundError) return NextResponse.json({ error: err.message, code: "COMMENT_WORK_ITEM_NOT_FOUND" }, { status: 404 });
  if (err instanceof CommentValidationError) return NextResponse.json({ error: err.message, code: "COMMENT_INVALID" }, { status: 400 });
  if (isMissingSchemaError(err)) return NextResponse.json({ error: "Los comentarios todavía no están disponibles (migración pendiente).", code: "COMMENT_SCHEMA_PENDING" }, { status: 503 });
  return null;
}

const NO_DB = () => NextResponse.json({ error: "Base de datos no disponible.", code: "DATABASE_REQUIRED" }, { status: 503 });

/** GET /api/v1/work-item-comments?workItemId=… — comentarios del trabajo (sectores que consultan la Vista mensual). */
export async function GET(request: Request) {
  try {
    const actor = await resolveAuthenticatedActor(request);
    if (!isDatabaseConfigured()) return NO_DB();
    const workItemId = new URL(request.url).searchParams.get("workItemId") ?? "";
    const comments = await listWorkItemComments(actor, workItemId);
    return NextResponse.json({ workItemId, comments, fetchedAt: new Date().toISOString() });
  } catch (err) {
    return failure(err) ?? authErrorResponse(err);
  }
}

/**
 * POST /api/v1/work-item-comments — publica un comentario. Autor y sector SIEMPRE de la sesión (cualquier `author*` del cuerpo se ignora).
 * Esta ruta solo inserta en work_item_comments: no puede editar ni asignar ni reprogramar el trabajo.
 */
export async function POST(request: Request) {
  try {
    const actor = await resolveAuthenticatedActor(request);
    if (!isDatabaseConfigured()) return NO_DB();
    const raw = (await request.json().catch(() => null)) as { workItemId?: unknown; body?: unknown; clientRequestId?: unknown } | null;
    const result = await postWorkItemComment(actor, {
      workItemId: typeof raw?.workItemId === "string" ? raw.workItemId : "",
      body: raw?.body,
      clientRequestId: raw?.clientRequestId,
    });
    return NextResponse.json(result, { status: result.created ? 201 : 200 });
  } catch (err) {
    return failure(err) ?? authErrorResponse(err);
  }
}
