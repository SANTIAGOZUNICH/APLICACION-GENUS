import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ALLOWED_RECONCILE_MIGRATIONS, REQUIRED_SCHEMA_OBJECTS, drizzleHash, reconcileMigrations, rejectStatement, splitStatements, verifyRequiredSchema } from "../../../scripts/lib/migration-reconcile.mjs";

const DRIZZLE_DIR = path.resolve(__dirname, "../../../drizzle");

interface Entry { idx: number; tag: string; when: number }

/** Mini "base" que reproduce la semántica de Drizzle: aplica solo si when > MAX(created_at) ya aplicado. */
class FakeDb {
  applied: Array<{ hash: string; created_at: number }> = [];
  executed: string[] = [];
  log: Array<{ tag: string; hash: string }> = [];
  hasTable = true;
  async query(text: string, params?: unknown[]) {
    if (text.includes("information_schema.tables")) return this.hasTable ? [{ ok: 1 }] : [];
    if (text.startsWith("select hash")) return this.applied.map((a) => ({ hash: a.hash }));
    if (text.startsWith('insert into "drizzle"')) {
      this.applied.push({ hash: String(params![0]), created_at: Number(params![1]) });
      return [];
    }
    if (text.startsWith('insert into "genus_migration_reconcile_log"')) {
      this.log.push({ tag: String(params![0]), hash: String(params![1]) });
      return [];
    }
    this.executed.push(text);
    return [];
  }
  /** Equivalente a drizzle.migrate(): una sola lectura de la última aplicada. */
  drizzleMigrate(folder: string) {
    const journal = JSON.parse(fs.readFileSync(path.join(folder, "meta", "_journal.json"), "utf8"));
    const last = this.applied.reduce((m, a) => Math.max(m, a.created_at), 0);
    for (const e of journal.entries as Entry[]) {
      if (last < e.when) {
        const text = fs.readFileSync(path.join(folder, `${e.tag}.sql`), "utf8");
        this.applied.push({ hash: drizzleHash(text), created_at: e.when });
        this.executed.push(`[drizzle] ${e.tag}`);
      }
    }
  }
}

function makeFolder(entries: Array<Entry & { sql: string }>): { dir: string; allowed: Record<string, string> } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mig-"));
  fs.mkdirSync(path.join(dir, "meta"));
  for (const e of entries) fs.writeFileSync(path.join(dir, `${e.tag}.sql`), e.sql);
  fs.writeFileSync(
    path.join(dir, "meta", "_journal.json"),
    JSON.stringify({ version: "7", dialect: "postgresql", entries: entries.map(({ idx, tag, when }) => ({ idx, version: "7", when, tag, breakpoints: true })) })
  );
  const allowed = Object.fromEntries(entries.filter((e) => e.idx > 0).map((e) => [e.tag, drizzleHash(e.sql)]));
  return { dir, allowed };
}

const base: Entry & { sql: string } = { idx: 0, tag: "0038_base", when: 1000, sql: "create table if not exists base(id int);" };
const safeSql = (name: string) => `-- migración de prueba\ncreate table if not exists ${name}(id int);\n--> statement-breakpoint\ncreate index if not exists ${name}_i on ${name}(id);`;
const run = (db: FakeDb, f: { dir: string; allowed: Record<string, string> }) =>
  reconcileMigrations({ folder: f.dir, allowed: f.allowed, query: (t: string, p?: unknown[]) => db.query(t, p) });

describe("reconciliación de migraciones: ninguna se saltea, sin importar el orden de merge", () => {
  it("Drizzle SÍ saltea una migración con `when` menor a la última aplicada; la reconciliación la aplica y la registra", async () => {
    const A = { idx: 1, tag: "0040_a", when: 3000, sql: safeSql("a") };
    const B = { idx: 2, tag: "0039_b", when: 2000, sql: safeSql("b") };
    const db = new FakeDb();
    db.drizzleMigrate(makeFolder([base]).dir);
    db.drizzleMigrate(makeFolder([base, A]).dir);
    const f2 = makeFolder([base, A, B]);
    db.drizzleMigrate(f2.dir);
    expect(db.executed.some((e) => e.includes("0039_b"))).toBe(false); // salteada por Drizzle

    const res = await run(db, f2);
    expect(res.applied).toEqual(["0039_b"]);
    expect(db.executed.some((e) => e.includes("create table if not exists b"))).toBe(true);
    expect(db.log.some((l) => l.tag === "0039_b")).toBe(true); // registro de ejecución
    expect((await run(db, f2)).applied).toEqual([]); // idempotente
  });

  it("orden inverso: Drizzle aplica ambas y la reconciliación no hace nada", async () => {
    const A = { idx: 1, tag: "0040_a", when: 3000, sql: safeSql("a") };
    const B = { idx: 2, tag: "0039_b", when: 2000, sql: safeSql("b") };
    const db = new FakeDb();
    db.drizzleMigrate(makeFolder([base]).dir);
    const f = makeFolder([base, B, A]);
    db.drizzleMigrate(f.dir);
    expect((await run(db, f)).applied).toEqual([]);
    expect(db.applied).toHaveLength(3);
  });

  it("base nueva (sin tabla de Drizzle): no hace nada", async () => {
    const db = new FakeDb();
    db.hasTable = false;
    expect((await run(db, makeFolder([base]))).applied).toEqual([]);
  });

  it("se registra con SU hash y no se toca ninguna ya ejecutada", async () => {
    const B = { idx: 1, tag: "0039_b", when: 500, sql: safeSql("b") };
    const db = new FakeDb();
    db.applied.push({ hash: drizzleHash(base.sql), created_at: 1000 });
    await run(db, makeFolder([base, B]));
    expect(db.applied.at(-1)).toEqual({ hash: drizzleHash(B.sql), created_at: 500 });
    expect(db.applied[0]).toEqual({ hash: drizzleHash(base.sql), created_at: 1000 });
  });
});

describe("no es un ejecutor arbitrario de SQL", () => {
  it("una migración que NO está en la lista explícita nunca se ejecuta", async () => {
    const B = { idx: 1, tag: "0035_otra", when: 500, sql: safeSql("b") };
    const db = new FakeDb();
    db.applied.push({ hash: drizzleHash(base.sql), created_at: 1000 });
    const f = makeFolder([base, B]);
    const res = await reconcileMigrations({ folder: f.dir, allowed: {}, query: (t: string, p?: unknown[]) => db.query(t, p) });
    expect(res.applied).toEqual([]);
    expect(db.executed).toHaveLength(0);
  });

  it("un archivo autorizado cuyo contenido CAMBIÓ (hash distinto) se rechaza y no ejecuta nada", async () => {
    const B = { idx: 1, tag: "0039_b", when: 500, sql: safeSql("b") };
    const db = new FakeDb();
    db.applied.push({ hash: drizzleHash(base.sql), created_at: 1000 });
    const f = makeFolder([base, B]);
    fs.writeFileSync(path.join(f.dir, "0039_b.sql"), safeSql("b") + "\n--> statement-breakpoint\ndrop table users;");
    const res = await run(db, f);
    expect(res.applied).toEqual([]);
    expect(res.rejected[0]).toMatchObject({ tag: "0039_b" });
    expect(db.executed).toHaveLength(0);
  });

  it("aunque el hash coincida, una sentencia destructiva o no aditiva aborta ANTES de ejecutar la migración", async () => {
    for (const bad of ["drop table users", "delete from asignacion_lotes", "update x set a = 1", "truncate x", "alter table x drop column y", "insert into x values (1)", "create table if not exists x(id int); drop table y", "do $$ begin end $$", "create table x(id int)"]) {
      const B = { idx: 1, tag: "0039_b", when: 500, sql: `create table if not exists ok(id int);\n--> statement-breakpoint\n${bad};` };
      const db = new FakeDb();
      db.applied.push({ hash: drizzleHash(base.sql), created_at: 1000 });
      const res = await run(db, makeFolder([base, B]));
      expect(res.applied, bad).toEqual([]);
      expect(res.rejected[0]?.reason, bad).toMatch(/sentencia rechazada/);
      expect(db.executed, bad).toHaveLength(0);
    }
  });

  it("rejectStatement acepta solo DDL aditivo idempotente", () => {
    for (const ok of ['CREATE TABLE IF NOT EXISTS "t" ("a" int)', 'CREATE UNIQUE INDEX IF NOT EXISTS "i" ON "t" ("a") WHERE "s" = \'x\'', 'ALTER TABLE "t" ADD COLUMN IF NOT EXISTS "c" integer NOT NULL DEFAULT 0']) {
      expect(rejectStatement(ok), ok).toBeNull();
    }
    expect(rejectStatement('ALTER TABLE "t" ALTER COLUMN "c" SET NOT NULL')).not.toBeNull();
    expect(rejectStatement("select 1")).not.toBeNull();
    expect(splitStatements("-- c\ncreate table if not exists a(id int);\n--> statement-breakpoint\n-- solo comentario")).toHaveLength(1);
  });
});

describe("guardas sobre el journal real del repo", () => {
  const journal = JSON.parse(fs.readFileSync(path.join(DRIZZLE_DIR, "meta", "_journal.json"), "utf8")) as { entries: Entry[] };

  it("tags únicos, idx consecutivos y cada entrada tiene su .sql", () => {
    const tags = journal.entries.map((e) => e.tag);
    expect(new Set(tags).size).toBe(tags.length);
    journal.entries.forEach((e, i) => {
      expect(e.idx).toBe(i);
      expect(fs.existsSync(path.join(DRIZZLE_DIR, `${e.tag}.sql`))).toBe(true);
    });
  });

  it("toda migración posterior a 0038 DEL REPO está en la lista explícita con su hash exacto y pasa la validación de sentencias", () => {
    for (const e of journal.entries.filter((x) => x.idx > 37)) {
      const text = fs.readFileSync(path.join(DRIZZLE_DIR, `${e.tag}.sql`), "utf8");
      expect((ALLOWED_RECONCILE_MIGRATIONS as Record<string, string>)[e.tag], `${e.tag} debe figurar en ALLOWED_RECONCILE_MIGRATIONS (revisión explícita)`).toBe(drizzleHash(text));
      for (const stmt of splitStatements(text)) expect(rejectStatement(stmt), `${e.tag}: ${stmt.slice(0, 60)}`).toBeNull();
    }
  });

  it("la lista autorizada solo contiene migraciones posteriores a 0038 (las ya ejecutadas en producción no se tocan)", () => {
    for (const tag of Object.keys(ALLOWED_RECONCILE_MIGRATIONS)) expect(Number(tag.slice(0, 4))).toBeGreaterThan(38);
  });
});

describe("verificación de esquema después del migrate (build)", () => {
  // information_schema simulado: tablas y columnas presentes.
  const fakeQuery = (tables: string[], columns: string[]) => async (text: string) =>
    /information_schema\.tables/.test(text)
      ? tables.map((t) => ({ t }))
      : columns.map((tc) => ({ t: tc.split(".")[0], c: tc.split(".")[1] }));

  it("0043 completa → ok", async () => {
    const res = await verifyRequiredSchema({
      query: fakeQuery(
        ["asignacion_lotes", "asignacion_lotes_cell_audit", "asignacion_lotes_local_edits"],
        ["asignacion_lotes.source_lote", "asignacion_lotes.source_codigo", "asignacion_lotes.source_producto", "asignacion_lotes_cell_audit.reason"]
      ),
    });
    expect(res).toEqual({ ok: true, missing: [] });
  });

  it("0043 salteada en silencio → informa exactamente qué falta y de qué migración", async () => {
    const res = await verifyRequiredSchema({
      query: fakeQuery(["asignacion_lotes", "asignacion_lotes_cell_audit"], ["asignacion_lotes.lote"]),
    });
    expect(res.ok).toBe(false);
    expect(res.missing.map((m) => m.object)).toEqual(REQUIRED_SCHEMA_OBJECTS.map((r) => r.object));
    expect(new Set(res.missing.map((m) => m.migration))).toEqual(new Set(["0043_asignacion_lotes_local_edits"]));
  });

  it("cada objeto requerido lo crea una migración del journal (y está en la lista de reconciliación)", () => {
    for (const r of REQUIRED_SCHEMA_OBJECTS) {
      expect(ALLOWED_RECONCILE_MIGRATIONS).toHaveProperty(r.migration);
      const sqlText = fs.readFileSync(path.join("drizzle", `${r.migration}.sql`), "utf8");
      const [table, column] = r.object.split(".");
      expect(sqlText).toContain(`"${column ?? table}"`);
    }
  });
});
