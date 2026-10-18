import { NextResponse } from "next/server";
import { inventoryErrorResponse, resolveInventoryActor } from "@/lib/inventory/http";
import { InventoryForbiddenError, InventoryValidationError } from "@/lib/inventory/inventory-service";
import { probeExtraction } from "@/lib/inventory/receipt-extraction";
import { parseReceiptModule } from "@/lib/inventory/receipt-rules";
import { getReceiptService, ReceiptError } from "@/lib/inventory/receipt-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** La lectura del remito con Gemini puede tardar: sin esto Vercel corta la función antes de que responda. */
export const maxDuration = 60;

function fail(err: unknown) {
  if (err instanceof ReceiptError) return NextResponse.json({ error: err.message, code: err.code, ...err.details }, { status: err.status });
  return inventoryErrorResponse(err);
}

/**
 * Ingreso con remito (MP / ME). GET ?module=MP|ME&view=
 *  - config: ¿está activa la lectura automática? (sin enviar nada)
 *  - list: historial de recepciones del módulo
 *  - get&id=: una recepción (borrador o confirmada) con archivos, líneas y movimientos
 *  - catalog&q=: catálogo real para elegir el material
 *  - analyze&id=: revisión del borrador (campos a corregir, sugerencias, advertencias de duplicado). No escribe nada.
 */
export async function GET(request: Request) {
  try {
    const actor = await resolveInventoryActor(request);
    const url = new URL(request.url);
    const mod = parseReceiptModule(url.searchParams.get("module"));
    if (!mod) throw new InventoryValidationError("Módulo inválido (MP o ME).");
    const svc = getReceiptService();
    const view = url.searchParams.get("view") ?? "list";
    const id = url.searchParams.get("id") ?? "";
    if (view === "config") {
      const cfg = svc.config();
      return NextResponse.json({ extraction: { available: cfg.available, reason: cfg.reason, code: cfg.code } });
    }
    if (view === "extraction_health") {
      // Solo supervisión (Dirección / Producción / superadmin): prueba la clave y el modelo SIN enviar ningún remito.
      if (!actor.isSuperadmin && actor.sector !== "DIRECCION" && actor.sector !== "PRODUCCION") throw new InventoryForbiddenError("Solo Dirección o Producción pueden probar la lectura automática.");
      return NextResponse.json({ health: await probeExtraction() });
    }
    if (view === "catalog") return NextResponse.json({ items: await svc.catalog(actor, mod, url.searchParams.get("q") ?? "") });
    if (view === "get") return NextResponse.json({ receipt: await svc.get(actor, id, mod) });
    if (view === "analyze") return NextResponse.json({ analysis: await svc.analyze(actor, id, mod) });
    return NextResponse.json({ items: await svc.list(actor, mod) });
  } catch (err) {
    return fail(err);
  }
}

/** Acciones: create | save | extract | confirm | discard | remove_file. Cada una vuelve a validar permisos y sector en el servidor. */
export async function POST(request: Request) {
  try {
    const actor = await resolveInventoryActor(request);
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body.action !== "string") throw new InventoryValidationError("Pedido inválido.");
    const mod = parseReceiptModule(body.module);
    if (!mod) throw new InventoryValidationError("Módulo inválido (MP o ME).");
    const svc = getReceiptService();
    const id = String(body.id ?? "");
    switch (body.action) {
      case "create":
        return NextResponse.json({ receipt: await svc.createDraft(actor, mod) }, { status: 201 });
      case "save":
        return NextResponse.json({ receipt: await svc.saveDraft(actor, id, mod, { expectedVersion: Number(body.expectedVersion), header: body.header, lines: body.lines }) });
      case "extract":
        return NextResponse.json(await svc.extract(actor, id, mod, { replace: body.replace === true }));
      case "confirm":
        return NextResponse.json(
          { receipt: await svc.confirm(actor, id, mod, { expectedVersion: Number(body.expectedVersion), confirmKey: String(body.confirmKey ?? ""), acknowledgeDuplicates: body.acknowledgeDuplicates === true, parentReceiptId: typeof body.parentReceiptId === "string" ? body.parentReceiptId : null }) },
          { status: 200 }
        );
      case "discard":
        await svc.discard(actor, id, mod);
        return NextResponse.json({ ok: true });
      case "remove_file":
        await svc.removeFile(actor, id, mod, String(body.fileId ?? ""));
        return NextResponse.json({ ok: true });
      default:
        throw new InventoryValidationError("Acción desconocida.");
    }
  } catch (err) {
    return fail(err);
  }
}
