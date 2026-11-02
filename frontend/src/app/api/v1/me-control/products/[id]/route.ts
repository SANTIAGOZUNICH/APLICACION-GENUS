import { confirmRow, rejectRow, removeRow, replaceRow, updateRow } from "@/lib/me-control/service";
import { OrdersValidationError } from "@/lib/orders/types";
import { jsonBody, run } from "../../_util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Acciones sobre un material del producto: confirm | reject | replace | update — solo Depósito. */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return run(request, async (actor) => {
    const b = await jsonBody(request);
    switch (String(b.action ?? "")) {
      case "confirm":
        return confirmRow(actor, id, { qtyPerUnit: b.qtyPerUnit as number | string | undefined });
      case "reject":
        return rejectRow(actor, id);
      case "replace":
        return replaceRow(actor, id, String(b.materialCodigo ?? ""));
      case "update":
        return updateRow(actor, id, { qtyPerUnit: b.qtyPerUnit as number | string | undefined, required: typeof b.required === "boolean" ? b.required : undefined });
      default:
        throw new OrdersValidationError("Acción inválida.");
    }
  });
}

export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return run(request, (actor) => removeRow(actor, id));
}
