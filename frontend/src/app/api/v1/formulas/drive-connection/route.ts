/**
 * «Conexión con Google Drive» (módulo de fórmulas) — SOLO LECTURA.
 *  - GET ?mode=check → «Verificar conexión»: cuenta, carpeta, unidad, acceso, estado del índice.
 *  - GET            → diagnóstico completo: árbol de la carpeta, archivos omitidos y por qué, planillas fuera de la
 *                     carpeta, comparación con el banco de fórmulas.
 *  - POST { action: "refresh" } → «Actualizar índice»: rehace el índice en memoria y devuelve el diagnóstico.
 * Solo sectores que administran fórmulas. Nunca devuelve claves ni modifica Drive o el banco.
 */
import { NextResponse } from "next/server";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { canManageFormulas, FORMULA_ADMIN_DENIED_MESSAGE } from "@/lib/formulas/formula-admin-rbac";
import { AuthUnauthorizedError } from "@/lib/auth/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function authorize(request: Request) {
  const actor = await resolveOrdersActor(request);
  if (!canManageFormulas(actor.sector)) {
    return NextResponse.json({ error: FORMULA_ADMIN_DENIED_MESSAGE }, { status: 403 });
  }
  return null;
}

const fail = () =>
  NextResponse.json({ error: "No se pudo completar el diagnóstico de Google Drive. Reintentá en unos minutos." }, { status: 500 });

export async function GET(request: Request) {
  try {
    const denied = await authorize(request);
    if (denied) return denied;
    const mode = new URL(request.url).searchParams.get("mode");
    const { checkDriveConnection, diagnoseDriveConnection } = await import("@/lib/formulas/drive-connection");
    if (mode === "check") {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { drive, ...check } = await checkDriveConnection();
      return NextResponse.json({ check });
    }
    return NextResponse.json({ report: await diagnoseDriveConnection() });
  } catch (err) {
    if (err instanceof AuthUnauthorizedError) return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    return fail();
  }
}

export async function POST(request: Request) {
  try {
    const denied = await authorize(request);
    if (denied) return denied;
    const body = (await request.json().catch(() => ({}))) as { action?: string };
    if (body.action !== "refresh") return NextResponse.json({ error: "Acción inválida." }, { status: 400 });
    const { diagnoseDriveConnection } = await import("@/lib/formulas/drive-connection");
    return NextResponse.json({ report: await diagnoseDriveConnection({ refreshIndex: true }) });
  } catch (err) {
    if (err instanceof AuthUnauthorizedError) return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    return fail();
  }
}
