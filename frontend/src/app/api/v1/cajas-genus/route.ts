import { NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db/client";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { ordersErrorResponse } from "@/lib/orders/http";
import { OrdersValidationError } from "@/lib/orders/types";
import { canAdministerCajas, canRegisterIngreso, canViewIngresos } from "@/lib/cajas-genus/rbac";
import type { Period } from "@/lib/cajas-genus/rules";
import {
  getSummary,
  listAudit,
  listClientSettings,
  listMovements,
  listPending,
  manualAdjust,
  reclassifyClient,
  reconcileCajas,
  registerIngresos,
  report,
  setClientOwnBoxes,
  setInitialStock,
  voidMovement,
  type CajasActor,
} from "@/lib/cajas-genus/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const toActor = (a: Awaited<ReturnType<typeof resolveOrdersActor>>): CajasActor => ({ email: a.email, sector: a.sector, displayName: a.displayName });

/**
 * Cajas Genus. GET `view`: summary (stock y alerta; Depósito, Administración y Dirección) · movements · report · pending · clients · audit.
 * El stock sale SIEMPRE del libro de movimientos calculado en el servidor.
 */
export async function GET(request: Request) {
  try {
    const actor = toActor(await resolveOrdersActor(request));
    const url = new URL(request.url);
    const view = url.searchParams.get("view") ?? "summary";
    const caps = { canRegister: canRegisterIngreso(actor.sector), canView: canViewIngresos(actor.sector), canAdmin: canAdministerCajas(actor.sector), persistenceReady: isDatabaseConfigured() };
    if (!isDatabaseConfigured()) return NextResponse.json({ ...caps, summary: null, items: [] });
    const filters = {
      from: url.searchParams.get("from") || undefined,
      to: url.searchParams.get("to") || undefined,
      client: url.searchParams.get("client") || undefined,
      kind: url.searchParams.get("kind") || undefined,
      includeVoided: url.searchParams.get("voided") === "1",
    };
    if (view === "summary") return NextResponse.json({ ...caps, summary: await getSummary(actor) });
    if (view === "movements") return NextResponse.json({ ...caps, ...(await listMovements(actor, filters)) });
    if (view === "report") return NextResponse.json({ ...caps, report: await report(actor, { ...filters, period: (url.searchParams.get("period") as Period) || "dia" }) });
    if (view === "pending") return NextResponse.json({ ...caps, pending: await listPending(actor) });
    if (view === "clients") return NextResponse.json({ ...caps, ...(await listClientSettings(actor)) });
    if (view === "audit") return NextResponse.json({ ...caps, audit: await listAudit(actor) });
    throw new OrdersValidationError("Vista inválida.");
  } catch (err) {
    return ordersErrorResponse(err);
  }
}

/** Acciones: register_ingresos (Depósito) · set_initial · adjust · void · set_client · reclassify · reconcile (Administración / Dirección). */
export async function POST(request: Request) {
  try {
    const actor = toActor(await resolveOrdersActor(request));
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body.action !== "string") throw new OrdersValidationError("Pedido inválido.");
    switch (body.action) {
      case "register_ingresos": {
        const rows = Array.isArray(body.rows) ? (body.rows as Array<{ fecha?: string; bultos: unknown; cantidad: unknown; key?: string }>) : [];
        const out = await registerIngresos(actor, rows, typeof body.batchKey === "string" ? body.batchKey : undefined);
        return NextResponse.json(out, { status: 201 });
      }
      case "set_initial":
        return NextResponse.json({ summary: await setInitialStock(actor, { quantity: body.quantity, fecha: body.fecha as string | undefined, note: body.note as string | undefined, key: String(body.key ?? "") }) });
      case "adjust":
        return NextResponse.json({ summary: await manualAdjust(actor, { delta: body.delta, reason: String(body.reason ?? ""), fecha: body.fecha as string | undefined, key: String(body.key ?? "") }) });
      case "void":
        return NextResponse.json({ summary: await voidMovement(actor, String(body.id ?? ""), String(body.reason ?? "")) });
      case "set_client":
        return NextResponse.json({ client: await setClientOwnBoxes(actor, { name: String(body.name ?? ""), usesOwnBoxes: body.usesOwnBoxes === true }) });
      case "reclassify":
        return NextResponse.json(await reclassifyClient(actor, String(body.name ?? "")));
      case "reconcile":
        return NextResponse.json(await reconcileCajas(actor, { onlyMissing: body.onlyMissing === true }));
      default:
        throw new OrdersValidationError("Acción inválida.");
    }
  } catch (err) {
    return ordersErrorResponse(err);
  }
}
