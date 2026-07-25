import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { canAdminCoas } from "@/lib/coa/types";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { ordersErrorResponse } from "@/lib/orders/http";
import { OrdersForbiddenError, OrdersValidationError } from "@/lib/orders/types";
import {
  FILE_STORAGE_NOT_CONFIGURED,
  isPrivateFileStorageConfigured,
  safeFileName,
} from "@/lib/storage/file-storage";
import { COA_ALLOWED_EXT, COA_MAX_BYTES } from "@/lib/coa/drive-write";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Emite token temporal de upload cliente → Blob privado.
 * Nunca envía BLOB_READ_WRITE_TOKEN al navegador.
 * POST /api/v1/coas/upload-token
 */
export async function POST(request: Request) {
  try {
    const actor = resolveOrdersActor(request);
    if (!canAdminCoas(actor.sector)) {
      throw new OrdersForbiddenError("Solo MP administra COA'S.");
    }
    if (!isPrivateFileStorageConfigured()) {
      throw new OrdersValidationError(FILE_STORAGE_NOT_CONFIGURED);
    }

    const body = (await request.json()) as HandleUploadBody;
    const json = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        const name = pathname.split("/").pop() ?? "";
        const ext = name.split(".").pop()?.toLowerCase() ?? "";
        if (!COA_ALLOWED_EXT.has(ext)) {
          throw new Error(`Extensión no permitida: .${ext}`);
        }
        if (pathname.includes("..") || !pathname.startsWith("coas/")) {
          throw new Error("pathname inválido");
        }
        return {
          allowedContentTypes: [
            "application/pdf",
            "application/vnd.ms-excel",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "text/csv",
            "text/plain",
          ],
          maximumSizeInBytes: COA_MAX_BYTES,
          addRandomSuffix: false,
          tokenPayload: JSON.stringify({
            actorEmail: actor.email,
            actorSector: actor.sector,
            safeName: safeFileName(name),
          }),
        };
      },
      onUploadCompleted: async () => {
        // Metadata Neon se confirma vía POST /api/v1/coa (upload/confirm).
      },
    });

    return NextResponse.json(json);
  } catch (err) {
    return ordersErrorResponse(err);
  }
}
