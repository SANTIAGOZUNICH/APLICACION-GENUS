import { NextResponse } from "next/server";
import { driveAdapter } from "@/lib/adapters/adapter-factory";
import {
  canUseDriveAdapter,
  demoFallbackResponse,
  shouldUseDemoFallback,
} from "@/lib/api/bff-helpers";
import { getServerDataMode } from "@/lib/config/data-mode";

export async function GET() {
  if (getServerDataMode() !== "real" || !canUseDriveAdapter()) {
    return NextResponse.json({
      pedidos: [],
      source: "demo",
    });
  }

  try {
    const pedidos = await driveAdapter.listPedidos!();
    return NextResponse.json({
      pedidos,
      source: "drive",
    });
  } catch (error) {
    console.error("[Genus] GET /api/v1/pedidos failed:", error);

    if (shouldUseDemoFallback()) {
      return NextResponse.json({ pedidos: [], source: "demo" });
    }

    const fallback = demoFallbackResponse(() => [], error);
    if (!fallback.ok) return fallback.response;
    return NextResponse.json({ pedidos: [], source: "demo" });
  }
}
