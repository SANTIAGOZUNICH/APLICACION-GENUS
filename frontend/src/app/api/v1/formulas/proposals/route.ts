import { NextResponse } from "next/server";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { readyFormulaBank, persistFormulaBankIfConfigured } from "@/lib/formulas/get-formula-bank";
import { randomUUID } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Propuesta de nueva versión desde OE (MP propone; Calidad/Producción aprueban). */
export async function POST(request: Request) {
  try {
    const actor = resolveOrdersActor(request);
    const bank = await readyFormulaBank();
    const body = (await request.json()) as {
      action: "propose" | "approve" | "reject";
      client?: string;
      product?: string;
      productCode?: string;
      reason?: string;
      versionId?: string;
      ingredients?: {
        materialName: string;
        materialCodeOrPhase: string;
        percentage: number | null;
      }[];
      procedureSteps?: { instruction: string }[];
    };

    if (body.action === "propose") {
      if (!["MATERIA_PRIMA", "CALIDAD", "PRODUCCION", "DIRECCION"].includes(actor.sector)) {
        return NextResponse.json({ error: "Sin permiso para proponer" }, { status: 403 });
      }
      if (!(body.reason ?? "").trim()) {
        return NextResponse.json({ error: "Motivo obligatorio" }, { status: 400 });
      }
      const ver = bank.proposeNewVersionFromOe({
        client: body.client ?? "",
        product: body.product ?? "",
        productCode: body.productCode,
        reason: body.reason ?? "",
        actorEmail: actor.email,
        actorSector: actor.sector,
        ingredients: (body.ingredients ?? []).map((i, idx) => ({
          id: randomUUID(),
          position: idx + 1,
          materialName: i.materialName,
          materialCodeOrPhase: i.materialCodeOrPhase,
          percentage: i.percentage,
          notes: "",
        })),
        procedureSteps: (body.procedureSteps ?? []).map((s, idx) => ({
          id: randomUUID(),
          position: idx + 1,
          instruction: s.instruction,
        })),
      });
      await persistFormulaBankIfConfigured();
      return NextResponse.json({ proposalVersionId: ver.id, status: ver.status });
    }

    if (body.action === "approve") {
      if (!["CALIDAD", "PRODUCCION", "DIRECCION"].includes(actor.sector)) {
        return NextResponse.json({ error: "Sin permiso para aprobar" }, { status: 403 });
      }
      if (!body.versionId) {
        return NextResponse.json({ error: "versionId requerido" }, { status: 400 });
      }
      const ver = bank.approveProposal(body.versionId);
      await persistFormulaBankIfConfigured();
      return NextResponse.json({ versionId: ver.id, status: ver.status });
    }

    if (body.action === "reject") {
      if (!["CALIDAD", "PRODUCCION", "DIRECCION"].includes(actor.sector)) {
        return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
      }
      if (!body.versionId) {
        return NextResponse.json({ error: "versionId requerido" }, { status: 400 });
      }
      const ver = bank.getVersionForAuthorizedOrder(body.versionId);
      if (!ver) {
        return NextResponse.json({ error: "Propuesta no encontrada" }, { status: 404 });
      }
      // Rechazo: mantener BORRADOR_PROPUESTA sin activar; auditoría mínima en respuesta.
      await persistFormulaBankIfConfigured();
      return NextResponse.json({
        rejected: true,
        versionId: body.versionId,
        decidedBy: actor.email,
        decidedAt: new Date().toISOString(),
        reason: body.reason ?? null,
      });
    }

    return NextResponse.json({ error: "Acción no soportada" }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Error" },
      { status: 500 }
    );
  }
}
