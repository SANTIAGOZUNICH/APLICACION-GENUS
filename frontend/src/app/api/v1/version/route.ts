import { NextResponse } from "next/server";
import { serverBuildSha } from "@/lib/asignacion-lotes/schema-status";

export const dynamic = "force-dynamic";

/**
 * Commit desplegado (solo el SHA, sin secretos). Lo consulta la app abierta para detectar que el servidor ya tiene
 * una versión más nueva que la que corre en la pestaña/PWA y ofrecer recargar: una pestaña que quedó abierta desde
 * antes de un deploy sigue ejecutando el código viejo (p. ej. con las filas de Google bloqueadas) hasta recargar.
 */
export function GET() {
  return NextResponse.json({ build: serverBuildSha() }, { headers: { "Cache-Control": "no-store" } });
}
