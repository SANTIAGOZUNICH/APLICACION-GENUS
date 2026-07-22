import { NextResponse } from "next/server";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { isDatabaseConfigured } from "@/lib/db/client";
import { readyFormulaBank } from "@/lib/formulas/get-formula-bank";
import {
  searchClients,
  searchProductsForClient,
} from "@/lib/formulas/formula-options";
import { normalizeSearchKey } from "@/lib/formulas/types";
import {
  searchDriveClients,
  searchDriveProducts,
  syncDriveFormulasIndex,
} from "@/lib/formulas/drive-formulas-index";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SEARCH_ALLOWED = ["CALIDAD", "PRODUCCION", "MATERIA_PRIMA", "DIRECCION"];
const SYNC_ALLOWED = ["CALIDAD", "PRODUCCION", "MATERIA_PRIMA", "DIRECCION"];

/**
 * Opciones de fórmula: Drive primero; Neon como CACHE_NEON si Drive falla.
 * Sin MP/%/procedimiento.
 */
export async function GET(request: Request) {
  try {
    const actor = resolveOrdersActor(request);
    if (!SEARCH_ALLOWED.includes(actor.sector)) {
      return NextResponse.json(
        {
          error:
            "Sector no autorizado para navegar el banco de fórmulas (Drive).",
        },
        { status: 403 }
      );
    }

    const url = new URL(request.url);
    const scope = (url.searchParams.get("scope") || "clients").trim();
    const q = (url.searchParams.get("q") || "").trim();
    const client = (url.searchParams.get("client") || "").trim();
    const limitRaw = Number(url.searchParams.get("limit") || "10");
    const limit = Number.isFinite(limitRaw)
      ? Math.min(Math.max(Math.floor(limitRaw), 1), 50)
      : 10;

    if (scope === "coverage") {
      const bank = await readyFormulaBank();
      const stats = bank.coverageStats();
      return NextResponse.json({
        scope: "coverage",
        ...stats,
        persistenceReady: isDatabaseConfigured(),
      });
    }

    // Drive first
    let driveError: string | null = null;
    try {
      if (scope === "clients") {
        const hits = await searchDriveClients(q, limit);
        return NextResponse.json({
          scope: "clients",
          query: q,
          source: "DRIVE",
          clients: hits.map((h) => ({
            client: h.client,
            rank: h.rank,
            source: "DRIVE" as const,
          })),
          persistenceReady: true,
        });
      }
      if (scope === "products") {
        if (!client) {
          return NextResponse.json(
            { error: "client es obligatorio para scope=products" },
            { status: 400 }
          );
        }
        const hits = await searchDriveProducts(client, q, limit);
        return NextResponse.json({
          scope: "products",
          query: q,
          client,
          source: "DRIVE",
          products: hits.map((h) => ({
            productId: `drive:${h.fileId}`,
            versionId: `drive:${h.fileId}`,
            driveFileId: h.fileId,
            productLabel: h.productLabel,
            client: h.client,
            code: "",
            aliases: h.aliases,
            rank: h.rank,
            source: "DRIVE" as const,
            modifiedTime: h.modifiedTime,
          })),
          persistenceReady: true,
        });
      }
    } catch (err) {
      driveError = err instanceof Error ? err.message : "Drive no disponible";
    }

    // Fallback Neon
    const bank = await readyFormulaBank();
    const options = bank.listActiveOptions();

    if (scope === "clients") {
      const hits = searchClients(options, q, limit);
      return NextResponse.json({
        scope: "clients",
        query: q,
        source: "CACHE_NEON",
        driveError,
        totalActiveProducts: options.length,
        clients: hits.map((h) => ({
          client: h.client,
          rank: h.rank,
          source: "CACHE_NEON" as const,
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
        source: "CACHE_NEON",
        driveError,
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
          source: "CACHE_NEON" as const,
        })),
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

/** Sincronizar índice de metadata desde Drive (Calidad/Producción/MP). */
export async function POST(request: Request) {
  try {
    const actor = resolveOrdersActor(request);
    if (!SYNC_ALLOWED.includes(actor.sector)) {
      return NextResponse.json({ error: "Sector no autorizado" }, { status: 403 });
    }
    const body = (await request.json().catch(() => ({}))) as { force?: boolean };
    const result = await syncDriveFormulasIndex(Boolean(body.force));
    if (!result.ok) {
      return NextResponse.json(
        {
          error: result.error ?? "No pudimos sincronizar Drive",
          ...result,
        },
        { status: 502 }
      );
    }
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
