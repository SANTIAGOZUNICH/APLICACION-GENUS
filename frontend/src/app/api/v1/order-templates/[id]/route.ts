import { NextResponse } from "next/server";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { getOrdersService } from "@/lib/orders/get-orders-service";
import { ensureOrdersPersistenceReady, ordersErrorResponse } from "@/lib/orders/http";
import type { OrderContent } from "@/lib/orders/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Ctx) {
  const blocked = ensureOrdersPersistenceReady();
  if (blocked) return blocked;
  try {
    resolveOrdersActor(request);
    const { id } = await ctx.params;
    const url = new URL(request.url);
    const history = url.searchParams.get("history") === "1";
    const service = getOrdersService();
    const template = await service.getTemplate(id);
    if (history) {
      const versions = await service.listTemplateHistory(template.productId, template.type);
      return NextResponse.json({ template, versions, legallyOperational: true });
    }
    return NextResponse.json({ template, legallyOperational: true });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}

export async function PATCH(request: Request, ctx: Ctx) {
  const blocked = ensureOrdersPersistenceReady();
  if (blocked) return blocked;
  try {
    const actor = resolveOrdersActor(request);
    const { id } = await ctx.params;
    const body = (await request.json()) as {
      content?: OrderContent;
      productName?: string;
      productCode?: string;
      brandClient?: string | null;
      changeReason?: string;
    };
    const template = await getOrdersService().updateTemplate(id, actor, body);
    return NextResponse.json({ template, legallyOperational: true });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}

export async function POST(request: Request, ctx: Ctx) {
  const blocked = ensureOrdersPersistenceReady();
  if (blocked) return blocked;
  try {
    const actor = resolveOrdersActor(request);
    const { id } = await ctx.params;
    const body = (await request.json()) as {
      action: "duplicate" | "new_version" | "obsolete";
      productName?: string;
      productCode?: string;
      brandClient?: string | null;
      changeReason?: string;
      content?: OrderContent;
    };
    const service = getOrdersService();
    if (body.action === "duplicate") {
      const template = await service.duplicateTemplate(
        {
          templateId: id,
          productName: body.productName,
          productCode: body.productCode,
          brandClient: body.brandClient,
          changeReason: body.changeReason,
        },
        actor
      );
      return NextResponse.json({ template, legallyOperational: true }, { status: 201 });
    }
    if (body.action === "new_version") {
      const template = await service.createTemplateVersion(
        id,
        actor,
        body.changeReason ?? "",
        body.content
      );
      return NextResponse.json({ template, legallyOperational: true }, { status: 201 });
    }
    if (body.action === "obsolete") {
      const template = await service.markTemplateObsoleteManaged(id, actor);
      return NextResponse.json({ template, legallyOperational: true });
    }
    return NextResponse.json({ error: "Acción no reconocida." }, { status: 400 });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}
