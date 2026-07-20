import { NextResponse } from "next/server";
import { listBuiltinTemplates } from "@/lib/orders/seed-templates";
import type { OrderDocType } from "@/lib/orders/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Catálogo de plantillas de referencia (OE Serum / OA Laude).
 * Disponible sin DATABASE_URL — solo para vista previa del modelo.
 * No permite crear ni guardar órdenes.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const type = url.searchParams.get("type") as OrderDocType | null;
  const templates = listBuiltinTemplates(type ?? undefined);
  return NextResponse.json({
    templates,
    legallyOperational: false,
    previewOnly: true,
    message:
      "Catálogo de referencia para vista previa. La creación y el guardado requieren DATABASE_URL (Neon).",
  });
}
