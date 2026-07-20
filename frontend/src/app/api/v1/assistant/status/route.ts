import "server-only";

import { NextResponse } from "next/server";
import { resolveCreamyProvider } from "@/lib/assistant/creamy-provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Estado de configuración de Creamy — no expone secretos. */
export async function GET() {
  const resolved = resolveCreamyProvider();

  return NextResponse.json({
    configured: resolved.configured,
    provider: resolved.configured ? resolved.provider : null,
    model: resolved.configured ? resolved.model : null,
  });
}
