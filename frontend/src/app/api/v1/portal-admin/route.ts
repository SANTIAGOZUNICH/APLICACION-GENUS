import { NextResponse } from "next/server";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { ordersErrorResponse } from "@/lib/orders/http";
import {
  addClientAlias, addClientEmail, clientActivity, createClient, inviteClientEmail, linkingProblems, listClients, listHolidayOverrides,
  previewClient, removeClientAlias, removeClientEmail, setClientStatus, setHolidayOverride, type Staff,
} from "@/lib/portal/admin-service";
import { PortalError } from "@/lib/portal/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function staffOf(request: Request): Promise<Staff> {
  const actor = await resolveOrdersActor(request);
  return { email: actor.email, sector: actor.sector };
}

function fail(err: unknown) {
  if (err instanceof PortalError) return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
  return ordersErrorResponse(err);
}

const id = (v: unknown) => (typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v) ? v : "");

/** Consultas del panel «Portal de Clientes» (solo Producción/Dirección). */
export async function GET(request: Request) {
  try {
    const staff = await staffOf(request);
    const url = new URL(request.url);
    const view = url.searchParams.get("view") ?? "clients";
    const clientId = id(url.searchParams.get("clientId"));
    if (view === "clients") return NextResponse.json({ clients: await listClients(staff), holidays: await listHolidayOverrides(staff) });
    if (view === "problems") return NextResponse.json(await linkingProblems(staff));
    if (!clientId) throw new PortalError("Cliente inválido.", 400, "VALIDATION");
    if (view === "preview") return NextResponse.json(await previewClient(staff, clientId));
    if (view === "activity") return NextResponse.json(await clientActivity(staff, clientId));
    throw new PortalError("Vista desconocida.", 400, "VALIDATION");
  } catch (err) {
    return fail(err);
  }
}

/** Acciones del panel. Una sola entrada con `action`; cada una valida el rol de nuevo en el servicio. */
export async function POST(request: Request) {
  try {
    const staff = await staffOf(request);
    const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!b || typeof b.action !== "string") throw new PortalError("Solicitud inválida.", 400, "VALIDATION");
    const clientId = id(b.clientId);
    switch (b.action) {
      case "create_client": return NextResponse.json(await createClient(staff, b as { displayName: unknown }), { status: 201 });
      case "suspend": return NextResponse.json(await setClientStatus(staff, clientId, "SUSPENDIDO", b.reason));
      case "activate": return NextResponse.json(await setClientStatus(staff, clientId, "ACTIVO", null));
      case "add_alias": await addClientAlias(staff, clientId, b.name); return NextResponse.json({ ok: true });
      case "remove_alias": await removeClientAlias(staff, clientId, b.name); return NextResponse.json({ ok: true });
      case "add_email": return NextResponse.json(await addClientEmail(staff, clientId, b.email));
      case "remove_email": await removeClientEmail(staff, clientId, b.email); return NextResponse.json({ ok: true });
      case "invite": return NextResponse.json(await inviteClientEmail(staff, clientId, b.email));
      case "holiday": await setHolidayOverride(staff, { date: b.date, name: b.name, action: b.holidayAction, remove: b.remove }); return NextResponse.json({ ok: true });
      default: throw new PortalError("Acción desconocida.", 400, "VALIDATION");
    }
  } catch (err) {
    return fail(err);
  }
}
