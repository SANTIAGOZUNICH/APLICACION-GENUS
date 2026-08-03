import { describe, expect, it } from "vitest";
import { computeKg, formatKg, parseOptionalDecimal } from "./kg";
import { parseExcelPaste } from "./excel-paste";
import { canAccessProductionPedidos, coercePedidoFields, normalizeFecha } from "./types";
import {
  getProductionPedidosService,
  resetProductionPedidosMemoryForTests,
} from "./service";

describe("production pedidos kg", () => {
  it("Q=100 ML=30 → KG=3", () => {
    expect(computeKg(100, 30)).toBe(3);
    expect(formatKg(3)).toBe("3");
  });

  it("admite coma decimal y formatea sin ceros", () => {
    expect(parseOptionalDecimal("30,5")).toBe(30.5);
    expect(formatKg(computeKg(10, 33.3))).toBe("0.333");
  });

  it("deja vacío si falta Q o ML", () => {
    expect(computeKg(null, 30)).toBeNull();
    expect(computeKg(100, null)).toBeNull();
    expect(formatKg(null)).toBe("");
  });
});

describe("production pedidos paste", () => {
  it("pega sin encabezados y recalcula KG ignorando columna extra", () => {
    const text = "0012\t03/08/2026\t0C99\tCliente\tProd\tA\t100\t30\tINGRESO";
    const { rows, headerDetected } = parseExcelPaste(text);
    expect(headerDetected).toBe(false);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.op).toBe("0012");
    expect(rows[0]!.nroOc).toBe("0C99");
    expect(rows[0]!.fecha).toBe("2026-08-03");
    expect(rows[0]!.kg).toBe(3);
    expect(rows[0]!.valid).toBe(true);
  });

  it("pega con encabezados e ignora KG de Excel", () => {
    const text = [
      "OP\tFECHA\tN° OC\tCLIENTE\tPRODUCTO\tS\tQ\tML\tKG\tESTADO",
      "07\t5/8/26\t008\tAcme\tGel\tB\t100\t30\t999\tEN PROCESO",
    ].join("\n");
    const { rows, headerDetected } = parseExcelPaste(text);
    expect(headerDetected).toBe(true);
    expect(rows[0]!.kg).toBe(3);
    expect(rows[0]!.estado).toBe("EN_PROCESO");
    expect(rows[0]!.op).toBe("07");
    expect(rows[0]!.nroOc).toBe("008");
  });

  it("marca posibles duplicados", () => {
    const text = "1\t1/1/2026\tOC1\tC\tP\t\t1\t1\tINGRESO\n1\t1/1/2026\tOC1\tC\tP\t\t1\t1\tINGRESO";
    const { rows } = parseExcelPaste(text, ["1|oc1|c|p|2026-01-01"]);
    expect(rows[1]!.warnings.some((w) => /duplicado/i.test(w))).toBe(true);
  });
});

describe("production pedidos dates", () => {
  it("reconoce fechas argentinas", () => {
    expect(normalizeFecha("3/8/2026")).toBe("2026-08-03");
    expect(normalizeFecha("03-08-26")).toBe("2026-08-03");
  });
});

describe("production pedidos rbac + crud", () => {
  it("solo PRODUCCION / SUPERADMIN", () => {
    expect(canAccessProductionPedidos({ email: "a", sector: "PRODUCCION" })).toBe(true);
    expect(canAccessProductionPedidos({ email: "a", sector: "CALIDAD" })).toBe(false);
    expect(canAccessProductionPedidos({ email: "a", sector: "CALIDAD", roleId: "ROL-SU" })).toBe(true);
    expect(canAccessProductionPedidos({ email: "a", sector: "DEPOSITO", isSuperadmin: true })).toBe(true);
  });

  it("CRUD + delete con motivo + KG server-side", async () => {
    resetProductionPedidosMemoryForTests();
    const svc = getProductionPedidosService();
    const actor = { email: "produccion@test", sector: "PRODUCCION" as const };

    const created = await svc.create(actor, {
      op: "001",
      q: "100",
      ml: "30",
      estado: "INGRESO",
    });
    expect(created.kg).toBe(3);
    expect(created.kgDisplay).toBe("3");

    const updated = await svc.update(actor, created.id, {
      op: "001",
      q: "200",
      ml: "30",
      estado: "EN PROCESO",
    });
    expect(updated.kg).toBe(6);
    expect(updated.estado).toBe("EN_PROCESO");

    await expect(svc.remove(actor, created.id, "x")).rejects.toThrow(/motivo/i);
    const deleted = await svc.remove(actor, created.id, "Pedido de prueba");
    expect(deleted.deletedAt).toBeTruthy();
    expect(deleted.deleteReason).toBe("Pedido de prueba");

    const list = await svc.list(actor);
    expect(list.items.find((i) => i.id === created.id)).toBeUndefined();
  });

  it("campos opcionales permiten guardar vacío parcial", () => {
    const c = coercePedidoFields({ cliente: "Solo cliente" });
    expect(c.errors).toEqual([]);
    expect(c.cliente).toBe("Solo cliente");
    expect(c.kg).toBeNull();
  });

  it("prohíbe otros sectores", async () => {
    resetProductionPedidosMemoryForTests();
    const svc = getProductionPedidosService();
    await expect(
      svc.list({ email: "x", sector: "CODIFICADO" })
    ).rejects.toThrow(/PRODUCCIÓN/i);
  });
});
