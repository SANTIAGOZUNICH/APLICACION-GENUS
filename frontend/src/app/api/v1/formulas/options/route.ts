import { NextResponse } from "next/server";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { isDatabaseConfigured } from "@/lib/db/client";
import { readyFormulaBank } from "@/lib/formulas/get-formula-bank";
import {
  searchClients,
  searchProductsForClient,
} from "@/lib/formulas/formula-options";
import { normalizeSearchKey } from "@/lib/formulas/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED = ["CALIDAD", "PRODUCCION", "MATERIA_PRIMA", "ELABORACION", "DIRECCION"];

/**
 * Opciones de fórmula para combobox OE.
 * Solo metadatos de búsqueda (ids, nombres, aliases). Sin MP/%/procedimiento.
 */
export async function GET(request: Request) {
  try {
    const actor = resolveOrdersActor(request);
    if (!ALLOWED.includes(actor.sector)) {
      return NextResponse.json({ error: "Sector no autorizado" }, { status: 403 });
    }

    const url = new URL(request.url);
    const scope = (url.searchParams.get("scope") || "clients").trim();
    const q = (url.searchParams.get("q") || "").trim();
    const client = (url.searchParams.get("client") || "").trim();
    const limitRaw = Number(url.searchParams.get("limit") || "10");
    const limit = Number.isFinite(limitRaw)
      ? Math.min(Math.max(Math.floor(limitRaw), 1), 50)
      : 10;

    const bank = await readyFormulaBank();
    const options = bank.listActiveOptions();

    if (scope === "clients") {
      const hits = searchClients(options, q, limit);
      return NextResponse.json({
        scope: "clients",
        query: q,
        totalActiveProducts: options.length,
        clients: hits.map((h) => ({
          client: h.client,
          rank: h.rank,
        })),
        persistenceReady: isDatabaseConfigured(),
      });
    }

    if (scope === "products") {
      if (!client) {
        return NextResponse.json(
          { error: "client es obligatorio para scope=products" },
          { status: 400 }
        );
      }
      const hits = searchProductsForClient(options, client, q, limit);
      return NextResponse.json({
        scope: "products",
        query: q,
        client,
        totalForClient: options.filter(
          (o) => normalizeSearchKey(o.client) === normalizeSearchKey(client)
        ).length,
        products: hits.map((h) => ({
          productId: h.productId,
          versionId: h.versionId,
          productLabel: h.productLabel,
          client: h.client,
          code: h.code,
          aliases: h.aliases,
          rank: h.rank,
        })),
        persistenceReady: isDatabaseConfigured(),
      });
    }

    if (scope === "coverage") {
      // Solo conteos — sin nombres de fórmula ni contenido.
      return NextResponse.json({
        scope: "coverage",
        totalActiveProducts: options.length,
        distinctClients: new Set(options.map((o) => o.client)).size,
        persistenceReady: isDatabaseConfigured(),
      });
    }

    return NextResponse.json(
      { error: "scope inválido (clients|products|coverage)" },
      { status: 400 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
