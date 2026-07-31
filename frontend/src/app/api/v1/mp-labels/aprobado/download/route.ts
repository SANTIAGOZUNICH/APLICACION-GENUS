import { NextResponse } from "next/server";
import { canReadInventory } from "@/lib/inventory/rbac";
import type { SectorId } from "@/types/operational/sector";
import {
  mapMpIngresoToLabelData,
  mpAprobadoLabelFilename,
  mpLabelContentDisposition,
  type MpAprobadoLabelSource,
} from "@/lib/inventory/mp-aprobado-label";
import { buildMpAprobadoLabelPdfBuffer } from "@/lib/inventory/mp-aprobado-label-pdf";
import {
  issueMpLabelDownloadTicket,
  mpLabelTicketDownloadPath,
  verifyMpLabelDownloadTicket,
} from "@/lib/inventory/mp-aprobado-label-ticket";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { ordersErrorResponse } from "@/lib/orders/http";
import {
  OrdersForbiddenError,
  OrdersValidationError,
} from "@/lib/orders/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function pdfAttachmentResponse(buffer: Buffer, filename: string) {
  const headers = new Headers();
  headers.set("Content-Type", "application/pdf");
  headers.set("Content-Disposition", mpLabelContentDisposition(filename));
  headers.set("Cache-Control", "private, no-store");
  headers.set("Content-Length", String(buffer.byteLength));
  return new NextResponse(new Uint8Array(buffer), { status: 200, headers });
}

function ticketError(err: unknown): NextResponse {
  if (err instanceof OrdersValidationError || err instanceof OrdersForbiddenError) {
    return ordersErrorResponse(err);
  }
  if (err instanceof Error) {
    return ordersErrorResponse(new OrdersValidationError(err.message));
  }
  return ordersErrorResponse(err);
}

/**
 * GET — descarga nativa vía ticket firmado (Safari iOS).
 * Query: ?t=<token>
 * No confía en parámetros de etiqueta del cliente: solo el payload firmado.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const token = url.searchParams.get("t")?.trim() ?? "";
    if (!token) {
      throw new OrdersValidationError("Ticket requerido.");
    }
    const payload = verifyMpLabelDownloadTicket(token);
    const sector = payload.sector as SectorId;
    if (!canReadInventory(sector, "mp_ingresos")) {
      throw new OrdersForbiddenError("Sin acceso a Ingresos MP.");
    }
    const buffer = await buildMpAprobadoLabelPdfBuffer(payload.data);
    return pdfAttachmentResponse(buffer, payload.filename);
  } catch (err) {
    return ticketError(err);
  }
}

/**
 * POST — dos modos:
 * 1) mode=ticket → JSON { downloadUrl, filename, expiresAt } (auth actor)
 * 2) default → bytes PDF (auth actor) para flujo Blob en desktop
 *
 * No muta inventario.
 */
export async function POST(request: Request) {
  try {
    const actor = resolveOrdersActor(request);
    if (!canReadInventory(actor.sector, "mp_ingresos")) {
      throw new OrdersForbiddenError("Sin acceso a Ingresos MP.");
    }

    const body = (await request.json().catch(() => null)) as
      | (MpAprobadoLabelSource & { filename?: string; mode?: string })
      | null;
    if (!body || typeof body !== "object") {
      throw new OrdersValidationError("Body JSON requerido.");
    }

    const mode = typeof body.mode === "string" ? body.mode.trim().toLowerCase() : "";

    if (mode === "ticket") {
      const issued = issueMpLabelDownloadTicket({
        email: actor.email,
        sector: actor.sector,
        source: body,
        filename: body.filename,
      });
      return NextResponse.json(
        {
          downloadUrl: mpLabelTicketDownloadPath(issued.token),
          filename: issued.filename,
          expiresAt: issued.expiresAt,
        },
        {
          status: 200,
          headers: { "Cache-Control": "private, no-store" },
        }
      );
    }

    const data = mapMpIngresoToLabelData(body);
    const filename =
      (typeof body.filename === "string" && body.filename.trim()) ||
      mpAprobadoLabelFilename(data);
    const buffer = await buildMpAprobadoLabelPdfBuffer(data);

    // Desktop Blob path: octet-stream en HTTP; el cliente fuerza type application/pdf.
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
