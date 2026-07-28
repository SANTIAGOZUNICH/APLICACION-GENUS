import { NextResponse } from "next/server";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { canManageFormulas, FORMULA_ADMIN_DENIED_MESSAGE } from "@/lib/formulas/formula-admin-rbac";
import {
  FormulaBankConflictError,
  FormulaBankForbiddenError,
  FormulaBankNotFoundError,
  FormulaBankValidationError,
} from "@/lib/formulas/formula-bank-service";
import { readyFormulaBank, persistFormulaBankIfConfigured } from "@/lib/formulas/get-formula-bank";
import { findFormulaUsageRefs } from "@/lib/formulas/formula-usage";
import { OrdersForbiddenError, OrdersValidationError } from "@/lib/orders/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function formulaErrorResponse(err: unknown) {
  if (err instanceof FormulaBankForbiddenError) {
    return NextResponse.json({ error: err.message, code: err.code }, { status: 403 });
  }
  if (err instanceof FormulaBankNotFoundError) {
    return NextResponse.json({ error: err.message, code: err.code }, { status: 404 });
  }
  if (err instanceof FormulaBankConflictError) {
    return NextResponse.json(
      { error: err.message, code: err.code, usageRefs: err.usageRefs ?? [] },
      { status: 409 }
    );
  }
  if (err instanceof FormulaBankValidationError) {
    return NextResponse.json({ error: err.message, code: err.code }, { status: 400 });
  }
  if (err instanceof OrdersForbiddenError) {
    return NextResponse.json({ error: err.message, code: "ACTOR_FORBIDDEN" }, { status: 403 });
  }
  if (err instanceof OrdersValidationError) {
    return NextResponse.json({ error: err.message, code: "ACTOR_INVALID" }, { status: 400 });
  }
  const message = err instanceof Error ? err.message : "Error";
  return NextResponse.json({ error: message }, { status: 500 });
}

/** Listado administrativo (metadata; sin ingredientes). */
export async function GET(request: Request) {
  try {
    const actor = resolveOrdersActor(request);
    if (!canManageFormulas(actor.sector)) {
      return NextResponse.json({ error: FORMULA_ADMIN_DENIED_MESSAGE, code: "FORBIDDEN" }, { status: 403 });
    }
    const url = new URL(request.url);
    const q = (url.searchParams.get("q") || "").trim();
    const includeArchived = url.searchParams.get("includeArchived") === "1";
    const limitRaw = Number(url.searchParams.get("limit") || "200");
    const limit = Number.isFinite(limitRaw)
      ? Math.min(Math.max(Math.floor(limitRaw), 1), 500)
      : 200;

    const bank = await readyFormulaBank();
    const entries = bank.listAdminEntries({ query: q, includeArchived, limit });
    return NextResponse.json({
      entries,
      total: entries.length,
      includeArchived,
    });
  } catch (err) {
    return formulaErrorResponse(err);
  }
}

/** Archivar / restaurar / eliminar definitivamente (con motivo). */
export async function POST(request: Request) {
  try {
    const actor = resolveOrdersActor(request);
    if (!canManageFormulas(actor.sector)) {
      return NextResponse.json({ error: FORMULA_ADMIN_DENIED_MESSAGE, code: "FORBIDDEN" }, { status: 403 });
    }

    const body = (await request.json()) as {
      action?: "archive" | "restore" | "delete";
      productId?: string;
      reason?: string;
      actorSectorId?: string;
    };

    if (body.actorSectorId && body.actorSectorId !== actor.sector) {
      return NextResponse.json(
        { error: "El sector enviado no coincide con la sesión del actor.", code: "ACTOR_FORBIDDEN" },
        { status: 403 }
      );
    }

    const productId = body.productId?.trim();
    if (!productId) {
      return NextResponse.json({ error: "productId es obligatorio.", code: "VALIDATION" }, { status: 400 });
    }
    const reason = body.reason?.trim() ?? "";
    if (!reason) {
      return NextResponse.json({ error: "Motivo obligatorio.", code: "REASON_REQUIRED" }, { status: 400 });
    }

    const bank = await readyFormulaBank();
    const actorInput = {
      productId,
      reason,
      actorEmail: actor.email,
      actorSector: actor.sector,
    };

    if (body.action === "archive") {
      const entry = bank.archiveFormula(actorInput);
      await persistFormulaBankIfConfigured();
      return NextResponse.json({ ok: true, action: "archive", entry });
    }

    if (body.action === "restore") {
      const entry = bank.restoreFormula(actorInput);
      await persistFormulaBankIfConfigured();
      return NextResponse.json({ ok: true, action: "restore", entry });
    }

    if (body.action === "delete") {
      const result = await bank.deleteFormulaPermanently(actorInput, findFormulaUsageRefs);
      await persistFormulaBankIfConfigured();
      return NextResponse.json({ ok: true, action: "delete", ...result });
    }

    return NextResponse.json({ error: "Acción no soportada.", code: "UNKNOWN_ACTION" }, { status: 400 });
  } catch (err) {
    return formulaErrorResponse(err);
  }
}
