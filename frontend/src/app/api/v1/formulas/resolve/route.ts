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
    const actor = await resolveOrdersActor(request);
    if (!RESOLVE_ALLOWED.includes(actor.sector)) {
      return NextResponse.json({ error: "Sector no autorizado" }, { status: 403 });
    }

    const body = (await request.json()) as {
      client?: string;
      product?: string;
      productId?: string;
      driveFileId?: string;
      /** OE desde la que se eligió la fórmula: el vínculo se guarda con el cliente + producto de SU trabajo. */
      orderId?: string;
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
      // Producción eligió a mano el archivo de la carpeta de fórmulas para una OE: queda vinculado al cliente + producto
      // del trabajo de esa OE, así las próximas asignaciones lo reutilizan sin volver a buscarlo.
      const linkedFor = await rememberManualChoice(actor, fileId, (body.orderId ?? "").trim()).catch(() => null);
      return NextResponse.json({
        found: true,
        source: "DRIVE",
        message: "Fórmula encontrada en Drive",
        linkedFor,
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

    // Búsqueda por nombre: con la carpeta nueva validada se usa la MISMA búsqueda que la OE automática.
    if (!productId) {
      const src = await import("@/lib/formulas/drive-formula-source");
      if (await src.isNewFormulaSourceValidated()) {
        const { resolveFormulaForWork } = await import("@/lib/formulas/resolve-for-work");
        const r = await resolveFormulaForWork({ client, product });
        if (!r.ok) {
          return NextResponse.json({
            found: false,
            reason: r.status === "ambiguous" ? "ambiguous" : "name_mismatch",
            message: r.message,
            source: "DRIVE",
            persistenceReady: isDatabaseConfigured(),
          });
        }
        return NextResponse.json({
          found: true,
          source: "DRIVE",
          message: "Fórmula encontrada en Drive",
          snapshot: { ...r.ref, driveChecksum: r.ref.versionHash },
          materials: r.materials,
          procedureSteps: r.procedureSteps,
          persistenceReady: isDatabaseConfigured(),
        });
      }
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

/** Guarda el vínculo cliente + producto (del trabajo de la OE) → archivo elegido a mano. Solo Producción/Dirección. */
async function rememberManualChoice(actor: { email: string; sector: string }, fileId: string, orderId: string) {
  if (!orderId || !["PRODUCCION", "DIRECCION"].includes(actor.sector)) return null;
  const src = await import("@/lib/formulas/drive-formula-source");
  if (!(await src.isNewFormulaSourceValidated())) return null;
  const f = await src.getIndexedFile(fileId);
  if (!f || f.removedAt) return null;
  const { getDb } = await import("@/lib/db/client");
  const { sql } = await import("drizzle-orm");
  const [w] = (await getDb().execute(sql`
    select w.client, w.product from operational_orders o
      join work_items w on (w.id::text = o.linked_work_item_id or (coalesce(o.linked_work_item_id, '') = '' and w.order_id = o.id))
     where o.id = ${orderId}::uuid and o.type = 'OE' limit 1`)).rows as Array<{ client: string | null; product: string | null }>;
  if (!w?.client?.trim() || !w.product?.trim()) return null;
  const link = await src.linkFormula(actor, { client: w.client, product: w.product, fileId, note: "Elegida desde la OE" });
  return { client: link.clientLabel, product: link.productLabel, fileName: link.fileName };
}
