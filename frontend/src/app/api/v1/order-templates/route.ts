import { NextResponse } from "next/server";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { getOrdersService } from "@/lib/orders/get-orders-service";
import { ensureOrdersPersistenceReady, ordersErrorResponse } from "@/lib/orders/http";
import type { CreateTemplateInput, OrderDocType } from "@/lib/orders/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const blocked = ensureOrdersPersistenceReady();
  if (blocked) return blocked;
  try {
    resolveOrdersActor(request);
    const url = new URL(request.url);
    const type = url.searchParams.get("type") as OrderDocType | null;
    const all = url.searchParams.get("all") === "1";
    const service = getOrdersService();
    const templates = all
      ? await service.listAllTemplates(type ?? undefined)
      : await service.listTemplates(type ?? undefined);
    return NextResponse.json({ templates, legallyOperational: true });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}

export async function POST(request: Request) {
  const blocked = ensureOrdersPersistenceReady();
  if (blocked) return blocked;
  try {
    const actor = resolveOrdersActor(request);
    const body = (await request.json()) as CreateTemplateInput & {
      action?: "create" | "import_seed";
    };
    const service = getOrdersService();
    if (body.action === "import_seed") {
      const templates = await service.importSeedTemplates(actor, body.type);
      return NextResponse.json({ templates, legallyOperational: true });
    }
    const template = await service.createTemplate(
      {
        type: body.type,
        productName: body.productName,
        productCode: body.productCode,
        brandClient: body.brandClient,
        productId: body.productId,
        content: body.content,
        changeReason: body.changeReason,
        sourceFile: body.sourceFile,
      },
      actor
    );
    return NextResponse.json({ template, legallyOperational: true }, { status: 201 });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}
