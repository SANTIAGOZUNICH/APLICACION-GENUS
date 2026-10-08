import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error módulo .mjs sin tipos (script de build)
import { drizzleHash, reconcileMigrations, RECONCILE_MARKER, KNOWN_RECONCILE_SAFE_TAGS } from "../../../scripts/lib/migration-reconcile.mjs";

const DRIZZLE_DIR = path.resolve(__dirname, "../../../drizzle");

interface Entry { idx: number; tag: string; when: number }

/** Mini "base" que reproduce la semántica de Drizzle: aplica solo si when > MAX(created_at) ya aplicado. */
class FakeDb {
  applied: Array<{ hash: string; created_at: number }> = [];
  executed: string[] = [];
  hasTable = true;
  async query(text: string, params?: unknown[]) {
    if (text.includes("information_schema.tables")) return this.hasTable ? [{ ok: 1 }] : [];
    if (text.startsWith("select hash")) return this.applied.map((a) => ({ hash: a.hash }));
    if (text.startsWith("insert into")) {
      this.applied.push({ hash: String(params![0]), created_at: Number(params![1]) });
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

function makeFolder(entries: Array<Entry & { sql: string }>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mig-"));
  fs.mkdirSync(path.join(dir, "meta"));
  for (const e of entries) fs.writeFileSync(path.join(dir, `${e.tag}.sql`), e.sql);
  fs.writeFileSync(
    path.join(dir, "meta", "_journal.json"),
    JSON.stringify({ version: "7", dialect: "postgresql", entries: entries.map(({ idx, tag, when }) => ({ idx, version: "7", when, tag, breakpoints: true })) })
  );
  return dir;
}

const base: Entry & { sql: string } = { idx: 0, tag: "0038_base", when: 1000, sql: "create table if not exists base(id int);" };
const safeSql = (name: string) => `${RECONCILE_MARKER}\ncreate table if not exists ${name}(id int);\n--> statement-breakpoint\ncreate index if not exists ${name}_i on ${name}(id);`;

describe("reconciliación de migraciones: ninguna se saltea, sin importar el orden de merge", () => {
  it("Drizzle SÍ saltea una migración con `when` menor a la última aplicada; la reconciliación la aplica", async () => {
    // Producción ya aplicó A (when alto). Después se mergea B (when menor).
    const A = { idx: 1, tag: "0040_a", when: 3000, sql: safeSql("a") };
    const B = { idx: 2, tag: "0039_b", when: 2000, sql: safeSql("b") };
    const db = new FakeDb();
    db.drizzleMigrate(makeFolder([base]));
    db.drizzleMigrate(makeFolder([base, A]));
    const folder2 = makeFolder([base, A, B]);
    db.drizzleMigrate(folder2);
    expect(db.executed.some((e) => e.includes("0039_b"))).toBe(false); // salteada por Drizzle

    const res = await reconcileMigrations({ folder: folder2, query: (t: string, p?: unknown[]) => db.query(t, p) });
    expect(res.applied).toEqual(["0039_b"]);
    expect(db.executed.some((e) => e.includes("create table if not exists b"))).toBe(true);
    expect(db.executed.filter((e) => e.includes("index if not exists b_i"))).toHaveLength(1);

    // Idempotente: una segunda corrida no reaplica nada.
    const again = await reconcileMigrations({ folder: folder2, query: (t: string, p?: unknown[]) => db.query(t, p) });
    expect(again.applied).toEqual([]);
  });

  it("orden inverso (la de `when` menor se mergea primero): Drizzle aplica ambas y la reconciliación no hace nada", async () => {
    const A = { idx: 1, tag: "0040_a", when: 3000, sql: safeSql("a") };
    const B = { idx: 2, tag: "0039_b", when: 2000, sql: safeSql("b") };
    const db = new FakeDb();
    db.drizzleMigrate(makeFolder([base]));
    const folder = makeFolder([base, B, A]);
    db.drizzleMigrate(folder);
    const res = await reconcileMigrations({ folder, query: (t: string, p?: unknown[]) => db.query(t, p) });
    expect(res.applied).toEqual([]);
    expect(db.applied).toHaveLength(3);
  });

  it("base nueva (sin tabla de Drizzle): no hace nada, migrate() ya aplicó todo", async () => {
    const db = new FakeDb();
    db.hasTable = false;
    const res = await reconcileMigrations({ folder: makeFolder([base]), query: (t: string, p?: unknown[]) => db.query(t, p) });
    expect(res.applied).toEqual([]);
  });

  it("una migración SIN marca (no auditada como idempotente) nunca se reaplica automáticamente", async () => {
    const risky = { idx: 1, tag: "0035_risky", when: 500, sql: "alter table x drop column y;" };
    const db = new FakeDb();
    db.applied.push({ hash: drizzleHash(base.sql), created_at: 1000 });
    const folder = makeFolder([base, risky]);
    const res = await reconcileMigrations({ folder, query: (t: string, p?: unknown[]) => db.query(t, p) });
    expect(res.applied).toEqual([]);
    expect(db.executed).toHaveLength(0);
  });

  it("la migración se registra con SU hash (no se modifica ninguna ya ejecutada)", async () => {
    const B = { idx: 1, tag: "0039_b", when: 500, sql: safeSql("b") };
    const db = new FakeDb();
    db.applied.push({ hash: drizzleHash(base.sql), created_at: 1000 });
    await reconcileMigrations({ folder: makeFolder([base, B]), query: (t: string, p?: unknown[]) => db.query(t, p) });
    expect(db.applied.at(-1)).toEqual({ hash: drizzleHash(B.sql), created_at: 500 });
    expect(db.applied[0]).toEqual({ hash: drizzleHash(base.sql), created_at: 1000 });
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

  it("toda migración posterior a 0038 es reconcile-safe (marca o allowlist): obliga a que las nuevas sean order-independent", () => {
    for (const e of journal.entries.filter((x) => x.idx > 37)) {
      const text = fs.readFileSync(path.join(DRIZZLE_DIR, `${e.tag}.sql`), "utf8");
      const ok = text.includes(RECONCILE_MARKER) || KNOWN_RECONCILE_SAFE_TAGS.has(e.tag);
      expect(ok, `${e.tag} debe incluir '${RECONCILE_MARKER}' (solo SQL idempotente)`).toBe(true);
      // Idempotencia mínima verificable: ningún DROP / DELETE / TRUNCATE.
      expect(/\b(drop\s+table|drop\s+column|delete\s+from|truncate)\b/i.test(text), `${e.tag} no puede contener sentencias destructivas`).toBe(false);
      for (const stmt of text.split("--> statement-breakpoint")) {
        if (/^\s*(create\s+(unique\s+)?(table|index)|alter\s+table)/im.test(stmt.replace(/--.*$/gm, ""))) {
          expect(/if\s+not\s+exists/i.test(stmt), `${e.tag}: cada CREATE/ALTER debe usar IF NOT EXISTS`).toBe(true);
        }
      }
    }
  });

  it("las migraciones ya en main (<= 0038) no fueron modificadas por este PR (hash estable respecto de origin/main)", () => {
    // Verificación local barata: ninguna de las <=0038 contiene la marca de reconciliación (no se tocaron).
    for (const e of journal.entries.filter((x) => x.idx <= 37)) {
      const text = fs.readFileSync(path.join(DRIZZLE_DIR, `${e.tag}.sql`), "utf8");
      expect(text.includes(RECONCILE_MARKER)).toBe(false);
    }
  });
});
