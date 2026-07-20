import "server-only";

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Estado de configuración de Creamy — no expone secretos. */
export async function GET() {
  const configured = Boolean(
    process.env.CREAMY_OPENAI_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim()
  );
  const model =
    process.env.CREAMY_OPENAI_MODEL?.trim() ||
    (configured ? "gpt-4o-mini" : null);

  return NextResponse.json({
    configured,
    model: configured ? model : null,
    provider: configured ? "openai" : null,
  });
}
