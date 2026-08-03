import { describe, expect, it, beforeEach } from "vitest";
import { enrichControlLine, kgNecesariosFromPct } from "./calcs";
import {
  getMpControlService,
  resetMpControlMemoryForTests,
} from "./mp-control-service";
import type { MpFormulaSnapshot } from "./types";

describe("mp-control calcs", () => {
  it("calcula kg necesarios 100 y 250 kg", () => {
    expect(kgNecesariosFromPct(10, 100)).toBe(10);
    expect(kgNecesariosFromPct(10, 250)).toBe(25);
    expect(kgNecesariosFromPct(2.5, 100)).toBe(2.5);
  });

  it("estados según stock y código", () => {
    expect(
      enrichControlLine({
        codigo: "",
        materiaPrima: "X",
        formulaPct: 10,
        quantityKg: 100,
        stockActual: 50,
      }).estado
    ).toBe("Sin código");
    expect(
      enrichControlLine({
        codigo: "MP1",
        materiaPrima: "X",
        formulaPct: 10,
        quantityKg: 100,
        stockActual: 0,
      }).estado
    ).toBe("Sin stock");
    expect(
      enrichControlLine({
        codigo: "MP1",
        materiaPrima: "X",
        formulaPct: 10,
        quantityKg: 100,
        stockActual: 5,
      }).estado
    ).toBe("Parcial");
    expect(
      enrichControlLine({
        codigo: "MP1",
        materiaPrima: "X",
        formulaPct: 10,
        quantityKg: 100,
        stockActual: 20,
      }).estado
    ).toBe("Disponible");
  });
});

describe("MpControlService", () => {
  beforeEach(() => resetMpControlMemoryForTests());

  const snap: MpFormulaSnapshot = {
    client: "UNICA",
    product: "SHAMPOO SOLIDO",
    source: "DRIVE",
    driveFileId: "file-1",
    materials: [
      { materiaPrima: "Agua", codigo: "MP-AGUA", formulaPct: 80 },
      { materiaPrima: "Tensoactivo", codigo: "MP-TEN", formulaPct: 20 },
    ],
    capturedAt: new Date().toISOString(),
  };

  it("crea snapshot y recalcula kg sin mutar fórmula", async () => {
    const svc = getMpControlService();
    const actor = { email: "mp@test", sector: "MATERIA_PRIMA" as const };
    const c = await svc.create(actor, {
      client: "UNICA",
      product: "SHAMPOO SOLIDO",
      quantityKg: 100,
      snapshot: snap,
      stockByCodigo: { "MP-AGUA": 100, "MP-TEN": 50 },
    });
    expect(c.lines[0]!.kgNecesarios).toBe(80);
    expect(c.lines[1]!.kgNecesarios).toBe(20);
    const snapBefore = JSON.stringify(c.formulaSnapshot);

    const updated = await svc.update(actor, c.id, {
      quantityKg: 250,
      recalcFromSnapshot: true,
      stockByCodigo: { "MP-AGUA": 100, "MP-TEN": 50 },
    });
    expect(updated.lines[0]!.kgNecesarios).toBe(200);
    expect(updated.lines[1]!.kgNecesarios).toBe(50);
    expect(JSON.stringify(updated.formulaSnapshot)).toBe(snapBefore);
  });

  it("PRODUCCION no puede escribir; lectura sí", async () => {
    const svc = getMpControlService();
    await expect(
      svc.create(
        { email: "p@test", sector: "PRODUCCION" },
        {
          client: "UNICA",
          product: "X",
          quantityKg: 100,
          snapshot: snap,
        }
      )
    ).rejects.toThrow(/Solo MP/);
    const mp = await svc.create(
      { email: "mp@test", sector: "MATERIA_PRIMA" },
      {
        client: "UNICA",
        product: "X",
        quantityKg: 100,
        snapshot: snap,
      }
    );
    const list = await svc.list({ email: "p@test", sector: "PRODUCCION" });
    expect(list.some((x) => x.id === mp.id)).toBe(true);
  });

  it("control no descuenta stock (solo proyección)", async () => {
    const svc = getMpControlService();
    const c = await svc.create(
      { email: "mp@test", sector: "MATERIA_PRIMA" },
      {
        client: "UNICA",
        product: "X",
        quantityKg: 100,
        snapshot: snap,
        stockByCodigo: { "MP-AGUA": 100 },
      }
    );
    expect(c.lines[0]!.stockActual).toBe(100);
    expect(c.lines[0]!.stockProyectado).toBe(20);
    // stockActual de entrada intacto en línea (no muta ledger)
    expect(c.lines[0]!.stockActual).toBe(100);
  });

  it("lifecycle: completar → archivar → restaurar → anular", async () => {
    const svc = getMpControlService();
    const actor = { email: "mp@test", sector: "MATERIA_PRIMA" as const };
    const c = await svc.create(actor, {
      client: "UNICA",
      product: "X",
      quantityKg: 100,
      snapshot: snap,
    });
    const completed = await svc.update(actor, c.id, { status: "COMPLETADO" });
    expect(completed.status).toBe("COMPLETADO");

    const archived = await svc.archive(actor, c.id);
    expect(archived.status).toBe("ARCHIVADO");

    const restored = await svc.restore(actor, c.id);
    expect(restored.status).toBe("COMPLETADO");

    const annulled = await svc.annul(actor, c.id, "Error de fórmula");
    expect(annulled.status).toBe("ANULADO");
    expect(annulled.lifecycle?.annulReason).toBe("Error de fórmula");
  });

  it("no elimina borrador con OE vinculada", async () => {
    const svc = getMpControlService();
    const actor = { email: "mp@test", sector: "MATERIA_PRIMA" as const };
    const c = await svc.create(actor, {
      client: "UNICA",
      product: "X",
      quantityKg: 100,
      snapshot: snap,
    });
    await svc.update(actor, c.id, { linkedOeId: "oe-123" });
    await expect(svc.deleteDraft(actor, c.id)).rejects.toThrow(/OE vinculada/);
  });

  it("no hard-delete completado", async () => {
    const svc = getMpControlService();
    const actor = { email: "mp@test", sector: "MATERIA_PRIMA" as const };
    const c = await svc.create(actor, {
      client: "UNICA",
      product: "X",
      quantityKg: 100,
      snapshot: snap,
    });
    await svc.update(actor, c.id, { status: "COMPLETADO" });
    await expect(svc.deleteDraft(actor, c.id)).rejects.toThrow(/Anular o Archivar/);
  });
});
