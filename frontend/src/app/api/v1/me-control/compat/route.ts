import { setCompat } from "@/lib/me-control/service";
import { jsonBody, run } from "../_util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Registra que un envase y un accesorio son (o no) compatibles — solo Depósito. */
export async function POST(request: Request) {
  return run(request, async (actor) => {
    const b = await jsonBody(request);
    return setCompat(actor, { baseCodigo: String(b.baseCodigo ?? ""), accessoryCodigo: String(b.accessoryCodigo ?? ""), status: b.status === "INCOMPATIBLE" ? "INCOMPATIBLE" : "COMPATIBLE", note: b.note == null ? undefined : String(b.note) });
  });
}
