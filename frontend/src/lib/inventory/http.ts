import { NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db/client";
import { ACTOR_EMAIL_HEADER, ACTOR_SECTOR_HEADER } from "@/lib/auth/header-names";
import { resolveAuthenticatedActor } from "@/lib/auth/resolve-authenticated-actor";
import { AuthUnauthorizedError, type AuthActor } from "@/lib/auth/types";
import type { SectorId } from "@/types/operational/sector";
import type { InventoryActor } from "./inventory-service";
import {
  InventoryForbiddenError,
  InventoryNotFoundError,
  InventoryValidationError,
} from "./inventory-service";

/**
 * Nombres de header históricos, definidos en un módulo client-safe
 * (@/lib/auth/header-names). IMPORTANTE: código de cliente debe
 * importarlos directamente desde `@/lib/auth/header-names`, nunca desde
 * este archivo — este módulo arrastra el árbol server-only de Genus Auth
 * (y de next/server).
 *
 * En Preview real la identidad SIEMPRE viene de la cookie de sesión
 * (`genus_session`); este header queda como fuente de identidad SOLO en
 * modo test (`NODE_ENV==='test'` o `GENUS_AUTH_ALLOW_TEST_HEADERS==='1'`).
 * Fuera de ese modo se IGNORA.
 */
export { ACTOR_EMAIL_HEADER, ACTOR_SECTOR_HEADER };

export function ensureInventoryPersistenceReady(): NextResponse | null {
  if (isDatabaseConfigured()) return null;
  return NextResponse.json(
    {
      error:
        "Inventario requiere DATABASE_URL (Neon). Vista demostrativa vacía disponible en cliente; no se puede guardar.",
      code: "DATABASE_REQUIRED",
      persistence: false,
    },
    { status: 503 }
  );
}

export async function resolveInventoryActor(request: Request): Promise<InventoryActor> {
  let actor: AuthActor;
  try {
    actor = await resolveAuthenticatedActor(request);
  } catch (err) {
    if (err instanceof AuthUnauthorizedError) {
      throw new InventoryForbiddenError("Sesión requerida (inicie sesión para continuar).");
    }
    throw err;
  }

  const claimedSector = request.headers.get(ACTOR_SECTOR_HEADER)?.trim().toUpperCase();
  if (claimedSector && claimedSector !== actor.sector) {
    throw new InventoryForbiddenError("Actor no autorizado o sector incorrecto.");
  }

  return { email: actor.email, sector: actor.sector as SectorId, displayName: actor.displayName };
}

export function inventoryErrorResponse(err: unknown): NextResponse {
  if (
    err instanceof InventoryForbiddenError ||
    err instanceof InventoryValidationError ||
    err instanceof InventoryNotFoundError
  ) {
    return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
  }
  if (err && typeof err === "object" && "status" in err && "message" in err) {
    const e = err as { status: number; message: string; code?: string };
    return NextResponse.json(
      { error: e.message, code: e.code ?? "ERROR" },
      { status: e.status || 500 }
    );
  }
  console.error("[inventory]", err);
  return NextResponse.json({ error: "Error interno de inventario." }, { status: 500 });
}
