import { closeAlert } from "@/lib/me-control/service";
import { run } from "../../../_util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Cierra la NOTIFICACIÓN (solo Depósito). No borra el faltante ni marca el material como recibido. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return run(request, (actor) => closeAlert(actor, id));
}
