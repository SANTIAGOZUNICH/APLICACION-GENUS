import { searchMaterials } from "@/lib/me-control/service";
import { run } from "../_util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Búsqueda libre en TODO el inventario de ME (código, descripción, cliente, producto). */
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q") ?? "";
  return run(request, async (actor) => ({ items: await searchMaterials(actor, q) }));
}
