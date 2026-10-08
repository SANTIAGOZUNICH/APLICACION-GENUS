/**
 * Prioridades de Semanas contra un Postgres de PRUEBA real (mismo SQL que Neon): migración 0041, persistencia,
 * concurrencia, auditoría y degradación si la tabla no existe. Se SALTA sin base local marcada (ver scripts/e2e/e2e-safety.mjs).
 * Se corre con `npm run test:e2e:semanas-priorities-db` (levanta Postgres descartable + proxy y limpia al final).
 */
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { assertMarkedDatabase, e2eEnvironmentProblem } from "../../scripts/e2e/e2e-safety.mjs";
import type { CalendarCell, CalendarWeek } from "@/lib/semanas-sheet/calendar-model";

const PROBLEM = e2eEnvironmentProblem() ?? (process.env.GENUS_E2E_DATABASE_URL ? null : "falta GENUS_E2E_DATABASE_URL");
const COLS = "BDFHJ";
const cell = (a1: string, value = "", extra: Partial<CalendarCell> = {}): CalendarCell => ({ a1, value, covered: false, span: 1, rowSpan: 1, protection: null, date: null, ...extra });
const cov = (a1: string): CalendarCell => cell(a1, "", { covered: true });
const week = (startRow = 4): CalendarWeek => {
  const rows: CalendarWeek["rows"] = [];
  let r = startRow;
  rows.push({ rowNumber: r, role: "planning", cells: [cell(`B${r}`, "CRISTIAN", { span: 5 }), ...[1, 2, 3, 4].map((d) => cov(`${COLS[d]}${r}`))] });
  r += 1;
  const days = [["THELMA", "ALC EN GEL 300KG", "", "UNICA", "CREMA", "160KG"], ["TYL", "CREMA 95kg", "ENTREGA 7/5"], [], [], []];
  for (let i = 0; i < 6; i += 1) {
    rows.push({ rowNumber: r, role: "planning", cells: days.map((lines, d) => cell(`${COLS[d]}${r}`, lines[i] ?? "")) });
    r += 1;
  }
  return { id: "1", headerRow: startRow - 3, lastRow: r, dates: ["2026-05-04", "2026-05-05", "2026-05-06", "2026-05-07", "2026-05-08"], label: "x", rows };
};
const prod = { email: "it-prod@laboratoriogenus.com.ar", sector: "PRODUCCION" as const, displayName: "IT Producción" };
const SID = "it-copia-semanas";

describe.skipIf(Boolean(PROBLEM))(`Prioridades de Semanas en Postgres real${PROBLEM ? ` — saltado: ${PROBLEM}` : ""}`, () => {
  let pool: import("@neondatabase/serverless").Pool;
  const q = async (text: string, params: unknown[] = []) => (await pool.query(text, params)).rows as Record<string, unknown>[];

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.GENUS_E2E_DATABASE_URL!;
    const { Pool, neonConfig } = await import("@neondatabase/serverless");
    neonConfig.webSocketConstructor = (await import("ws")).default as never;
    pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
    await assertMarkedDatabase(q);
    vi.resetModules();
  });
  afterAll(async () => {
    await q("delete from semanas_task_priorities where spreadsheet_id = $1", [SID]).catch(() => undefined);
    await q("delete from semanas_task_priority_events where spreadsheet_id = $1", [SID]).catch(() => undefined);
    await pool?.end();
  });

  it("la migración 0041 es idempotente (2 aplicaciones) y exige una prioridad válida", async () => {
    const sql = fs.readFileSync(path.resolve(__dirname, "../../drizzle/0041_semanas_task_priorities.sql"), "utf8");
    for (let i = 0; i < 2; i += 1) for (const st of sql.split("--> statement-breakpoint")) if (st.trim()) await q(st);
    const idx = (await q("select indexname from pg_indexes where tablename = 'semanas_task_priorities'")).map((r) => r.indexname);
    expect(idx).toEqual(expect.arrayContaining(["semanas_task_priorities_key_uidx", "semanas_task_priorities_pos_idx"]));
    await expect(q("insert into semanas_task_priorities (spreadsheet_id,tab,task_key,priority,updated_by,updated_by_sector) values ('x','t','k','CRITICA','u','PRODUCCION')")).rejects.toThrow(/check|priority/i);
  });

  it("guarda la prioridad en la base, queda tras reiniciar el módulo (otra instancia), audita y respeta concurrencia", async () => {
    const svc = await import("@/lib/semanas-sheet/semanas-priorities-service");
    const { buildWeekModel } = await import("@/lib/semanas-sheet/calendar-tasks");
    const w = week();
    const tasks = buildWeekModel(w, "ELABORACION").sections.flatMap((s) => s.tasks);
    const t = tasks[1]!;
    const saved = await svc.setTaskPriority(prod, { spreadsheetId: SID, tab: "ELABORACION", taskKey: t.key, priority: "URGENTE", expectedVersion: 0 }, [w]);
    expect(saved).toMatchObject({ priority: "URGENTE", version: 1, updatedBy: prod.email });
    // "otra instancia": módulos nuevos, lectura desde la base
    vi.resetModules();
    const again = await import("@/lib/semanas-sheet/semanas-priorities-service");
    const loaded = await again.loadPriorities(SID, "ELABORACION", [week(40)]); // planilla con 36 filas insertadas arriba
    expect(loaded.available).toBe(true);
    expect(loaded.byTask[t.key]!.priority).toBe("URGENTE");
    // conflicto: misma versión vieja
    await expect(again.setTaskPriority(prod, { spreadsheetId: SID, tab: "ELABORACION", taskKey: t.key, priority: "IMPORTANTE", expectedVersion: 0 }, [w])).rejects.toMatchObject({ status: 409 });
    const ok = await again.setTaskPriority(prod, { spreadsheetId: SID, tab: "ELABORACION", taskKey: t.key, priority: "NORMAL", expectedVersion: 1 }, [w]);
    expect(ok.version).toBe(2);
    const events = await q("select from_priority, to_priority, actor_email, actor_sector from semanas_task_priority_events where spreadsheet_id = $1 order by created_at", [SID]);
    expect(events).toEqual([
      { from_priority: "NORMAL", to_priority: "URGENTE", actor_email: prod.email, actor_sector: "PRODUCCION" },
      { from_priority: "URGENTE", to_priority: "NORMAL", actor_email: prod.email, actor_sector: "PRODUCCION" },
    ]);
  });

  it("dos escrituras simultáneas con la misma versión: una gana y la otra recibe conflicto (sin duplicar filas)", async () => {
    const svc = await import("@/lib/semanas-sheet/semanas-priorities-service");
    const { buildWeekModel } = await import("@/lib/semanas-sheet/calendar-tasks");
    const w = week();
    const t = buildWeekModel(w, "ELABORACION").sections.flatMap((s) => s.tasks)[2]!;
    const run = (p: "URGENTE" | "IMPORTANTE") => svc.setTaskPriority(prod, { spreadsheetId: SID, tab: "ELABORACION", taskKey: t.key, priority: p, expectedVersion: 0 }, [w]).then(() => "ok", (e: { status?: number }) => `err${e.status}`);
    const res = await Promise.all([run("URGENTE"), run("IMPORTANTE")]);
    expect(res.filter((r) => r === "ok")).toHaveLength(1);
    expect(res.filter((r) => r === "err409")).toHaveLength(1);
    const rows = await q("select count(*)::int as n from semanas_task_priorities where spreadsheet_id = $1 and task_key = $2", [SID, t.key]);
    expect(rows[0]!.n).toBe(1);
  });

  it("si la tabla no existe (migración pendiente) la vista no falla: available=false y guardar informa 503", async () => {
    await q("alter table semanas_task_priorities rename to semanas_task_priorities_tmp");
    try {
      vi.resetModules();
      const svc = await import("@/lib/semanas-sheet/semanas-priorities-service");
      const { buildWeekModel } = await import("@/lib/semanas-sheet/calendar-tasks");
      const w = week();
      expect((await svc.loadPriorities(SID, "ELABORACION", [w])).available).toBe(false);
      const t = buildWeekModel(w, "ELABORACION").sections.flatMap((s) => s.tasks)[0]!;
      await expect(svc.setTaskPriority(prod, { spreadsheetId: SID, tab: "ELABORACION", taskKey: t.key, priority: "URGENTE", expectedVersion: 0 }, [w])).rejects.toMatchObject({ status: 503 });
    } finally {
      await q("alter table semanas_task_priorities_tmp rename to semanas_task_priorities");
    }
  });
});
