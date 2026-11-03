/**
 * Comentarios del equipo por trabajo (migración 0078) contra un Postgres de PRUEBA real (mismo SQL que Neon).
 * Datos ficticios con cliente «IT-WC …»: nunca se toca nada real. Se SALTA sin base local marcada.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { assertMarkedDatabase, e2eEnvironmentProblem } from "../../scripts/e2e/e2e-safety.mjs";

const PROBLEM = e2eEnvironmentProblem() ?? (process.env.GENUS_E2E_DATABASE_URL ? null : "falta GENUS_E2E_DATABASE_URL");
const dep = { email: "it-dep@laboratoriogenus.com.ar", displayName: "Ana Depósito", sector: "DEPOSITO", sectorLabel: "Depósito" };
const env = { email: "it-env@laboratoriogenus.com.ar", displayName: "Beto Envasado", sector: "ENVASADO_MASIVO", sectorLabel: "Envasado Masivo" };
const prod = { email: "it-prod@laboratoriogenus.com.ar", displayName: "Cami Producción", sector: "PRODUCCION", sectorLabel: "Producción" };
const outsider = { email: "it-fact@laboratoriogenus.com.ar", displayName: "Fede Facturación", sector: "ADMINISTRACION", sectorLabel: "Administración" };
const CLIENT = "IT-WC AQUALO";

describe.skipIf(Boolean(PROBLEM))(`Comentarios por trabajo${PROBLEM ? ` — saltado: ${PROBLEM}` : ""}`, () => {
  let pool: import("@neondatabase/serverless").Pool;
  const q = async (text: string, params: unknown[] = []) => (await pool.query(text, params)).rows as Record<string, unknown>[];
  const svc = () => import("@/lib/work-item-comments/service");
  const job = async (over: { product?: string; date?: string; sector?: string; notes?: string | null } = {}) => {
    const sector = over.sector ?? "ENVASADO_MASIVO";
    const line = sector === "ELABORACION" || sector === "CODIFICADO" ? null : "Línea 1";
    const branch = sector === "ELABORACION" ? "Cristian" : null;
    return String((await q("insert into work_items (client, product, planned_quantity, unit, sector, line, branch_owner, status, created_by, planned_date, notes) values ($1,$2,'2000','un.',$3::work_item_sector,$4,$5,'PUBLICADO','it',$6,$7) returning id", [CLIENT, over.product ?? "SERUM CAPILAR", sector, line, branch, over.date ?? "2026-11-05", over.notes ?? "Obs original"]))[0]!.id);
  };
  const clean = async () => {
    await q("delete from work_items where client like 'IT-WC%'"); // los comentarios caen por ON DELETE CASCADE
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.GENUS_E2E_DATABASE_URL!;
    const { Pool, neonConfig } = await import("@neondatabase/serverless");
    neonConfig.webSocketConstructor = (await import("ws")).default as never;
    pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
    await assertMarkedDatabase(q);
    vi.resetModules();
    await clean();
  }, 60_000);
  beforeEach(clean);
  afterAll(async () => {
    await clean().catch(() => undefined);
    await pool?.end();
  });

  it("la migración 0078 es aditiva e idempotente (se aplica dos veces sin error)", async () => {
    const sqlText = readFileSync("drizzle/0078_work_item_comments.sql", "utf8");
    for (let i = 0; i < 2; i++) for (const stmt of sqlText.split("--> statement-breakpoint").map((x) => x.replace(/--[^\n]*\n/g, "").trim()).filter(Boolean)) await q(stmt);
    expect((await q("select table_name from information_schema.tables where table_name='work_item_comments'")).length).toBe(1);
  });

  it("3-4) Depósito publica: autor y sector salen de la sesión (no del cuerpo); 5-6) Producción lo lee y Envasado responde, en orden cronológico", async () => {
    const s = await svc();
    const id = await job();
    const a = await s.postWorkItemComment(dep, { workItemId: id, body: "Los envases restantes ingresan mañana", clientRequestId: "r1", ...({ authorName: "Otro", authorSector: "PRODUCCION" } as object) } as never);
    expect(a.comment).toMatchObject({ authorName: "Ana Depósito", authorSector: "DEPOSITO", authorSectorLabel: "Depósito", body: "Los envases restantes ingresan mañana" });
    await s.postWorkItemComment(env, { workItemId: id, body: "Tenemos 1.200 unidades terminadas", clientRequestId: "r2" });
    await s.postWorkItemComment(prod, { workItemId: id, body: "Priorizar este pedido para el jueves", clientRequestId: "r3" });
    const list = await s.listWorkItemComments(prod, id);
    expect(list.map((c) => [c.authorSectorLabel, c.body])).toEqual([
      ["Depósito", "Los envases restantes ingresan mañana"],
      ["Envasado Masivo", "Tenemos 1.200 unidades terminadas"],
      ["Producción", "Priorizar este pedido para el jueves"],
    ]);
  });

  it("7) persisten tras recargar (módulos nuevos, misma base)", async () => {
    const id = await job();
    await (await svc()).postWorkItemComment(dep, { workItemId: id, body: "Persistente", clientRequestId: "p1" });
    vi.resetModules();
    expect((await (await svc()).listWorkItemComments(env, id)).map((c) => c.body)).toEqual(["Persistente"]);
  });

  it("8) reprogramar el trabajo (otra fecha/mes) NO pierde sus comentarios", async () => {
    const s = await svc();
    const id = await job({ date: "2026-11-05" });
    await s.postWorkItemComment(dep, { workItemId: id, body: "Antes de reprogramar", clientRequestId: "m1" });
    await q("update work_items set planned_date = '2026-12-14' where id = $1", [id]);
    expect((await s.listWorkItemComments(prod, id)).map((c) => c.body)).toEqual(["Antes de reprogramar"]);
  });

  it("9) dos trabajos del mismo producto (o del mismo día) no comparten comentarios", async () => {
    const s = await svc();
    const a = await job({ product: "SERUM CAPILAR", date: "2026-11-05" });
    const b = await job({ product: "SERUM CAPILAR", date: "2026-11-05" });
    await s.postWorkItemComment(dep, { workItemId: a, body: "Solo del trabajo A", clientRequestId: "x1" });
    await s.postWorkItemComment(dep, { workItemId: b, body: "Solo del trabajo B", clientRequestId: "x1" });
    expect((await s.listWorkItemComments(prod, a)).map((c) => c.body)).toEqual(["Solo del trabajo A"]);
    expect((await s.listWorkItemComments(prod, b)).map((c) => c.body)).toEqual(["Solo del trabajo B"]);
  });

  it("10) no se publican comentarios vacíos ni demasiado largos; 11) el mismo envío repetido no duplica", async () => {
    const s = await svc();
    const id = await job();
    await expect(s.postWorkItemComment(dep, { workItemId: id, body: "   \n ", clientRequestId: "e1" })).rejects.toBeInstanceOf(s.CommentValidationError);
    await expect(s.postWorkItemComment(dep, { workItemId: id, body: "x".repeat(s.MAX_COMMENT_LENGTH + 1), clientRequestId: "e2" })).rejects.toBeInstanceOf(s.CommentValidationError);
    await expect(s.postWorkItemComment(dep, { workItemId: id, body: "hola", clientRequestId: "" })).rejects.toBeInstanceOf(s.CommentValidationError);
    const results = await Promise.all([1, 2, 3, 4].map(() => s.postWorkItemComment(dep, { workItemId: id, body: "Doble clic", clientRequestId: "dup" })));
    expect(new Set(results.map((r) => r.comment.id)).size).toBe(1);
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(Number((await q("select count(*)::int n from work_item_comments where work_item_id = $1", [id]))[0]!.n)).toBe(1);
  });

  it("12) publicar NO modifica el trabajo (cantidad, fecha, estado, asignación, observaciones)", async () => {
    const s = await svc();
    const id = await job({ notes: "Observación original del trabajo" });
    const snap = async () => JSON.stringify((await q("select * from work_items where id = $1", [id]))[0]);
    const before = await snap();
    await s.postWorkItemComment(dep, { workItemId: id, body: "Comentario", clientRequestId: "n1" });
    await s.listWorkItemComments(dep, id);
    expect(await snap()).toBe(before);
  });

  it("permisos en el servidor: sector sin acceso a la Vista mensual → 403; trabajo inexistente → 404; trabajo fuera de piso → rechazado; id inválido", async () => {
    const s = await svc();
    const id = await job();
    await expect(s.listWorkItemComments(outsider, id)).rejects.toBeInstanceOf(s.CommentForbiddenError);
    await expect(s.postWorkItemComment(outsider, { workItemId: id, body: "hola", clientRequestId: "f1" })).rejects.toBeInstanceOf(s.CommentForbiddenError);
    await expect(s.listWorkItemComments(dep, randomUUID())).rejects.toBeInstanceOf(s.CommentNotFoundError);
    await expect(s.listWorkItemComments(dep, "no-es-uuid")).rejects.toBeInstanceOf(s.CommentValidationError);
    const cod = await job({ sector: "CODIFICADO" });
    await expect(s.postWorkItemComment(dep, { workItemId: cod, body: "hola", clientRequestId: "f2" })).rejects.toBeInstanceOf(s.CommentForbiddenError);
    expect(Number((await q("select count(*)::int n from work_item_comments where author_email = $1", [outsider.email]))[0]!.n)).toBe(0);
  });

  it("el texto se guarda tal cual (HTML incluido) para mostrarse como texto", async () => {
    const s = await svc();
    const id = await job();
    const { comment } = await s.postWorkItemComment(dep, { workItemId: id, body: "<img src=x onerror=alert(1)> 1.200 & más", clientRequestId: "h1" });
    expect(comment.body).toBe("<img src=x onerror=alert(1)> 1.200 & más");
  });
});
