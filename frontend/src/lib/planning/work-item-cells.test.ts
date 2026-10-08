import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkItem } from "@/types/operational/work-item";
import { validateWorkItemCellValue, workItemCellProtection, workItemReasonRequired } from "./work-item-cell-edit";
import { applyWorkItemCellChanges, setWorkItemCellStoreForTests, type WorkItemCellStore } from "./work-item-cells-service";
import { OrdersForbiddenError } from "@/lib/orders/types";

const produccion = { email: "p@laboratoriogenus.com.ar", sector: "PRODUCCION", displayName: "Producción" };
const base = (over: Partial<WorkItem> = {}): WorkItem =>
  ({ id: "native:w1", status: "pendiente", plannedDate: "2026-10-20", client: "BIOESENCIA", product: "SHAMPOO", quantity: "500", unit: "KG", version: 3, deliveryDate: null, notes: null, packagingLote: null, packagingVto: null, ...over }) as WorkItem;

/** Store en memoria con la misma semántica del canónico: versión optimista, solo toca la columna recibida. */
function fakeStore(initial: WorkItem[]) {
  const rows = new Map(initial.map((i) => [i.id, { ...i }]));
  const calls: Array<{ fn: string; id: string; input: Record<string, unknown> }> = [];
  const store: WorkItemCellStore = {
    async load(ids) {
      return new Map(ids.map((id) => [`native:${id}`, rows.get(`native:${id}`)] as const).filter(([, v]) => v) as Array<[string, WorkItem]>);
    },
    async updatePlanning(id, input) {
      calls.push({ fn: "planning", id, input: input as never });
      const row = rows.get(`native:${id}`)!;
      if (input.expectedVersion !== row.version) throw new Error("Este trabajo fue modificado mientras lo estabas editando (conflicto de versión)");
      for (const k of ["client", "product", "plannedQuantity", "unit", "deliveryDate", "plannedDate", "notes"] as const) {
        if (input[k] !== undefined) (row as unknown as Record<string, unknown>)[k === "plannedQuantity" ? "quantity" : k] = input[k];
      }
      row.version = (row.version ?? 0) + 1;
      return { version: row.version };
    },
    async updateLoteVto(id, input) {
      calls.push({ fn: "lotevto", id, input: input as never });
      const row = rows.get(`native:${id}`)!;
      if (input.expectedVersion !== row.version) throw new Error("conflicto de versión");
      if (input.packagingLote !== undefined) row.packagingLote = input.packagingLote;
      if (input.packagingVto !== undefined) row.packagingVto = input.packagingVto;
      row.version = (row.version ?? 0) + 1;
      return { version: row.version };
    },
  };
  return { store, rows, calls };
}
const ch = (field: string, value: string, over: Record<string, unknown> = {}) => ({ id: "native:w1", field: field as never, value, expectedVersion: 3, ...over });

describe("política de celdas de WorkItem", () => {
  it("solo Producción; solo nativos; cerrados/informados/decididos/cerrados de envasado protegidos", () => {
    expect(workItemCellProtection(base(), "client", "PRODUCCION")).toBeNull();
    expect(workItemCellProtection(base(), "client", "CALIDAD")).toMatch(/Solo Producción/);
    expect(workItemCellProtection(base({ id: "semanas:abc" }), "client", "PRODUCCION")).toMatch(/Semanas/);
    for (const status of ["cancelado", "entregado"] as const) expect(workItemCellProtection(base({ status }), "client", "PRODUCCION")).toMatch(/cerrado/);
    for (const status of ["completo", "revision", "codificado_completo", "en_codificado"] as const) expect(workItemCellProtection(base({ status }), "client", "PRODUCCION")).toMatch(/Rehacer/);
    expect(workItemCellProtection(base({ qualityStatus: "aprobado" }), "client", "PRODUCCION")).toMatch(/Calidad/);
    expect(workItemCellProtection(base({ packagingClosedAt: "2026-01-01" }), "client", "PRODUCCION")).toMatch(/Envasado cerrado/);
    // estado, avance y firmas nunca son editables por celda
    for (const f of ["status", "finishedQty", "qualityStatus", "packingGroups", "operationalObservation"]) expect(workItemCellProtection(base(), f, "PRODUCCION")).toMatch(/solo lectura/);
  });
  it("validación de tipos", () => {
    expect(validateWorkItemCellValue("plannedQuantity", "1.500,5")).toEqual({ ok: true, value: "1500.5" });
    expect(validateWorkItemCellValue("plannedQuantity", "abc").ok).toBe(false);
    expect(validateWorkItemCellValue("client", " ").ok).toBe(false);
    expect(validateWorkItemCellValue("deliveryDate", "31/12/2026")).toEqual({ ok: true, value: "2026-12-31" });
    expect(validateWorkItemCellValue("deliveryDate", "")).toEqual({ ok: true, value: null });
    expect(validateWorkItemCellValue("plannedDate", "").ok).toBe(false);
    expect(validateWorkItemCellValue("deliveryDate", "99/99/2026").ok).toBe(false);
  });
  it("motivo: siempre para lote/VTO; para el resto solo si el trabajo es de fecha pasada", () => {
    expect(workItemReasonRequired(base(), "packagingLote", "2026-10-08")).toBe(true);
    expect(workItemReasonRequired(base({ plannedDate: "2026-10-20" }), "client", "2026-10-08")).toBe(false);
    expect(workItemReasonRequired(base({ plannedDate: "2026-09-01" }), "client", "2026-10-08")).toBe(true);
  });
});

describe("applyWorkItemCellChanges (servicio sobre funciones canónicas)", () => {
  let fake: ReturnType<typeof fakeStore>;
  beforeEach(() => {
    fake = fakeStore([base()]);
    setWorkItemCellStoreForTests(fake.store);
  });
  afterEach(() => setWorkItemCellStoreForTests(null));

  it("edita UNA celda: llama al canónico con SOLO ese campo y deja las demás columnas intactas", async () => {
    const before = { ...fake.rows.get("native:w1")! };
    const { ok, results } = await applyWorkItemCellChanges(produccion, [ch("plannedQuantity", "750")], "2026-10-08");
    expect(ok).toBe(true);
    expect(results[0]).toMatchObject({ ok: true, version: 4 });
    expect(fake.calls).toHaveLength(1);
    const sent = Object.keys(fake.calls[0]!.input).filter((k) => !["updatedBy", "updatedBySector", "expectedVersion", "reason"].includes(k));
    expect(sent).toEqual(["plannedQuantity"]);
    const after = fake.rows.get("native:w1")!;
    expect(after.quantity).toBe("750");
    for (const k of ["client", "product", "unit", "deliveryDate", "notes", "status", "plannedDate"] as const) expect(after[k]).toEqual(before[k]);
  });

  it("lote/VTO van por la función canónica con motivo; sin motivo se rechaza", async () => {
    expect((await applyWorkItemCellChanges(produccion, [ch("packagingLote", "L-1")], "2026-10-08")).results[0]).toMatchObject({ ok: false, code: "REASON_REQUIRED" });
    expect(fake.calls).toHaveLength(0);
    const r = await applyWorkItemCellChanges(produccion, [ch("packagingLote", "L-1", { reason: "Corrección de lote real" })], "2026-10-08");
    expect(r.ok).toBe(true);
    expect(fake.calls[0]).toMatchObject({ fn: "lotevto", input: { packagingLote: "L-1", reason: "Corrección de lote real" } });
  });

  it("conflicto de versión: otro usuario modificó → CONFLICT y nada se pisa", async () => {
    fake.rows.get("native:w1")!.version = 9;
    const r = await applyWorkItemCellChanges(produccion, [ch("notes", "x")], "2026-10-08");
    expect(r.results[0]).toMatchObject({ ok: false, code: "CONFLICT" });
    expect(fake.rows.get("native:w1")!.notes).toBeNull();
  });

  it("pegado con una celda inválida: NO se guarda ninguna (informado)", async () => {
    const r = await applyWorkItemCellChanges(produccion, [ch("client", "NUEVO"), ch("plannedQuantity", "xx")], "2026-10-08");
    expect(r.ok).toBe(false);
    expect(fake.calls).toHaveLength(0);
    expect(r.results[0]).toMatchObject({ ok: false });
    expect(r.results[1]).toMatchObject({ ok: false, code: "INVALID" });
  });

  it("varias celdas del mismo trabajo se encadenan sobre la versión resultante", async () => {
    const r = await applyWorkItemCellChanges(produccion, [ch("client", "OTRO"), ch("notes", "urgente")], "2026-10-08");
    expect(r.ok).toBe(true);
    expect(fake.calls.map((c) => c.input.expectedVersion)).toEqual([3, 4]);
    expect(fake.rows.get("native:w1")).toMatchObject({ client: "OTRO", notes: "urgente", version: 5 });
  });

  it("protegidos: estado/avance/firmas, trabajos informados/cerrados y no nativos NO llegan a la base", async () => {
    fake.rows.set("native:w2", base({ id: "native:w2", status: "revision" }));
    fake.rows.set("native:w3", base({ id: "native:w3", qualityStatus: "aprobado" }));
    for (const c of [ch("status", "completo"), ch("finishedQty", "1"), { ...ch("client", "x"), id: "native:w2" }, { ...ch("client", "x"), id: "native:w3" }, { ...ch("client", "x"), id: "semanas:z" }]) {
      const r = await applyWorkItemCellChanges(produccion, [c as never], "2026-10-08");
      expect(r.ok).toBe(false);
    }
    expect(fake.calls).toHaveLength(0);
  });

  it("solo Producción", async () => {
    await expect(applyWorkItemCellChanges({ ...produccion, sector: "CALIDAD" }, [ch("client", "x")])).rejects.toThrow(OrdersForbiddenError);
  });

  it("error real de persistencia se informa (no éxito falso) y no rompe las otras celdas", async () => {
    vi.spyOn(fake.store, "updatePlanning").mockRejectedValueOnce(new Error("connection terminated"));
    const r = await applyWorkItemCellChanges(produccion, [ch("client", "A")], "2026-10-08");
    expect(r.ok).toBe(false);
    expect(r.results[0]).toMatchObject({ ok: false, code: "ERROR", message: "connection terminated" });
  });
});
