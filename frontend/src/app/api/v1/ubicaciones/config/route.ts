import { NextResponse } from "next/server";
import { createLocation, updateLocation, updateMapConfig, upsertShape } from "@/lib/ubicaciones/service";
import { readJson, resolveUbActor, ubErrorResponse } from "@/lib/ubicaciones/http";
import { OrdersValidationError } from "@/lib/orders/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Configuración del mapa (Depósito y Dirección): `{ action: "crear" | "actualizar" | "forma" | "plano", ... }`. Las posiciones nunca se eliminan: se desactivan (solo vacías). */
export async function POST(request: Request) {
  try {
    const actor = await resolveUbActor(request);
    const b = await readJson<Record<string, unknown>>(request);
    switch (b.action) {
      case "crear":
        return NextResponse.json({ location: await createLocation(actor, b as never) }, { status: 201 });
      case "actualizar":
        return NextResponse.json({ location: await updateLocation(actor, b as never) });
      case "forma":
        return NextResponse.json({ shape: await upsertShape(actor, b as never) });
      case "plano":
        return NextResponse.json({ config: await updateMapConfig(actor, b as never) });
      default:
        throw new OrdersValidationError("Acción inválida.");
    }
  } catch (err) {
    return ubErrorResponse(err);
  }
}
