import { listAlerts } from "@/lib/me-control/service";
import { run } from "../_util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Alertas persistentes del Control de ME. `?status=all` incluye las cerradas. */
export async function GET(request: Request) {
  const all = new URL(request.url).searchParams.get("status") === "all";
  return run(request, (actor) => listAlerts(actor, { statuses: all ? ["ABIERTA", "CERRADA"] : ["ABIERTA"] }));
}
