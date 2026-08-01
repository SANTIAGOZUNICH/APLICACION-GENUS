import { NextResponse } from "next/server";
import { getAvisosService } from "@/lib/avisos/avisos-service";
import type { AvisoPriority, AvisoTab, CreateAvisoInput } from "@/lib/avisos/types";
import { isFeatureSchemaReady } from "@/lib/db/feature-schema";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { ordersErrorResponse } from "@/lib/orders/http";
import type { SectorId } from "@/types/operational/sector";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor = await resolveOrdersActor(request);
    const url = new URL(request.url);
    const tab = (url.searchParams.get("tab") ?? "recibidos") as AvisoTab;
    const q = url.searchParams.get("q") ?? "";
    if (!["recibidos", "enviados", "archivados"].includes(tab)) {
      return NextResponse.json({ error: "tab inválido" }, { status: 400 });
    }
    const persistenceReady = await isFeatureSchemaReady();
    const messages = await getAvisosService().list(
      { email: actor.email, sector: actor.sector },
      tab,
      q
    );
    return NextResponse.json({
      messages,
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
    const body = (await request.json()) as Partial<CreateAvisoInput> & {
      confirm?: boolean;
    };
    if (!body.confirm) {
      return NextResponse.json(
        { error: "Confirmá el envío (confirm: true)." },
        { status: 400 }
      );
    }
    const input: CreateAvisoInput = {
      title: String(body.title ?? ""),
      body: String(body.body ?? ""),
      priority: (body.priority as AvisoPriority) ?? "NORMAL",
      toSectors: (body.toSectors as SectorId[]) ?? [],
      toAll: Boolean(body.toAll),
    };
    const message = await getAvisosService().create(
      { email: actor.email, sector: actor.sector },
      input
    );
    return NextResponse.json({ message }, { status: 201 });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}
