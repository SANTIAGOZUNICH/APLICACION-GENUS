import { NextResponse } from "next/server";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { isDatabaseConfigured } from "@/lib/db/client";
import { readyFormulaBank } from "@/lib/formulas/get-formula-bank";
import { emptyOeMaterial } from "@/lib/orders/content";
import type { OeContent } from "@/lib/orders/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Resuelve UNA fórmula vigente por cliente+producto.
 * No lista el banco. No expone GET /formulas.
 */
export async function POST(request: Request) {
  try {
    const actor = resolveOrdersActor(request);
    // Documentado: autenticación preview vía headers; validar sector en servidor.
    const allowed = ["CALIDAD", "PRODUCCION", "MATERIA_PRIMA", "ELABORACION", "DIRECCION"];
    if (!allowed.includes(actor.sector)) {
      return NextResponse.json({ error: "Sector no autorizado" }, { status: 403 });
    }

    const body = (await request.json()) as { client?: string; product?: string };
    const client = (body.client ?? "").trim();
    const product = (body.product ?? "").trim();
    if (!client || !product) {
      return NextResponse.json(
        { error: "client y product son obligatorios" },
        { status: 400 }
      );
    }

    const bank = await readyFormulaBank();
    const lookup = bank.resolveLookup(client, product);

    if (lookup.kind === "conflict") {
      return NextResponse.json({
        found: false,
        conflict: true,
        conflictCode: lookup.code,
        message: lookup.message,
        persistenceReady: isDatabaseConfigured(),
      });
    }

    if (lookup.kind === "not_found") {
      return NextResponse.json({
        found: false,
        message: lookup.message,
        persistenceReady: isDatabaseConfigured(),
      });
    }

    const snap = lookup.snapshot;
    const materials = snap.ingredients.map((ing) =>
      emptyOeMaterial({
        materiaPrima: ing.materialName,
        codigo: ing.materialCodeOrPhase,
        formulaPct: ing.percentage,
        kgAPesar: null,
      })
    );

    const partial: Pick<OeContent, "materials" | "procedureSteps"> = {
      materials,
      procedureSteps: snap.procedureSteps.map((s) => ({ id: s.id, text: s.instruction })),
    };

    return NextResponse.json({
      found: true,
      snapshot: {
        formulaProductId: snap.formulaProductId,
        formulaVersionId: snap.formulaVersionId,
        versionHash: snap.versionHash,
      },
      materials: partial.materials.map((m) => ({
        materiaPrima: m.materiaPrima,
        codigo: m.codigo,
        formulaPct: m.formulaPct,
      })),
      procedureSteps: partial.procedureSteps,
      persistenceReady: isDatabaseConfigured(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
