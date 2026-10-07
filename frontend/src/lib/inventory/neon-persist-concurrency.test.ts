/**
 * Protección real contra lost updates en la persistencia Neon del ledger ME:
 * cada request solo escribe las filas que cambió (por id), nunca el snapshot completo.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

type Row = { id: string; payload: unknown };
const store = new Map<object, Map<string, Row>>();
const writes: Array<{ id: string }> = [];

vi.mock("@/lib/db/client", () => {
  const tableRows = (t: object) => {
    if (!store.has(t)) store.set(t, new Map());
    return store.get(t)!;
  };
  return {
    isDatabaseConfigured: () => true,
    getDb: () => ({
      select: () => ({
        from: async (t: object) => [...tableRows(t).values()].map((r) => ({ ...r })),
      }),
      insert: (t: object) => ({
        values: (v: { id?: string; payload: unknown }) => ({
          onConflictDoUpdate: async () => {
            if (v.id) {
              writes.push({ id: v.id });
              tableRows(t).set(v.id, { id: v.id, payload: JSON.parse(JSON.stringify(v.payload)) });
            }
          },
        }),
      }),
    }),
  };
});

import { MemoryInventoryRepo } from "@/lib/inventory/memory-repo";
import { InventoryService } from "@/lib/inventory/inventory-service";
import { hydrateInventoryFromNeon, persistInventorySnapshot } from "@/lib/inventory/neon-persist";
import { invMeIngresos, invMeSalidas } from "@/lib/db/schema";
import type { SectorId } from "@/types/operational/sector";

const deposito = { email: "deposito@laboratoriogenus.com.ar", sector: "DEPOSITO" as SectorId };

beforeEach(() => {
  store.clear();
  writes.length = 0;
});

async function request() {
  const repo = new MemoryInventoryRepo();
  await hydrateInventoryFromNeon(repo, { force: true });
  return { repo, svc: new InventoryService(repo) };
}

describe("persistencia ME — sin lost updates", () => {
  it("ingreso (Depósito) y consumo (Envasado) concurrentes: quedan los dos movimientos", async () => {
    // Estado base persistido
    const base = await request();
    base.svc.upsertMeIngreso(deposito, { codigo: "FR-1", descripcionInsumo: "Frasco", bultos: 1, cantidad: 100 });
    await persistInventorySnapshot(base.repo);

    // Ambos requests hidratan el MISMO estado antes de que cualquiera escriba.
    const a = await request();
    const b = await request();

    a.svc.upsertMeIngreso(deposito, { codigo: "FR-1", descripcionInsumo: "Frasco", bultos: 1, cantidad: 1000 });
    b.svc.upsertMeSalida(deposito, {
      codigo: "FR-1",
      descripcion: "Frasco",
      cantidad: 200,
      bultos: 1,
      origen: "OA",
      oaId: "oa-9",
      oaNumber: "OA-9",
      idempotencyKey: "oa-9:1:l1",
      materialId: a.repo.meMaterials[0]!.id,
    });

    await persistInventorySnapshot(a.repo);
    await persistInventorySnapshot(b.repo); // llega último con una vista vieja del ingreso de A

    const final = await request();
    expect(final.repo.meIngresos).toHaveLength(2);
    expect(final.repo.meSalidas.filter((s) => s.origen === "OA")).toHaveLength(1);
    const inv = final.svc.listMeInventario(deposito).find((r) => r.codigo === "FR-1");
    expect(inv?.cantidadTotal).toBe(100 + 1000 - 200);
  });

  it("un request no reescribe filas que no cambió (no pisa el cambio ajeno)", async () => {
    const base = await request();
    const ing = base.svc.upsertMeIngreso(deposito, { codigo: "FR-2", descripcionInsumo: "Tapa", bultos: 1, cantidad: 50 });
    await persistInventorySnapshot(base.repo);

    const stale = await request(); // vista previa a la anulación
    const other = await request();
    other.svc.anularMeIngreso(deposito, ing.id, "duplicado");
    await persistInventorySnapshot(other.repo);

    writes.length = 0;
    await persistInventorySnapshot(stale.repo); // nada cambió en stale → no escribe
    expect(writes.filter((w) => w.id === ing.id)).toHaveLength(0);

    const final = await request();
    expect(final.repo.meIngresos.find((r) => r.id === ing.id)?.anulado).toBe(true);
    void invMeIngresos;
    void invMeSalidas;
  });
});
