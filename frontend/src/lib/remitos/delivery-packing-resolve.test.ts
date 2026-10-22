/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it } from "vitest";
import { inflateSync } from "node:zlib";
import { resolveWorkItemDeliveryPacking } from "./delivery-packing";
import { getRemitoService, resetRemitoMemoryForTests } from "./remito-service";
import { buildRemitoPdf } from "./remito-pdf";
import { packingGroupsToRemitoSlots } from "./packing-math";
import { lineTotalCajas } from "./line-qty";

const g = (cajas: number, unidadesPorCaja: number) => ({ cajas, unidadesPorCaja });

describe("cajas de una entrega recuperadas del trabajo", () => {
  it("A · entrega única sin cajas propias → toma las del trabajo (Envasado/Codificado)", () => {
    const r = resolveWorkItemDeliveryPacking({ workItemGroups: [g(10, 100)], lines: [{ id: "l1", quantity: 1000, groups: null }] });
    expect(r.get("l1")).toEqual({ groups: [g(10, 100)], source: "TRABAJO" });
  });

  it("C · cajas completas + caja parcial se conservan como grupos distintos (no se promedian)", () => {
    const r = resolveWorkItemDeliveryPacking({ workItemGroups: [g(12, 100), g(1, 50)], lines: [{ id: "l1", quantity: 1250, groups: null }] });
    expect(r.get("l1")?.groups).toEqual([g(1, 50), g(12, 100)].sort((a, b) => b.unidadesPorCaja - a.unidadesPorCaja));
  });

  it("lo guardado en la propia entrega manda siempre", () => {
    const r = resolveWorkItemDeliveryPacking({ workItemGroups: [g(99, 1)], lines: [{ id: "l1", quantity: 100, groups: [g(4, 25)] }] });
    expect(r.get("l1")).toEqual({ groups: [g(4, 25)], source: "ENTREGA" });
  });

  it("D · parcial: la entrega con cajas propias descuenta las suyas y el saldo recibe el resto exacto", () => {
    const r = resolveWorkItemDeliveryPacking({
      workItemGroups: [g(10, 100)],
      lines: [{ id: "p1", quantity: 400, groups: [g(4, 100)] }, { id: "p2", quantity: 600, groups: null }],
    });
    expect(r.get("p2")).toEqual({ groups: [g(6, 100)], source: "TRABAJO" });
  });

  it("D · parcial sin cajas propias: NO se inventa qué cajas salieron (sugerencia + aviso)", () => {
    const r = resolveWorkItemDeliveryPacking({ workItemGroups: [g(10, 100)], lines: [{ id: "p1", quantity: 400, groups: null }] });
    expect(r.get("p1")?.groups).toEqual([]);
    expect(r.get("p1")?.warning).toMatch(/1\.000 u\..*400 u\./);
    expect(r.get("p1")?.suggested).toEqual([g(10, 100)]);
  });

  it("dos entregas sin cajas no se reparten solas", () => {
    const r = resolveWorkItemDeliveryPacking({ workItemGroups: [g(10, 100)], lines: [{ id: "a", quantity: 500, groups: null }, { id: "b", quantity: 500, groups: null }] });
    expect(r.get("a")?.groups).toEqual([]);
    expect(r.get("a")?.warning).toMatch(/2 entregas sin cajas/);
  });

  it("E/H · trabajo terminado y borrado de cajas en el trabajo: usa el snapshot del registro de entrega", () => {
    const r = resolveWorkItemDeliveryPacking({ workItemGroups: null, snapshotGroups: [g(5, 20)], lines: [{ id: "l1", quantity: 100, groups: null }] });
    expect(r.get("l1")).toEqual({ groups: [g(5, 20)], source: "SNAPSHOT" });
  });

  it("sin ningún dato → vacío y sin aviso (campo editable, nunca 0 inventado)", () => {
    const r = resolveWorkItemDeliveryPacking({ workItemGroups: [], lines: [{ id: "l1", quantity: 100, groups: null }] });
    expect(r.get("l1")).toEqual({ groups: [], source: "NINGUNA" });
  });

  it("cajas ya asignadas que superan las del trabajo → aviso de contradicción", () => {
    const r = resolveWorkItemDeliveryPacking({
      workItemGroups: [g(2, 100)],
      lines: [{ id: "x", quantity: 500, groups: [g(5, 100)] }, { id: "y", quantity: 100, groups: null }],
    });
    expect(r.get("y")?.warning).toMatch(/superan/);
  });
});

function pdfText(buf: Buffer): string {
  const raw = buf.toString("latin1");
  let out = "";
  for (const m of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let body: Buffer;
    try {
      body = inflateSync(Buffer.from(m[1], "latin1"));
    } catch {
      continue;
    }
    for (const h of body.toString("latin1").matchAll(/<([0-9a-fA-F]+)>/g)) out += Buffer.from(h[1], "hex").toString("latin1");
    out += "\n";
  }
  return out;
}

describe("borrador → cajas → PDF (cajas completas)", () => {
  const prod = { email: "prod@test", sector: "PRODUCCION" as const };
  beforeEach(() => resetRemitoMemoryForTests());

  it("B/G · varios productos y 3+ configuraciones de caja: el PDF imprime TODAS y el total coincide con la base", async () => {
    const svc = getRemitoService();
    const four = packingGroupsToRemitoSlots([g(2, 100), g(3, 50), g(1, 30), g(1, 7)]);
    const a = await svc.upsertDraftFromApproval(prod, { workItemId: "dl:1", clientId: "Cliente", deliveryDate: "2026-10-22", product: "Prod A", lote: "L1", vto: "12/27", totalUnits: 387, ...four });
    const b = await svc.upsertDraftFromApproval(prod, { workItemId: "dl:2", clientId: "Cliente", deliveryDate: "2026-10-22", product: "Prod B", lote: "L2", vto: "01/28", totalUnits: 60, ...packingGroupsToRemitoSlots([g(6, 10)]) });
    const remito = (await svc.get(prod, b.remito.id))!;
    expect(remito.lines).toHaveLength(2);
    const dbTotal = remito.lines.reduce((s, l) => s + lineTotalCajas(l), 0);
    expect(dbTotal).toBe(13); // 2+3+1+1 + 6
    const text = pdfText(await buildRemitoPdf(remito));
    expect(text).toContain("2 x 100");
    expect(text).toContain("3 x 50");
    expect(text).toContain("1 x 30");
    expect(text).toContain("1 x 7"); // la 4.ª configuración (extra) antes no se imprimía
    expect(text).toContain("6 x 10");
    expect(text).toContain(`TOTAL BULTOS / CAJAS: ${dbTotal}`);
    expect(a.remito.id).toBe(b.remito.id);
  });

  it("F/G · autofill completa solo renglones vacíos, una vez, y no pisa correcciones manuales", async () => {
    const svc = getRemitoService();
    const empty = await svc.upsertDraftFromApproval(prod, { workItemId: "dl:1", clientId: "Cliente", deliveryDate: "2026-10-22", product: "Prod A", lote: "L1", vto: "12/27", totalUnits: 1000, ...packingGroupsToRemitoSlots([]) });
    const filled = await svc.upsertDraftFromApproval(prod, { workItemId: "dl:2", clientId: "Cliente", deliveryDate: "2026-10-22", product: "Prod B", lote: "L2", vto: "01/28", totalUnits: 60, ...packingGroupsToRemitoSlots([g(6, 10)]) });
    const id = filled.remito.id;
    const [l1, l2] = (await svc.get(prod, id))!.lines;
    const slots = packingGroupsToRemitoSlots([g(10, 100)]);
    const r1 = await svc.autofillDraftBoxes(prod, id, [{ lineId: l1.id, slots }, { lineId: l2.id, slots }]);
    const byProduct = Object.fromEntries(r1!.lines.map((l) => [l.product, lineTotalCajas(l)]));
    expect(byProduct).toEqual({ "Prod A": 10, "Prod B": 6 }); // la línea con cajas NO se pisó
    // el usuario corrige a mano y vuelve a abrir: no se vuelve a completar
    await svc.updateDraft(prod, id, { lines: [{ id: l1.id, cajas1: 0, unidades1: 0, cajas2: 0, unidades2: 0, cajas3: 0, unidades3: 0, extraCajas: [], totalUnits: 1000 }] });
    expect(await svc.autofillDraftBoxes(prod, id, [{ lineId: l1.id, slots }])).toBeNull();
    const again = (await svc.get(prod, id))!;
    expect(lineTotalCajas(again.lines.find((l) => l.product === "Prod A")!)).toBe(0);
    expect(empty.remito.id).toBe(id);
  });
});
