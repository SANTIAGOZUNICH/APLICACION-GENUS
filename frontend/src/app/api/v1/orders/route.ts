import { NextResponse } from "next/server";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { getOrdersService } from "@/lib/orders/get-orders-service";
import { ensureOrdersPersistenceReady, ordersErrorResponse } from "@/lib/orders/http";
import type { CreateOrderInput, ListOrdersFilters, OrderDocType, OrderStatus } from "@/lib/orders/types";
import type { SectorId } from "@/types/operational/sector";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const blocked = ensureOrdersPersistenceReady();
  if (blocked) return blocked;
  try {
    const actor = resolveOrdersActor(request);
    const url = new URL(request.url);
    const filters: ListOrdersFilters = {
      type: (url.searchParams.get("type") as OrderDocType | null) ?? undefined,
      tab: (url.searchParams.get("tab") as ListOrdersFilters["tab"]) ?? undefined,
      search: url.searchParams.get("search") ?? undefined,
      status: (url.searchParams.get("status") as OrderStatus | null) ?? undefined,
      assignedSector: (url.searchParams.get("assignedSector") as SectorId | null) ?? undefined,
      product: url.searchParams.get("product") ?? undefined,
      client: url.searchParams.get("client") ?? undefined,
      year: url.searchParams.get("year")
        ? Number(url.searchParams.get("year"))
        : undefined,
      month: url.searchParams.get("month")
        ? Number(url.searchParams.get("month"))
        : undefined,
      dateFrom: url.searchParams.get("dateFrom") ?? undefined,
      dateTo: url.searchParams.get("dateTo") ?? undefined,
      sort: (url.searchParams.get("sort") as ListOrdersFilters["sort"]) ?? undefined,
      page: url.searchParams.get("page")
        ? Number(url.searchParams.get("page"))
        : undefined,
      pageSize: url.searchParams.get("pageSize")
        ? Number(url.searchParams.get("pageSize"))
        : undefined,
    };
    const result = await getOrdersService().listOrders(filters, actor);
    return NextResponse.json({ ...result, legallyOperational: true });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}

export async function POST(request: Request) {
  const blocked = ensureOrdersPersistenceReady();
  if (blocked) return blocked;
  try {
    const actor = resolveOrdersActor(request);
    const body = (await request.json()) as CreateOrderInput & {
      fromScratch?: boolean;
      alsoCreateMaster?: boolean;
      masterChangeReason?: string;
      content?: CreateOrderInput["formOverrides"];
      product?: string;
      code?: string;
      client?: string;
      lot?: string;
    };
    if (body.fromScratch) {
      const result = await getOrdersService().createOrderFromScratch(
        {
          type: body.type,
          product: body.product ?? "",
          code: body.code ?? "",
          client: body.client ?? "",
          lot: body.lot ?? "",
          assignedSector: body.assignedSector,
          content: body.content as never,
          alsoCreateMaster: body.alsoCreateMaster,
          masterChangeReason: body.masterChangeReason,
        },
        actor
      );
      return NextResponse.json(
        { ...result, legallyOperational: true },
        { status: 201 }
      );
    }
    const order = await getOrdersService().createOrder(body, actor);
    return NextResponse.json({ order, legallyOperational: true }, { status: 201 });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}
