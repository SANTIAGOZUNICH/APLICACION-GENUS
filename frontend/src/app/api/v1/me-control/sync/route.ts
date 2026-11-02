import { syncMeControl } from "@/lib/me-control/service";
import { canViewMeControl } from "@/lib/me-control/service";
import { OrdersForbiddenError } from "@/lib/orders/types";
import { run } from "../_util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Fuerza el recálculo del control (sin IA). Idempotente: no duplica alertas. */
export async function POST(request: Request) {
  return run(request, async (actor) => {
    if (!canViewMeControl(actor)) throw new OrdersForbiddenError("Tu sector no puede consultar el Control de ME.");
    return syncMeControl({ ai: false });
  });
}
