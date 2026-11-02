import { addMaterial, getProductConfig } from "@/lib/me-control/service";
import { jsonBody, run } from "../_util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const u = new URL(request.url);
  return run(request, (actor) => getProductConfig(actor, u.searchParams.get("client") ?? "", u.searchParams.get("product") ?? ""));
}

/** Agrega un material (o un rol pendiente) a un producto — solo Depósito. */
export async function POST(request: Request) {
  return run(
    request,
    async (actor) => {
      const b = await jsonBody(request);
      return addMaterial(actor, { client: String(b.client ?? ""), product: String(b.product ?? ""), materialCodigo: b.materialCodigo == null ? null : String(b.materialCodigo), role: b.role == null ? undefined : String(b.role), qtyPerUnit: b.qtyPerUnit as number | string | undefined, required: typeof b.required === "boolean" ? b.required : undefined });
    },
    201
  );
}
