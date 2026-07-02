import { NextResponse } from "next/server";
import { mockAdapter } from "@/lib/adapters/mock-adapter";
import { consultaResolver } from "@/lib/adapters/drive/resolvers/consulta.resolver";
import { matchesConsultaQuery } from "@/lib/adapters/drive/resolvers/consulta-search";
import {
  canUseDriveAdapter,
  shouldUseDemoFallback,
} from "@/lib/api/bff-helpers";
import {
  lotePageHref,
  oePageHref,
  pedidoPageHref,
} from "@/config/entity-pages";
import { getServerDataMode } from "@/lib/config/data-mode";
import type {
  ConsultaEntityKind,
  ConsultaResultItem,
  ConsultaSearchResponse,
} from "@/types/consulta/consulta-result";

function searchDemoEntities(query: string): ConsultaSearchResponse {
  const state = mockAdapter.getInitialState();
  const pages = Object.values(state.entityPages);
  const scopes: ConsultaEntityKind[] = ["oe", "lote", "pedido"];

  const results: ConsultaResultItem[] = pages
    .filter((page) => scopes.includes(page.kind as ConsultaEntityKind))
    .filter((page) =>
      matchesConsultaQuery(
        [page.entityId, page.title, page.subtitle, page.kind],
        query
      )
    )
    .map((page) => {
      const kind = page.kind as ConsultaEntityKind;
      const href =
        kind === "oe"
          ? oePageHref(page.entityId)
          : kind === "lote"
            ? lotePageHref(page.entityId)
            : pedidoPageHref(page.entityId);

      return {
        kind,
        id: page.entityId,
        title: page.title,
        subtitle: page.subtitle,
        href,
        metadata: [
          { id: "id", label: "ID", value: page.entityId },
          { id: "estado", label: "Estado", value: page.status },
        ],
        source: "demo" as const,
      };
    });

  return {
    query,
    results,
    counts: {
      oe: results.filter((item) => item.kind === "oe").length,
      lote: results.filter((item) => item.kind === "lote").length,
      pedido: results.filter((item) => item.kind === "pedido").length,
    },
    source: "demo",
    indexSummary: {
      oes: pages.filter((page) => page.kind === "oe").length,
      lotes: pages.filter((page) => page.kind === "lote").length,
      pedidos: pages.filter((page) => page.kind === "pedido").length,
    },
    message: "Modo demo — resultados desde mocks de desarrollo.",
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim() ?? "";

  if (getServerDataMode() !== "real" || !canUseDriveAdapter()) {
    if (getServerDataMode() === "real") {
      return NextResponse.json({
        query,
        results: [],
        counts: { oe: 0, lote: 0, pedido: 0 },
        source: "demo",
        indexSummary: { oes: 0, lotes: 0, pedidos: 0 },
        message:
          "Modo real sin Drive configurado — sin resultados ficticios.",
      });
    }

    if (!query) {
      const demo = searchDemoEntities("");
      return NextResponse.json({
        query: "",
        results: [],
        counts: { oe: 0, lote: 0, pedido: 0 },
        source: "demo",
        indexSummary: demo.indexSummary,
        message: "Ingresá un término para buscar en demo.",
      });
    }

    return NextResponse.json(searchDemoEntities(query));
  }

  try {
    const response = await consultaResolver.search(query);

    if (response.results.length === 0 && query && shouldUseDemoFallback()) {
      const demo = searchDemoEntities(query);
      if (demo.results.length > 0) {
        return NextResponse.json({
          ...demo,
          source: "demo",
          message:
            "Demo / fallback — sin coincidencias en Drive. Resultados ficticios etiquetados.",
        });
      }
    }

    return NextResponse.json(response);
  } catch (error) {
    console.error("[Genus] GET /api/v1/consulta failed:", error);

    if (shouldUseDemoFallback()) {
      const demo = searchDemoEntities(query);
      return NextResponse.json({
        ...demo,
        source: "demo",
        message:
          "Demo / fallback — error al consultar Drive. Resultados ficticios etiquetados.",
      });
    }

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "No se pudo consultar el índice operativo.",
        code: "CONSULTA_FAILED",
      },
      { status: 502 }
    );
  }
}
