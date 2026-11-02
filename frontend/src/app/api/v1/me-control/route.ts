import { getWeekReport } from "@/lib/me-control/service";
import { syncMeControlIfStale } from "@/lib/me-control/service";
import { run } from "./_util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Control de ME de una semana (solo lectura): trabajos de Envasado, materiales, necesidades, stock y faltantes. */
export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("week") ?? "";
  const week = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : new Date().toISOString().slice(0, 10);
  return run(request, async (actor) => {
    const report = await getWeekReport(actor, week);
    await syncMeControlIfStale();
    return report;
  });
}
