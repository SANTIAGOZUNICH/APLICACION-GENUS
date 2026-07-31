import { NextResponse } from "next/server";
import { canReadInventory } from "@/lib/inventory/rbac";
import {
  mapMpIngresoToLabelData,
  mpAprobadoLabelFilename,
  mpLabelContentDisposition,
  type MpAprobadoLabelSource,
} from "@/lib/inventory/mp-aprobado-label";
import { buildMpAprobadoLabelPdfBuffer } from "@/lib/inventory/mp-aprobado-label-pdf";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { ordersErrorResponse } from "@/lib/orders/http";
import { OrdersForbiddenError, OrdersValidationError } from "@/lib/orders/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Genera y descarga la etiqueta PDF APROBADO MATERIA PRIMA.
 * Content-Type octet-stream + Content-Disposition attachment → Safari iPhone
 * no abre el visor ni reemplaza Genus OS.
 *
 * POST /api/v1/mp-labels/aprobado/download
 * Body: campos del ingreso / etiqueta (no muta inventario).
 */
export async function POST(request: Request) {
  try {
    const actor = resolveOrdersActor(request);
    if (!canReadInventory(actor.sector, "mp_ingresos")) {
      throw new OrdersForbiddenError("Sin acceso a Ingresos MP.");
    }

    const body = (await request.json().catch(() => null)) as
      | (MpAprobadoLabelSource & { filename?: string })
      | null;
    if (!body || typeof body !== "object") {
      throw new OrdersValidationError("Body JSON requerido.");
    }

    const data = mapMpIngresoToLabelData(body);
    const filename =
      (typeof body.filename === "string" && body.filename.trim()) ||
      mpAprobadoLabelFilename(data);

    const buffer = await buildMpAprobadoLabelPdfBuffer(data);

    const headers = new Headers();
    headers.set("Content-Type", "application/octet-stream");
    headers.set("Content-Disposition", mpLabelContentDisposition(filename));
    headers.set("Cache-Control", "private, no-store");
    headers.set("Content-Length", String(buffer.byteLength));

    return new NextResponse(new Uint8Array(buffer), { status: 200, headers });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}
