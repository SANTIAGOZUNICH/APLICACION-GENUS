import { NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db/client";
import { findMockUserByEmail } from "@/features/os/auth/lib/mock-preview-users";
import type { SectorId } from "@/types/operational/sector";
import type { InventoryActor } from "./inventory-service";
import {
  InventoryForbiddenError,
  InventoryNotFoundError,
  InventoryValidationError,
} from "./inventory-service";

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

export function resolveInventoryActor(request: Request): InventoryActor {
  const email = request.headers.get("x-genus-actor-email")?.trim().toLowerCase() ?? "";
  const sectorHeader = request.headers.get("x-genus-actor-sector")?.trim() as SectorId | "";
  if (!email || !sectorHeader) {
    throw new InventoryForbiddenError("actorSectorId requerido");
  }
  const user = findMockUserByEmail(email);
  if (!user || user.sector !== sectorHeader) {
    throw new InventoryForbiddenError("Actor no autorizado o sector incorrecto.");
  }
  return { email: user.email, sector: user.sector as SectorId, displayName: user.displayName };
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
