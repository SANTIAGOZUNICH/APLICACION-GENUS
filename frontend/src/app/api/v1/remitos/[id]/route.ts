import { NextResponse } from "next/server";
import { getRemitoService } from "@/lib/remitos/remito-service";
import { canAccessRemitos } from "@/lib/remitos/types";
import type {
  RemitoApprovalInput,
  RemitoDraftPatch,
  RemitoEditGeneratedOptions,
} from "@/lib/remitos/types";
import {
  isRemitoSchemaReady,
  RemitoSchemaPendingError,
  remitoSchemaPendingResponse,
} from "@/lib/db/remito-schema";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { ordersErrorResponse } from "@/lib/orders/http";
import { OrdersForbiddenError, OrdersNotFoundError } from "@/lib/orders/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function remitosError(err: unknown) {
  if (err instanceof RemitoSchemaPendingError) {
    return NextResponse.json(remitoSchemaPendingResponse(), { status: 503 });
  }
  return ordersErrorResponse(err);
}

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Ctx) {
  try {
    const actor = resolveOrdersActor(request);
    if (!canAccessRemitos(actor.sector)) {
      throw new OrdersForbiddenError("Solo PRODUCCIÓN puede acceder a Remitos.");
    }
    const { id } = await ctx.params;
    const persistenceReady = await isRemitoSchemaReady();
    const remito = await getRemitoService().get(
      { email: actor.email, sector: actor.sector },
      id
    );
    if (!remito) throw new OrdersNotFoundError("Remito no encontrado.");
    return NextResponse.json({
      remito,
      persistenceReady,
      schemaPending: !persistenceReady,
    });
  } catch (err) {
    return remitosError(err);
  }
}

export async function PATCH(request: Request, ctx: Ctx) {
  try {
    const actor = resolveOrdersActor(request);
    if (!canAccessRemitos(actor.sector)) {
      throw new OrdersForbiddenError("Solo PRODUCCIÓN puede acceder a Remitos.");
    }
    const { id } = await ctx.params;
    const body = (await request.json()) as {
      action?: string;
      extraLines?: RemitoApprovalInput[];
      patch?: RemitoDraftPatch;
      displayName?: string;
      filename?: string;
      motivo?: string;
    } & Partial<RemitoEditGeneratedOptions>;
    const svc = getRemitoService();
    const a = { email: actor.email, sector: actor.sector };

    if (body.action === "generate") {
      return NextResponse.json({
        remito: await svc.generate(a, id, {
          displayName: String(body.displayName ?? ""),
          filename: body.filename,
        }),
      });
    }
    if (body.action === "update_draft") {
      return NextResponse.json({
        remito: await svc.updateDraft(a, id, body.patch ?? {}),
      });
    }
    if (body.action === "rename") {
      return NextResponse.json({
        remito: await svc.renameDisplayName(a, id, String(body.displayName ?? "")),
      });
    }
    if (body.action === "edit_generated") {
      return NextResponse.json({
        remito: await svc.editGenerated(a, id, {
          motivo: String(body.motivo ?? ""),
          displayName: body.displayName,
          clientDisplay: body.clientDisplay,
          deliveryDate: body.deliveryDate,
          lines: body.lines,
          filename: body.filename,
        }),
      });
    }
    if (body.action === "list_versions") {
      const versions = await svc.listVersions(a, id);
      return NextResponse.json({ versions });
    }
    if (body.action === "new_version") {
      return NextResponse.json(
        { remito: await svc.newVersion(a, id, body.extraLines ?? []) },
        { status: 201 }
      );
    }
    if (body.action === "annul") {
      return NextResponse.json({
        remito: await svc.annul(
          a,
          id,
          typeof body.motivo === "string" ? body.motivo : undefined
        ),
      });
    }
    if (body.action === "archive") {
      return NextResponse.json({ remito: await svc.archive(a, id) });
    }
    if (body.action === "restore") {
      return NextResponse.json({ remito: await svc.restore(a, id) });
    }
    if (body.action === "delete_draft") {
      await svc.deleteDraft(a, id);
      return NextResponse.json({ deleted: true, id });
    }
    return NextResponse.json({ error: "action inválida" }, { status: 400 });
  } catch (err) {
    return remitosError(err);
  }
}

export async function DELETE(request: Request, ctx: Ctx) {
  try {
    const actor = resolveOrdersActor(request);
    if (!canAccessRemitos(actor.sector)) {
      throw new OrdersForbiddenError("Solo PRODUCCIÓN puede acceder a Remitos.");
    }
    const { id } = await ctx.params;
    await getRemitoService().deleteDraft(
      { email: actor.email, sector: actor.sector },
      id
    );
    return NextResponse.json({ deleted: true, id });
  } catch (err) {
    return remitosError(err);
  }
}
