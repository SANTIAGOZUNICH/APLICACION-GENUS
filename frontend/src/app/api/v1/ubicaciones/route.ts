import { NextResponse } from "next/server";
import { addContent, adjustIngresoMe, getMap, linkContent, listClients, listIngresos, listMaterials, listMovements, placeIngresoMe, releaseLocation, removeContent, retireAnuladoIngreso, setObservations, transferContent } from "@/lib/ubicaciones/service";
import { readJson, resolveUbActor, ubErrorResponse } from "@/lib/ubicaciones/http";
import { OrdersValidationError } from "@/lib/orders/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };

/** Lectura (Depósito, Envasado Masivo/Premium, Producción, Dirección). `?view=map` (por defecto) · `history` (locationId, kind, limit) · `clients` · `materials` (q). */
export async function GET(request: Request) {
  try {
    const actor = await resolveUbActor(request);
    const p = new URL(request.url).searchParams;
    switch (p.get("view") ?? "map") {
      case "history":
        return NextResponse.json({ movements: await listMovements(actor, { locationId: p.get("locationId") ?? undefined, kind: p.get("kind") ?? undefined, limit: p.get("limit") ? Number(p.get("limit")) : undefined }) }, { headers: NO_STORE });
      case "clients":
        return NextResponse.json({ clients: await listClients(actor) }, { headers: NO_STORE });
      case "ingresos":
        return NextResponse.json(await listIngresos(actor, p.get("q") ?? undefined), { headers: NO_STORE });
      case "materials":
        return NextResponse.json({ materials: await listMaterials(actor, p.get("q") ?? undefined) }, { headers: NO_STORE });
      default:
        return NextResponse.json({ map: await getMap(actor) }, { headers: NO_STORE });
    }
  } catch (err) {
    return ubErrorResponse(err);
  }
}

/** Escritura de contenido (solo Depósito): `{ action: "agregar" | "retirar" | "observaciones" | "trasladar" | "liberar" | "ingreso_me", key, ... }`. */
export async function POST(request: Request) {
  try {
    const actor = await resolveUbActor(request);
    const b = await readJson<Record<string, unknown>>(request);
    switch (b.action) {
      case "agregar":
      case "asignar":
        return NextResponse.json(await addContent(actor, { key: b.key, locationId: b.locationId, expectedVersion: b.expectedVersion, lines: b.lines, observations: b.observations }));
      case "retirar":
        return NextResponse.json(await removeContent(actor, { key: b.key, locationId: b.locationId, expectedVersion: b.expectedVersion, lines: b.lines }));
      case "observaciones":
        return NextResponse.json(await setObservations(actor, { key: b.key, locationId: b.locationId, expectedVersion: b.expectedVersion, observations: b.observations }));
      case "trasladar":
        return NextResponse.json(await transferContent(actor, { key: b.key, fromId: b.fromId, toId: b.toId, expectedVersion: b.expectedVersion, expectedToVersion: b.expectedToVersion, all: b.all, lines: b.lines }));
      case "liberar":
        return NextResponse.json(await releaseLocation(actor, { key: b.key, locationId: b.locationId, expectedVersion: b.expectedVersion }));
      case "ingreso_me":
        return NextResponse.json(await placeIngresoMe(actor, { ingresoId: b.ingresoId, locationId: b.locationId, clientName: b.clientName }));
      case "ingreso_ajustar":
        return NextResponse.json(await adjustIngresoMe(actor, { ingresoId: b.ingresoId }));
      case "ingreso_retirar":
        return NextResponse.json(await retireAnuladoIngreso(actor, { ingresoId: b.ingresoId }));
      case "vincular":
        return NextResponse.json(await linkContent(actor, { key: b.key, locationId: b.locationId, itemId: b.itemId, meMaterialId: b.meMaterialId, expectedVersion: b.expectedVersion }));
      default:
        throw new OrdersValidationError("Acción inválida.");
    }
  } catch (err) {
    return ubErrorResponse(err);
  }
}
