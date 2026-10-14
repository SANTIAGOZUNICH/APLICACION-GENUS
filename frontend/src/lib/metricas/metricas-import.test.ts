import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { getMetricasAuditMemoryForTests, getMetricasService, resetMetricasMemoryForTests } from "./metricas-service";
import { MetricsConflictError, type MetricsActor } from "./types";
import { OrdersForbiddenError, OrdersValidationError } from "@/lib/orders/types";

const MASIVO: MetricsActor = { email: "masivo@x.com", sector: "ENVASADO_MASIVO" };
const PREMIUM: MetricsActor = { email: "premium@x.com", sector: "ENVASADO_PREMIUM" };
const PROD: MetricsActor = { email: "prod@x.com", sector: "PRODUCCION" };
const CALIDAD: MetricsActor = { email: "cal@x.com", sector: "CALIDAD" };

const row = (o: Record<string, unknown> = {}) => ({ metricDate: "2026-10-15", product: "SHAMPOO", units: 1200, responsibleDisplay: "Ana", sector: "ENVASADO_MASIVO", ...o });
const svc = () => getMetricasService();

beforeEach(() => resetMetricasMemoryForTests());

describe("Métricas — pegado masivo", () => {
  it("crea varias filas nuevas de una vez y audita cada una", async () => {
    const r = await svc().importCommit(MASIVO, { batchId: "batch-0001", rows: [row(), row({ product: "CREMA", units: 800 }), row({ metricDate: "2026-10-16", units: 5 })] });
    expect(r).toMatchObject({ created: 3, updated: 0, skipped: 0 });
    const list = await svc().list(MASIVO);
    expect(list).toHaveLength(3);
    const audit = getMetricasAuditMemoryForTests();
    expect(audit.filter((e) => e.action === "create" && (e.payload as { via?: string }).via === "paste")).toHaveLength(3);
    expect(audit.some((e) => e.action === "import" && e.idempotencyKey === "metricas:import:batch-0001")).toBe(true);
  });

  it("vista previa: nueva / ya existe igual / existe con otras unidades / repetida en lo pegado / inválida", async () => {
    await svc().importCommit(MASIVO, { batchId: "seed-0001", rows: [row(), row({ product: "CREMA", units: 800 })] });
    const preview = await svc().importPreview(MASIVO, [
      row({ product: "GEL" }), // nueva
      row(), // igual
      row({ product: "CREMA", units: 900 }), // conflicto
      row({ product: "GEL" }), // repetida
      row({ units: 10.5 }), // inválida
    ]);
    expect(preview.map((p) => p.status)).toEqual(["new", "identical", "conflict", "duplicate_in_batch", "invalid"]);
    expect(preview[2]!.existing).toMatchObject({ units: 800 });
    expect(await svc().list(MASIVO)).toHaveLength(2); // la vista previa no escribe
  });

  it("no crea duplicados: pegar lo mismo dos veces (lotes distintos) no agrega ni cambia nada", async () => {
    await svc().importCommit(MASIVO, { batchId: "dup-0001", rows: [row()] });
    const again = await svc().importCommit(MASIVO, { batchId: "dup-0002", rows: [row()] });
    expect(again).toMatchObject({ created: 0, updated: 0, skipped: 1 });
    expect(again.results[0]!.outcome).toBe("identical");
    expect(await svc().list(MASIVO)).toHaveLength(1);
  });

  it("NO sobrescribe sin confirmación; con confirmación actualiza y audita antes/después", async () => {
    await svc().importCommit(MASIVO, { batchId: "ow-0001", rows: [row()] });
    const [p] = await svc().importPreview(MASIVO, [row({ units: 1500 })]);
    expect(p!.status).toBe("conflict");

    const sin = await svc().importCommit(MASIVO, { batchId: "ow-0002", rows: [row({ units: 1500 })] });
    expect(sin.results[0]!.outcome).toBe("conflict_not_confirmed");
    expect((await svc().list(MASIVO))[0]!.units).toBe(1200);

    const con = await svc().importCommit(MASIVO, { batchId: "ow-0003", rows: [row({ units: 1500 })], overwrite: { "0": p!.existing!.updatedAt } });
    expect(con).toMatchObject({ updated: 1, created: 0 });
    expect((await svc().list(MASIVO))[0]!.units).toBe(1500);
    const ev = getMetricasAuditMemoryForTests().filter((e) => e.action === "update").at(-1)!;
    expect(ev.payload).toMatchObject({ before: { units: 1200 }, after: { units: 1500 }, via: "paste" });
  });

  it("no pisa un registro que cambió después de la vista previa", async () => {
    await svc().importCommit(MASIVO, { batchId: "st-0001", rows: [row()] });
    const [p] = await svc().importPreview(MASIVO, [row({ units: 1500 })]);
    const rec = (await svc().list(MASIVO))[0]!;
    await new Promise((r) => setTimeout(r, 5));
    await svc().update(MASIVO, rec.id, { units: 1300 }); // otra persona edita
    const r = await svc().importCommit(MASIVO, { batchId: "st-0002", rows: [row({ units: 1500 })], overwrite: { "0": p!.existing!.updatedAt } });
    expect(r.results[0]!.outcome).toBe("conflict_not_confirmed");
    expect((await svc().list(MASIVO))[0]!.units).toBe(1300);
  });

  it("idempotente: reintentar el mismo lote devuelve el mismo resultado sin duplicar", async () => {
    const a = await svc().importCommit(MASIVO, { batchId: "idem-0001", rows: [row(), row({ product: "CREMA" })] });
    const b = await svc().importCommit(MASIVO, { batchId: "idem-0001", rows: [row(), row({ product: "CREMA" })] });
    expect(a.created).toBe(2);
    expect(b).toMatchObject({ created: 2, idempotentReplay: true });
    expect(await svc().list(MASIVO)).toHaveLength(2);
  });

  it("repetidas dentro de lo pegado: solo se carga la primera", async () => {
    const r = await svc().importCommit(MASIVO, { batchId: "rep-0001", rows: [row(), row({ units: 99 })] });
    expect(r.created).toBe(1);
    expect(r.results[1]!.outcome).toBe("duplicate_in_batch");
    expect((await svc().list(MASIVO))[0]!.units).toBe(1200);
  });

  it("filas inválidas no se cargan y no bloquean a las válidas", async () => {
    const r = await svc().importCommit(MASIVO, { batchId: "inv-0001", rows: [row(), row({ metricDate: "31/02/2026" }), row({ product: "OTRO", responsibleDisplay: "" })] });
    expect(r.created).toBe(1);
    expect(r.results.map((x) => x.outcome)).toEqual(["created", "invalid", "invalid"]);
  });

  it("permisos: Envasado no carga en otro sector; Calidad no accede; Producción elige sector por fila", async () => {
    const otro = await svc().importCommit(MASIVO, { batchId: "perm-0001", rows: [row({ sector: "ENVASADO_PREMIUM" })] });
    expect(otro).toMatchObject({ created: 0 });
    expect(otro.results[0]!.outcome).toBe("invalid");
    await expect(svc().importCommit(CALIDAD, { batchId: "perm-0002", rows: [row()] })).rejects.toBeInstanceOf(OrdersForbiddenError);
    await expect(svc().importPreview(CALIDAD, [row()])).rejects.toBeInstanceOf(OrdersForbiddenError);
    const prod = await svc().importCommit(PROD, { batchId: "perm-0003", rows: [row(), row({ sector: "ENVASADO_PREMIUM", product: "SERUM" })] });
    expect(prod.created).toBe(2);
    expect(await svc().list(PREMIUM)).toHaveLength(1); // Premium solo ve lo suyo
    expect(await svc().list(MASIVO)).toHaveLength(1);
  });

  it("límites: sin filas, sin identificador o demasiadas filas se rechazan", async () => {
    await expect(svc().importCommit(MASIVO, { batchId: "lim-0001", rows: [] })).rejects.toBeInstanceOf(OrdersValidationError);
    await expect(svc().importCommit(MASIVO, { batchId: "", rows: [row()] })).rejects.toBeInstanceOf(OrdersValidationError);
    await expect(svc().importCommit(MASIVO, { batchId: "lim-0002", rows: Array.from({ length: 501 }, () => row()) })).rejects.toBeInstanceOf(OrdersValidationError);
  });
});

describe("Métricas — edición por celda: concurrencia y auditoría", () => {
  it("update con versión vieja → conflicto (nunca pisa); con la versión actual guarda y audita", async () => {
    const rec = await svc().create(MASIVO, { metricDate: "2026-10-15", product: "X", units: 10, responsibleDisplay: "Ana" });
    await new Promise((r) => setTimeout(r, 5));
    const u1 = await svc().update(MASIVO, rec.id, { units: 20, expectedUpdatedAt: rec.updatedAt, via: "grid" });
    expect(u1.units).toBe(20);
    await expect(svc().update(MASIVO, rec.id, { units: 30, expectedUpdatedAt: rec.updatedAt })).rejects.toBeInstanceOf(MetricsConflictError);
    expect((await svc().getById(MASIVO, rec.id))!.units).toBe(20);
    const ev = getMetricasAuditMemoryForTests().filter((e) => e.action === "update");
    expect(ev).toHaveLength(1);
    expect(ev[0]!.payload).toMatchObject({ before: { units: 10 }, after: { units: 20 }, via: "grid" });
  });

  it("crear, borrar y restaurar también quedan auditados", async () => {
    const rec = await svc().create(MASIVO, { metricDate: "2026-10-15", units: 10, responsibleDisplay: "Ana" });
    await svc().delete(MASIVO, rec.id);
    await svc().restore(MASIVO, rec.id);
    expect(getMetricasAuditMemoryForTests().map((e) => e.action)).toEqual(["create", "delete", "restore"]);
  });

  it("otro sector no puede editar", async () => {
    const rec = await svc().create(MASIVO, { metricDate: "2026-10-15", units: 10, responsibleDisplay: "Ana" });
    await expect(svc().update(PREMIUM, rec.id, { units: 5 })).rejects.toThrow();
  });
});
