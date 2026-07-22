import { NextResponse } from "next/server";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { isDatabaseConfigured } from "@/lib/db/client";
import { readyFormulaBank } from "@/lib/formulas/get-formula-bank";
import { emptyOeMaterial } from "@/lib/orders/content";
import type { OeContent } from "@/lib/orders/types";
import { resolveFormulaFromDriveFile } from "@/lib/formulas/drive-formulas-index";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DRIVE_LOAD_ALLOWED = ["CALIDAD", "PRODUCCION", "MATERIA_PRIMA", "DIRECCION"];
const RESOLVE_ALLOWED = [
  "CALIDAD",
  "PRODUCCION",
  "MATERIA_PRIMA",
  "ELABORACION",
  "DIRECCION",
];

/**
 * Resuelve UNA fórmula:
 * - driveFileId → Drive (Calidad/Producción/MP)
 * - productId / client+product → Neon (respaldo / exacto)
 */
export async function POST(request: Request) {
  try {
    const actor = resolveOrdersActor(request);
    if (!RESOLVE_ALLOWED.includes(actor.sector)) {
      return NextResponse.json({ error: "Sector no autorizado" }, { status: 403 });
    }

    const body = (await request.json()) as {
      client?: string;
      product?: string;
      productId?: string;
      driveFileId?: string;
    };
    const driveFileId = (body.driveFileId ?? "").trim();
    const productId = (body.productId ?? "").trim();
    const client = (body.client ?? "").trim();
    const product = (body.product ?? "").trim();

    // Preferir Drive cuando hay fileId
    if (driveFileId || productId.startsWith("drive:")) {
      if (!DRIVE_LOAD_ALLOWED.includes(actor.sector)) {
        return NextResponse.json(
          { error: "Elaboración no navega el banco de Drive; usa el snapshot de la OE." },
          { status: 403 }
        );
      }
      const fileId = driveFileId || productId.replace(/^drive:/, "");
      const result = await resolveFormulaFromDriveFile({
        fileId,
        clientHint: client,
        productHint: product,
      });
      if (!result.found) {
        return NextResponse.json({
          found: false,
          source: "DRIVE",
          message: result.message,
          persistenceReady: isDatabaseConfigured(),
        });
      }
      return NextResponse.json({
        found: true,
        source: "DRIVE",
        message: "Fórmula encontrada en Drive",
        snapshot: result.snapshot,
        materials: result.materials,
        procedureSteps: result.procedureSteps,
        persistenceReady: isDatabaseConfigured(),
      });
    }

    if (!productId && (!client || !product)) {
      return NextResponse.json(
        { error: "driveFileId, productId o (client y product) son obligatorios" },
        { status: 400 }
      );
    }

    const bank = await readyFormulaBank();
    const lookup = productId
      ? bank.resolveByProductId(productId)
      : bank.resolveLookup(client, product);

    if (lookup.kind === "conflict") {
      return NextResponse.json({
        found: false,
        conflict: true,
        conflictCode: lookup.code,
        reason: lookup.reason ?? "conflict",
        message: lookup.message,
        source: "CACHE_NEON",
        persistenceReady: isDatabaseConfigured(),
      });
    }

    if (lookup.kind === "not_found") {
      return NextResponse.json({
        found: false,
        reason: lookup.reason ?? "name_mismatch",
        message: lookup.message,
        source: "CACHE_NEON",
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
      procedureSteps: snap.procedureSteps.map((s) => ({
        id: s.id,
        text: s.instruction,
      })),
    };

    return NextResponse.json({
      found: true,
      source: "CACHE_NEON",
      snapshot: {
        formulaProductId: snap.formulaProductId,
        formulaVersionId: snap.formulaVersionId,
        versionHash: snap.versionHash,
        displayClient: snap.displayClient,
        displayProduct: snap.displayProduct,
        productCode: snap.productCode,
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
