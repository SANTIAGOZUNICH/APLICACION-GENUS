import { beforeEach, describe, expect, it } from "vitest";
import {
  computeNextOp,
  isoToDdMmAa,
  todayDdMmAaArgentina,
  todayIsoArgentina,
} from "./next-op";
import { getProductionPedidosService, resetProductionPedidosMemoryForTests } from "./service";

describe("computeNextOp — siguiente OP correlativo", () => {
  it("MAX numérico + 1, ignorando texto, vacíos y el orden", () => {
    expect(computeNextOp(["25293", "25294", null, "", "PDEP-1", "25100"])).toBe("25295");
  });
  it("sin OP numéricos no hay sugerencia", () => {
    expect(computeNextOp([])).toBeNull();
    expect(computeNextOp([null, "ABC", "12-3"])).toBeNull();
  });
  it("conserva ceros a la izquierda y no desborda con valores grandes", () => {
    expect(computeNextOp(["0099"])).toBe("0100");
    expect(computeNextOp(["999999999999999"])).toBe("1000000000000000");
  });
  it("compara como número, no como texto (9 < 10)", () => {
    expect(computeNextOp(["9", "10", "2"])).toBe("11");
  });
});

describe("fecha «hoy» en America/Argentina/Buenos_Aires", () => {
  it("mediodía UTC: mismo día", () => {
    expect(todayIsoArgentina(new Date("2026-11-27T15:00:00Z"))).toBe("2026-11-27");
    expect(todayDdMmAaArgentina(new Date("2026-11-27T15:00:00Z"))).toBe("27/11/26");
  });
  it("22:00–23:59 ART ya es el día siguiente en UTC: sigue siendo el día argentino", () => {
    // 22:00 ART = 01:00 UTC del día siguiente; 23:59 ART = 02:59 UTC.
    expect(todayIsoArgentina(new Date("2026-11-28T01:00:00Z"))).toBe("2026-11-27");
    expect(todayIsoArgentina(new Date("2026-11-28T02:59:00Z"))).toBe("2026-11-27");
    expect(todayDdMmAaArgentina(new Date("2026-11-28T02:59:00Z"))).toBe("27/11/26");
  });
  it("medianoche ART (03:00 UTC) pasa al día siguiente; fin de año", () => {
    expect(todayIsoArgentina(new Date("2026-11-28T03:00:00Z"))).toBe("2026-11-28");
    expect(todayIsoArgentina(new Date("2026-12-31T23:30:00Z"))).toBe("2026-12-31");
    expect(todayDdMmAaArgentina(new Date("2027-01-01T02:59:59Z"))).toBe("31/12/26");
    expect(todayDdMmAaArgentina(new Date("2027-01-01T03:00:00Z"))).toBe("01/01/27");
  });
  it("isoToDdMmAa", () => {
    expect(isoToDdMmAa("2026-03-05")).toBe("05/03/26");
    expect(isoToDdMmAa("")).toBe("");
  });
});

describe("alta con OP automático (modo memoria)", () => {
  const actor = { email: "prod@laboratoriogenus.com.ar", sector: "PRODUCCION" as never };
  beforeEach(() => resetProductionPedidosMemoryForTests());

  it("nextOp parte del último OP real y el alta automática lo reasigna si ya estaba tomado", async () => {
    const svc = getProductionPedidosService();
    await svc.create(actor, { op: "25293", cliente: "A", producto: "P" });
    await svc.create(actor, { op: "25300", cliente: "B", producto: "P" });
    expect(await svc.nextOp(actor)).toBe("25301");
    const first = await svc.createWithMeta(actor, { op: "25301", cliente: "C", producto: "P", opAuto: true });
    expect(first.record.op).toBe("25301");
    expect(first.opReassigned).toBe(false);
    // El cliente tenía el autocompletado viejo (25301): el backend asigna el siguiente libre.
    const stale = await svc.createWithMeta(actor, { op: "25301", cliente: "D", producto: "P", opAuto: true });
    expect(stale.record.op).toBe("25302");
    expect(stale.opReassigned).toBe(true);
  });

  it("un OP tipeado a mano se respeta (un pedido puede tener varias líneas)", async () => {
    const svc = getProductionPedidosService();
    await svc.create(actor, { op: "100", cliente: "A", producto: "P1" });
    const manual = await svc.createWithMeta(actor, { op: "100", cliente: "A", producto: "P2" });
    expect(manual.record.op).toBe("100");
    expect(manual.opReassigned).toBe(false);
  });

  it("altas simultáneas automáticas: OP únicos y correlativos", async () => {
    const svc = getProductionPedidosService();
    await svc.create(actor, { op: "500", cliente: "A", producto: "P" });
    const res = await Promise.all(
      Array.from({ length: 20 }, (_, i) => svc.createWithMeta(actor, { op: "501", cliente: `C${i}`, producto: "P", opAuto: true }))
    );
    const ops = res.map((r) => Number(r.record.op)).sort((a, b) => a - b);
    expect(ops).toEqual(Array.from({ length: 20 }, (_, i) => 501 + i));
  });
});
