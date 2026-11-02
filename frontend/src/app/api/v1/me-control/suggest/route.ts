import { suggestWithAi } from "@/lib/me-control/service";
import { jsonBody, run } from "../_util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** «Sugerir con IA» (Creamy OS) los accesorios de un producto — solo Depósito. Solo propone: nada queda confirmado. */
export async function POST(request: Request) {
  return run(request, async (actor) => {
    const b = await jsonBody(request);
    return suggestWithAi(actor, String(b.client ?? ""), String(b.product ?? ""));
  });
}
