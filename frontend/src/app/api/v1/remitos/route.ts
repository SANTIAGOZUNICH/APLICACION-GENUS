import { NextResponse } from "next/server";
import { getRemitoService } from "@/lib/remitos/remito-service";
import type {
  RemitoApprovalInput,
  RemitoDraftPatch,
  RemitoEditGeneratedOptions,
  RemitoListFilters,
  RemitoStatus,
  RemitoTab,
} from "@/lib/remitos/types";
import { canAccessRemitos } from "@/lib/remitos/types";
import { isRemitoSchemaReady, remitoSchemaPendingResponse } from "@/lib/db/remito-schema";
import { RemitoSchemaPendingError } from "@/lib/db/remito-schema";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { ordersErrorResponse } from "@/lib/orders/http";
import { OrdersForbiddenError, OrdersValidationError } from "@/lib/orders/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function remitosError(err: unknown) {
  if (err instanceof RemitoSchemaPendingError) {
    return NextResponse.json(remitoSchemaPendingResponse(), { status: 503 });
  }
  return ordersErrorResponse(err);
}

export async function GET(request: Request) {
  try {
    const actor = resolveOrdersActor(request);
    if (!canAccessRemitos(actor.sector)) {
      throw new OrdersForbiddenError("Solo PRODUCCIÓN puede acceder a Remitos.");
    }
    const url = new URL(request.url);
    const filters: RemitoListFilters = {
      tab: (url.searchParams.get("tab") as RemitoTab) || undefined,
      q: url.searchParams.get("q") ?? "",
      clientId: url.searchParams.get("clientId") ?? undefined,
      deliveryDate: url.searchParams.get("deliveryDate") ?? undefined,
      status: (url.searchParams.get("status") as RemitoStatus) || undefined,
    };
    const persistenceReady = await isRemitoSchemaReady();
    const remitos = await getRemitoService().list(
      { email: actor.email, sector: actor.sector },
      filters
    );
    return NextResponse.json({
      remitos,
      persistenceReady,
      schemaPending: !persistenceReady,
    });
  } catch (err) {
    return remitosError(err);
  }
}

export async function POST(request: Request) {
  try {
    const actor = resolveOrdersActor(request);
    if (!canAccessRemitos(actor.sector)) {
      throw new OrdersForbiddenError("Solo PRODUCCIÓN puede acceder a Remitos.");
    }
    const body = (await request.json()) as {
      action?: string;
      remitoId?: string;
      workItemId?: string;
      input?: RemitoApprovalInput;
      extraLines?: RemitoApprovalInput[];
      patch?: RemitoDraftPatch;
      displayName?: string;
      filename?: string;
      motivo?: string;
    } & Partial<RemitoEditGeneratedOptions>;
    const svc = getRemitoService();
    const a = { email: actor.email, sector: actor.sector };

    if (body.action === "status_for_work") {
      const workItemId = String(body.workItemId ?? "").trim();
      if (!workItemId) throw new OrdersValidationError("workItemId obligatorio.");
      const status = await svc.statusForWorkItem(a, workItemId);
      return NextResponse.json(status);
    }
    if (body.action === "upsert_draft" && body.input) {
      const result = await svc.upsertDraftFromApproval(a, body.input);
      return NextResponse.json(result, { status: result.created ? 201 : 200 });
    }
    if (body.action === "update_draft" && body.remitoId) {
      const remito = await svc.updateDraft(a, body.remitoId, body.patch ?? {});
      return NextResponse.json({ remito });
    }
    if (body.action === "generate" && body.remitoId) {
      const remito = await svc.generate(a, body.remitoId, {
        displayName: String(body.displayName ?? ""),
        filename: body.filename,
      });
      return NextResponse.json({ remito });
    }
    if (body.action === "rename" && body.remitoId) {
      const remito = await svc.renameDisplayName(
        a,
        body.remitoId,
        String(body.displayName ?? "")
      );
      return NextResponse.json({ remito });
    }
    if (body.action === "edit_generated" && body.remitoId) {
      const remito = await svc.editGenerated(a, body.remitoId, {
        motivo: String(body.motivo ?? ""),
        displayName: body.displayName,
        clientDisplay: body.clientDisplay,
        deliveryDate: body.deliveryDate,
        lines: body.lines,
        filename: body.filename,
      });
      return NextResponse.json({ remito });
    }
    if (body.action === "new_version" && body.remitoId) {
      const remito = await svc.newVersion(a, body.remitoId, body.extraLines ?? []);
      return NextResponse.json({ remito }, { status: 201 });
    }
    if (body.action === "annul" && body.remitoId) {
      const remito = await svc.annul(a, body.remitoId);
      return NextResponse.json({ remito });
    }
    if (body.action === "archive" && body.remitoId) {
      const remito = await svc.archive(a, body.remitoId);
      return NextResponse.json({ remito });
    }
    return NextResponse.json({ error: "action inválida" }, { status: 400 });
  } catch (err) {
    return remitosError(err);
  }
}
