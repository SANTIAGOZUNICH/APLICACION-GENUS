import { describe, expect, it, beforeEach } from "vitest";
import {
  getGranelesService,
  resetGranelesMemoryForTests,
} from "@/lib/graneles/graneles-service";
import { OrdersForbiddenError, OrdersNotFoundError } from "@/lib/orders/types";

describe("GranelesService", () => {
  beforeEach(() => {
    resetGranelesMemoryForTests();
  });

  const deposito = {
    email: "deposito@laboratoriogenus.com.ar",
    sector: "DEPOSITO" as const,
    displayName: "Depósito",
  };

  const envasado = {
    email: "envasado@laboratoriogenus.com.ar",
    sector: "ENVASADO_MASIVO" as const,
    displayName: "Envasado Masivo",
  };

  const calidad = {
    email: "calidad@laboratoriogenus.com.ar",
    sector: "CALIDAD" as const,
    displayName: "Calidad",
  };

  it("createManual y list para Depósito", async () => {
    const svc = getGranelesService();
    const record = await svc.createManual(deposito, { kg: 10, product: "Creamy" });
    expect(record.kgAvailable).toBe(10);
    const listed = await svc.list(deposito);
    expect(listed.some((row) => row.id === record.id)).toBe(true);
  });

  it("rechaza createManual para sector no autorizado", async () => {
    const svc = getGranelesService();
    await expect(svc.createManual(envasado, { kg: 5 })).rejects.toThrow(OrdersForbiddenError);
  });

  it("rechaza list para sector sin acceso", async () => {
    const svc = getGranelesService();
    await expect(svc.list(calidad)).rejects.toThrow(OrdersForbiddenError);
  });

  it("upsertFromEnvasado: reintento IDÉNTICO no duplica ni toca el registro", async () => {
    const svc = getGranelesService();
    const a = await svc.upsertFromEnvasado(envasado, {
      workItemId: "wi-1",
      originSector: "ENVASADO_MASIVO",
      product: "Crema",
      client: "Cliente A",
      bulkLot: "L-1",
      kg: 3.2,
      reportedBy: "Op",
    });
    expect(a.created).toBe(true);
    expect(a.duplicated).toBe(false);
    expect(a.updated).toBe(false);
    expect(a.record.kgAvailable).toBe(3.2);

    // Doble click / retry de red con el mismo payload — debe quedar
    // exactamente UN registro/movimiento, no dos.
    const b = await svc.upsertFromEnvasado(envasado, {
      workItemId: "wi-1",
      originSector: "ENVASADO_MASIVO",
      product: "Crema",
      client: "Cliente A",
      bulkLot: "L-1",
      kg: 3.2,
      reportedBy: "Op",
    });
    expect(b.created).toBe(false);
    expect(b.duplicated).toBe(true);
    expect(b.updated).toBe(false);
    expect(b.record.kgAvailable).toBe(3.2);
    expect(b.record.id).toBe(a.record.id);

    const listed = await svc.list(deposito);
    expect(listed.filter((row) => row.workItemId === "wi-1")).toHaveLength(1);
  });

  it("upsertFromEnvasado: una CORRECCIÓN (kg distinto) actualiza el registro en vez de descartarla en silencio", async () => {
    // Bug real encontrado en la auditoría: Envasado reenvía con un kg
    // corregido (4.5kg -> 3.2kg) y el saldo de Depósito quedaba pegado al
    // primer valor para siempre, sin aviso — ver informe.
    const svc = getGranelesService();
    const a = await svc.upsertFromEnvasado(envasado, {
      workItemId: "wi-1",
      originSector: "ENVASADO_MASIVO",
      product: "Crema",
      client: "Cliente A",
      bulkLot: "L-1",
      kg: 4.5,
      reportedBy: "Op",
    });
    expect(a.record.kgAvailable).toBe(4.5);

    const corrected = await svc.upsertFromEnvasado(envasado, {
      workItemId: "wi-1",
      originSector: "ENVASADO_MASIVO",
      product: "Crema",
      client: "Cliente A",
      bulkLot: "L-1",
      kg: 3.2,
      reportedBy: "Op",
    });
    expect(corrected.created).toBe(false);
    expect(corrected.duplicated).toBe(false);
    expect(corrected.updated).toBe(true);
    expect(corrected.record.id).toBe(a.record.id);
    expect(corrected.record.kgAvailable).toBe(3.2);

    // El saldo real en Depósito refleja la corrección — no queda un
    // segundo registro ni el valor viejo.
    const listed = await svc.list(deposito);
    const matching = listed.filter((row) => row.workItemId === "wi-1");
    expect(matching).toHaveLength(1);
    expect(matching[0]!.kgAvailable).toBe(3.2);

    const audit = await svc.listAudit(deposito, a.record.id);
    const delta = audit.find((entry) => entry.action === "delta");
    expect(delta).toBeTruthy();
    expect(delta?.beforeKg).toBe(4.5);
    expect(delta?.afterKg).toBe(3.2);
  });

  it("deleteOrAnnul: manual borrador hace hard delete", async () => {
    const svc = getGranelesService();
    const record = await svc.createManual(deposito, { kg: 0, asDraft: true });
    expect(record.status).toBe("BORRADOR");
    const result = await svc.deleteOrAnnul(deposito, record.id, "Prueba");
    expect(result.action).toBe("eliminar");
    expect(await svc.get(deposito, record.id)).toBeNull();
  });

  it("deleteOrAnnul: registro originado en Envasado se anula (no hard delete)", async () => {
    const svc = getGranelesService();
    const { record } = await svc.upsertFromEnvasado(envasado, {
      workItemId: "wi-2",
      originSector: "ENVASADO_MASIVO",
      product: "P",
      client: "C",
      bulkLot: "L-2",
      kg: 5,
      reportedBy: "Op",
    });
    const result = await svc.deleteOrAnnul(deposito, record.id, "Motivo X");
    expect(result.action).toBe("anular");
    const reloaded = await svc.get(deposito, record.id);
    expect(reloaded?.status).toBe("ANULADO");
    expect(reloaded?.annulReason).toBe("Motivo X");
  });

  it("deleteOrAnnul es idempotente: anular dos veces no falla ni duplica auditoría", async () => {
    const svc = getGranelesService();
    const { record } = await svc.upsertFromEnvasado(envasado, {
      workItemId: "wi-3",
      originSector: "ENVASADO_MASIVO",
      product: "P",
      client: "C",
      bulkLot: "L-3",
      kg: 8,
      reportedBy: "Op",
    });
    const first = await svc.deleteOrAnnul(deposito, record.id, "Primer motivo");
    expect(first.action).toBe("anular");
    const auditAfterFirst = await svc.listAudit(deposito, record.id);

    const second = await svc.deleteOrAnnul(deposito, record.id, "Segundo motivo");
    expect(second.action).toBe("anular");
    const auditAfterSecond = await svc.listAudit(deposito, record.id);
    expect(auditAfterSecond.length).toBe(auditAfterFirst.length);

    const reloaded = await svc.get(deposito, record.id);
    expect(reloaded?.status).toBe("ANULADO");
    expect(reloaded?.annulReason).toBe("Primer motivo");
  });

  it("deleteOrAnnul lanza NotFound si el registro no existe", async () => {
    const svc = getGranelesService();
    await expect(svc.deleteOrAnnul(deposito, "missing-id")).rejects.toThrow(OrdersNotFoundError);
  });

  it("list excluye ANULADO y ARCHIVADO por defecto", async () => {
    const svc = getGranelesService();
    const active = await svc.createManual(deposito, { kg: 1, product: "Activo" });
    const { record: toAnnul } = await svc.upsertFromEnvasado(envasado, {
      workItemId: "wi-4",
      originSector: "ENVASADO_MASIVO",
      product: "P",
      client: "C",
      bulkLot: "L-4",
      kg: 3,
      reportedBy: "Op",
    });
    await svc.deleteOrAnnul(deposito, toAnnul.id, "Anular para test");

    const defaultList = await svc.list(deposito);
    expect(defaultList.some((row) => row.id === active.id)).toBe(true);
    expect(defaultList.some((row) => row.id === toAnnul.id)).toBe(false);

    const includeAnnulled = await svc.list(deposito, { includeAnnulled: true });
    expect(includeAnnulled.some((row) => row.id === toAnnul.id)).toBe(true);

    const onlyAnnulled = await svc.list(deposito, { status: "ANULADO" });
    expect(onlyAnnulled.every((row) => row.status === "ANULADO")).toBe(true);
    expect(onlyAnnulled.some((row) => row.id === toAnnul.id)).toBe(true);
  });

  it("update aplica delta de kg y pasa a AGOTADO en 0", async () => {
    const svc = getGranelesService();
    const record = await svc.createManual(deposito, { kg: 10, product: "P" });
    const updated = await svc.update(deposito, record.id, { patch: { kgAvailable: 0 } });
    expect(updated.status).toBe("AGOTADO");
  });
});
