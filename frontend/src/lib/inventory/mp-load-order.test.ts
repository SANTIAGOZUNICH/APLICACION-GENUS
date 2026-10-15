import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/client", () => ({ isDatabaseConfigured: () => true, getDb: () => ({}) }));

import { backfillMpLoadOrderTable, ensureMpLoadOrderBackfillInTx, MP_LOAD_ORDER_TABLES } from "./mp-load-order";

/** tx simulada: registra las sentencias (texto SQL) y responde "hay pendientes" según el caso. */
function fakeTx(pending: boolean) {
  const stmts: string[] = [];
  return {
    stmts,
    tx: {
      execute: async (q: { queryChunks?: unknown[] }) => {
        const text = JSON.stringify(q.queryChunks ?? q);
        stmts.push(text);
        if (/select 1 as n/.test(text)) return { rows: pending ? [{ n: 1 }] : [] };
        if (/returning/.test(text)) return { rows: [{ criterio: "historico:createdAt" }, { criterio: "historico:sin-fecha" }, { criterio: "historico:createdAt" }] };
        return { rows: [] };
      },
    },
  };
}

describe("backfill del orden de carga de MP", () => {
  it("sin filas históricas pendientes no escribe nada (idempotente)", async () => {
    const { tx, stmts } = fakeTx(false);
    const r = await backfillMpLoadOrderTable(tx as never, "inv_mp_stock");
    expect(r).toEqual({ reordenadas: 0, porFecha: 0, sinFecha: 0 });
    expect(stmts).toHaveLength(1);
    expect(stmts.some((s) => /update/i.test(s))).toBe(false);
  });

  it("con pendientes: libera posiciones y las reparte por fecha de creación, SOLO sobre load_seq/seq_criterio (no toca payload ni updated_at)", async () => {
    const { tx, stmts } = fakeTx(true);
    const r = await backfillMpLoadOrderTable(tx as never, "inv_mp_ingresos");
    expect(r).toEqual({ reordenadas: 3, porFecha: 2, sinFecha: 1 });
    const updates = stmts.filter((s) => /update/i.test(s));
    expect(updates).toHaveLength(2);
    expect(updates[0]).toContain("-load_seq");
    expect(updates[1]).toContain("createdAt");
    for (const u of updates) expect(u).not.toMatch(/payload\s*=|updated_at|delete|insert|truncate/i);
  });

  it("recorre las cuatro tablas de MP", async () => {
    const { tx } = fakeTx(false);
    const out = await ensureMpLoadOrderBackfillInTx(tx as never);
    expect(Object.keys(out).sort()).toEqual([...MP_LOAD_ORDER_TABLES].sort());
  });
});
