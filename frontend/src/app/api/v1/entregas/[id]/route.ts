import { NextResponse } from "next/server";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { entregasService } from "@/lib/entregas/service";
import { entregasErrorResponse } from "@/lib/entregas/http";
import { OrdersValidationError } from "@/lib/orders/types";
import type { DeliveryInput } from "@/lib/entregas/rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Detalle de una entrega + diferencias con sus trabajos vinculados + historial. */
export async function GET(request: Request, ctx: Ctx) {
  try {
    const actor = await resolveOrdersActor(request);
    const { id } = await ctx.params;
    const delivery = await entregasService.get(actor, id);
    const history = await entregasService.history(actor, id);
    const deletedItems = await entregasService.deletedItems(actor, id);
    return NextResponse.json({ delivery, divergences: entregasService.divergencesFor(delivery), history, deletedItems });
  } catch (err) {
    return entregasErrorResponse(err);
  }
}

type Body = {
  action?: string;
  expectedVersion?: number;
  input?: DeliveryInput;
  newDate?: string;
  reason?: string;
  itemId?: string;
  workItemId?: string;
  linkId?: string;
  fields?: string[];
};

/** Modificar, reprogramar (la entrega o un solo producto), cancelar/restaurar, quitar/restaurar productos, vincular/desvincular trabajos y aplicar cambios a un trabajo (con confirmación). */
export async function PATCH(request: Request, ctx: Ctx) {
  try {
    const actor = await resolveOrdersActor(request);
    const { id } = await ctx.params;
    const body = (await request.json().catch(() => null)) as Body | null;
    if (!body?.action) throw new OrdersValidationError("action es obligatoria.");
    const version = Number(body.expectedVersion);
    const needVersion = () => {
      if (!Number.isInteger(version)) throw new OrdersValidationError("Falta la versión de la entrega (expectedVersion).");
      return version;
    };
    switch (body.action) {
      case "update":
        if (!body.input) throw new OrdersValidationError("Faltan los datos de la entrega.");
        return NextResponse.json({ delivery: await entregasService.update(actor, id, body.input, needVersion()) });
      case "reschedule":
        return NextResponse.json({ delivery: await entregasService.reschedule(actor, id, String(body.newDate ?? ""), body.reason, needVersion()) });
      case "cancel":
        return NextResponse.json({ delivery: await entregasService.cancel(actor, id, body.reason, needVersion()) });
      case "restore":
        return NextResponse.json({ delivery: await entregasService.restore(actor, id, body.reason, needVersion()) });
      case "move_item": {
        const r = await entregasService.moveItem(actor, id, String(body.itemId ?? ""), String(body.newDate ?? ""), body.reason, needVersion());
        return NextResponse.json({ delivery: r.source, target: r.target });
      }
      case "delete_item":
        return NextResponse.json({ delivery: await entregasService.deleteItem(actor, id, String(body.itemId ?? ""), body.reason, needVersion()) });
      case "restore_item":
        return NextResponse.json({ delivery: await entregasService.restoreItem(actor, id, String(body.itemId ?? ""), body.reason) });
      case "link":
        return NextResponse.json({ delivery: await entregasService.linkWork(actor, String(body.itemId ?? ""), String(body.workItemId ?? "")) });
      case "unlink":
        return NextResponse.json({ delivery: await entregasService.unlinkWork(actor, String(body.linkId ?? ""), body.reason) });
      case "apply_to_work": {
        const r = await entregasService.applyToWork(actor, String(body.linkId ?? ""), Array.isArray(body.fields) ? body.fields.map(String) : [], body.reason);
        return NextResponse.json(r);
      }
      case "keep":
        return NextResponse.json({ delivery: await entregasService.keepWorkAsIs(actor, String(body.linkId ?? ""), Array.isArray(body.fields) ? body.fields.map(String) : [], body.reason) });
      default:
        throw new OrdersValidationError("action desconocida.");
    }
  } catch (err) {
    return entregasErrorResponse(err);
  }
}
