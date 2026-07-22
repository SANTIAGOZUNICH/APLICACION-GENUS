import { NextResponse } from "next/server";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { readyFormulaBank } from "@/lib/formulas/get-formula-bank";
import { getOrdersService } from "@/lib/orders/get-orders-service";
import { ensureOrdersPersistenceReady } from "@/lib/orders/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Obtiene la fórmula vinculada a una OE autorizada (orderId + versionId del snapshot).
 * No lista el banco.
 */
export async function GET(request: Request) {
  try {
    const blocked = ensureOrdersPersistenceReady();
    if (blocked) return blocked;

    const actor = resolveOrdersActor(request);
    const allowed = ["CALIDAD", "PRODUCCION", "MATERIA_PRIMA", "ELABORACION", "DIRECCION"];
    if (!allowed.includes(actor.sector)) {
      return NextResponse.json({ error: "Sector no autorizado" }, { status: 403 });
    }
    const url = new URL(request.url);
    const versionId = url.searchParams.get("versionId")?.trim();
    const orderId = url.searchParams.get("orderId")?.trim();
    if (!versionId || !orderId) {
      return NextResponse.json(
        { error: "orderId y versionId son requeridos" },
        { status: 400 }
      );
    }

    const order = await getOrdersService().getOrder(orderId, actor);
    if (!order) {
      return NextResponse.json({ error: "Orden no encontrada" }, { status: 404 });
    }
    if (order.formulaVersionId !== versionId) {
      return NextResponse.json(
        { error: "La versión no coincide con el snapshot de la orden" },
        { status: 403 }
      );
    }

    const bank = await readyFormulaBank();
    const snap = bank.getVersionForAuthorizedOrder(versionId);
    if (!snap) {
      return NextResponse.json({ error: "Fórmula no encontrada" }, { status: 404 });
    }
    return NextResponse.json({
      snapshot: {
        formulaProductId: snap.formulaProductId,
        formulaVersionId: snap.formulaVersionId,
        versionHash: snap.versionHash,
        displayClient: snap.displayClient,
        displayProduct: snap.displayProduct,
        productCode: snap.productCode,
        percentageTotal: snap.percentageTotal,
        ingredients: snap.ingredients,
        procedureSteps: snap.procedureSteps,
        specifications: snap.specifications,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Error" },
      { status: 500 }
    );
  }
}
