import { NextResponse } from "next/server";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { ordersErrorResponse } from "@/lib/orders/http";
import {
  addClientAlias, addClientEmail, backfillIdLinks, clientActivity, createClient, inviteClientEmail, linkingProblems, listClients, listHolidayOverrides,
  historyGenerate, historyPreview, renameClient, setClientAccess,
  previewClient, removeClientAlias, removeClientEmail, setClientStatus, setHolidayOverride, type Staff,
} from "@/lib/portal/admin-service";
import { createDemoToken } from "@/lib/portal/demo-service";
import { createPortalUser, listPortalUsers, suggestPortalUsername, removePortalUser, resetPortalUserPassword, setPortalUserStatus, updatePortalUser } from "@/lib/portal/user-admin-service";
import { PortalError } from "@/lib/portal/store";
import { pushAdminOverview, sendTestPush, setClientPilot, updatePushSettings } from "@/lib/portal/push/push-service";

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
    // Usuarios con contraseña: Dirección y Administración (cada función valida el rol de nuevo).
    // Notificaciones push: SOLO Dirección (el servicio lo vuelve a validar).
    if (view === "push") return NextResponse.json(await pushAdminOverview(staff));
    if (view === "suggest_username") return NextResponse.json(await suggestPortalUsername(staff, clientId));
    if (view === "users") return NextResponse.json(await listPortalUsers(staff));
    if (view === "clients") return NextResponse.json({ clients: await listClients(staff), holidays: await listHolidayOverrides(staff) });
    if (view === "history_preview") return NextResponse.json(await historyPreview(staff));
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
      case "push_settings": return NextResponse.json({ settings: await updatePushSettings(staff, { globalSendEnabled: b.globalSendEnabled, elaboracionDays: b.elaboracionDays, envasadoDays: b.envasadoDays }) });
      case "push_test": return NextResponse.json(await sendTestPush(staff, clientId));
      case "push_pilot": return NextResponse.json(await setClientPilot(staff, clientId, b.enabled === true));
      case "create_user": return NextResponse.json(await createPortalUser(staff, { clientId: b.clientId, username: b.username, password: b.password, email: b.email, displayName: b.displayName, autoSuffix: b.autoSuffix }), { status: 201 });
      case "activate_user": return NextResponse.json(await setPortalUserStatus(staff, String(b.userId ?? ""), true));
      case "deactivate_user": return NextResponse.json(await setPortalUserStatus(staff, String(b.userId ?? ""), false));
      case "reset_user_password": return NextResponse.json(await resetPortalUserPassword(staff, String(b.userId ?? "")));
      case "update_user": await updatePortalUser(staff, String(b.userId ?? ""), { email: b.email, displayName: b.displayName }); return NextResponse.json({ ok: true });
      case "remove_user": return NextResponse.json(await removePortalUser(staff, String(b.userId ?? "")));
      case "create_client": return NextResponse.json(await createClient(staff, b as { displayName: unknown }), { status: 201 });
      case "enable_access": return NextResponse.json(await setClientAccess(staff, clientId, true));
      case "disable_access": return NextResponse.json(await setClientAccess(staff, clientId, false));
      case "rename_client": await renameClient(staff, clientId, b.name); return NextResponse.json({ ok: true });
      // Vínculo por ID de los pedidos/trabajos históricos: SOLO Dirección (el servicio lo vuelve a validar). Ambiguos/sin coincidencia solo se reportan.
      case "backfill_links": return NextResponse.json(await backfillIdLinks(staff));
      case "history_generate": return NextResponse.json(await historyGenerate(staff, b as { previewToken: unknown; expectedCount: unknown }));
      case "suspend": return NextResponse.json(await setClientStatus(staff, clientId, "SUSPENDIDO", b.reason));
      case "activate": return NextResponse.json(await setClientStatus(staff, clientId, "ACTIVO", null));
      case "add_alias": await addClientAlias(staff, clientId, b.name); return NextResponse.json({ ok: true });
      case "remove_alias": await removeClientAlias(staff, clientId, b.name); return NextResponse.json({ ok: true });
      case "add_email": return NextResponse.json(await addClientEmail(staff, clientId, b.email));
      case "remove_email": await removeClientEmail(staff, clientId, b.email); return NextResponse.json({ ok: true });
      case "invite": return NextResponse.json(await inviteClientEmail(staff, clientId, b.email));
      // Portal de prueba: token temporal de un solo uso para el usuario interno autorizado (la URL lleva el token en el fragmento).
      case "demo_launch": return NextResponse.json(await createDemoToken(staff));
      case "holiday": await setHolidayOverride(staff, { date: b.date, name: b.name, action: b.holidayAction, remove: b.remove }); return NextResponse.json({ ok: true });
      default: throw new PortalError("Acción desconocida.", 400, "VALIDATION");
    }
  } catch (err) {
    return fail(err);
  }
}
