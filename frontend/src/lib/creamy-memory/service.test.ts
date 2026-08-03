import { describe, expect, it } from "vitest";
import { MemoryCreamyMemoryRepository } from "@/lib/creamy-memory/memory-repository";
import { CreamyMemoryService } from "@/lib/creamy-memory/service";
import {
  CreamyMemoryForbiddenError,
  CreamyMemoryNotFoundError,
  CreamyMemoryValidationError,
  type CreamyMemoryActor,
  type CreateOperationalMemoryInput,
} from "@/lib/creamy-memory/types";

function actor(email: string, sector: CreamyMemoryActor["sector"]): CreamyMemoryActor {
  return { email, sector };
}

function makeService() {
  return new CreamyMemoryService(new MemoryCreamyMemoryRepository());
}

const baseFact: CreateOperationalMemoryInput = {
  client: "Cliente ACME",
  product: "Crema Facial",
  productCode: "PR-100",
  materiaPrimaOriginal: "Glicerina Vegetal",
  materiaPrimaUtilizada: "Glicerina Sintética",
  motivo: "Quiebre de stock del proveedor habitual",
};

describe("CreamyMemoryService — memoria personal", () => {
  it("aísla memoria personal entre distintos emails", async () => {
    const service = makeService();
    const ana = actor("ana@genus.com", "ELABORACION");
    const beto = actor("beto@genus.com", "ELABORACION");

    await service.upsertUserMemory(ana, { memoryType: "preferencia", content: "Prefiere reportes en kg" });

    const ownList = await service.listUserMemories(ana, ana.email);
    expect(ownList).toHaveLength(1);
    expect(ownList[0].content).toContain("kg");

    await expect(service.listUserMemories(beto, ana.email)).rejects.toBeInstanceOf(CreamyMemoryForbiddenError);

    const betoList = await service.listUserMemories(beto, beto.email);
    expect(betoList).toHaveLength(0);
  });

  it("olvidar (soft delete) solo lo puede hacer el propio usuario", async () => {
    const service = makeService();
    const ana = actor("ana@genus.com", "ELABORACION");
    const beto = actor("beto@genus.com", "ELABORACION");
    const memory = await service.upsertUserMemory(ana, { memoryType: "nota", content: "Dato personal" });

    await expect(service.softDeleteUserMemory(beto, ana.email, memory.id)).rejects.toBeInstanceOf(
      CreamyMemoryForbiddenError
    );

    const forgotten = await service.softDeleteUserMemory(ana, ana.email, memory.id);
    expect(forgotten.status).toBe("deleted");
    expect(await service.listUserMemories(ana, ana.email)).toHaveLength(0);
  });
});

describe("CreamyMemoryService — memoria operativa compartida", () => {
  it("crea siempre en estado REPORTADA con fuente CHAT", async () => {
    const service = makeService();
    const elaboracion = actor("op@genus.com", "ELABORACION");
    const { memory, deduped } = await service.createOperationalMemory(elaboracion, baseFact);
    expect(deduped).toBe(false);
    expect(memory.estado).toBe("REPORTADA");
    expect(memory.fuente).toBe("CHAT");
    expect(memory.informadoPor).toBe(elaboracion.email);
    expect(memory.validadoPor).toBeNull();
  });

  it("solo Calidad, Producción o Dirección pueden validar", async () => {
    const service = makeService();
    const elaboracion = actor("op@genus.com", "ELABORACION");
    const calidad = actor("qa@genus.com", "CALIDAD");
    const { memory } = await service.createOperationalMemory(elaboracion, baseFact);

    await expect(service.validateOperationalMemory(elaboracion, memory.id)).rejects.toBeInstanceOf(
      CreamyMemoryForbiddenError
    );

    const validated = await service.validateOperationalMemory(calidad, memory.id);
    expect(validated.estado).toBe("VALIDADA");
    expect(validated.validadoPor).toBe(calidad.email);
  });

  it("revoca solo desde Calidad/Producción/Dirección", async () => {
    const service = makeService();
    const elaboracion = actor("op@genus.com", "ELABORACION");
    const produccion = actor("jefe@genus.com", "PRODUCCION");
    const { memory } = await service.createOperationalMemory(elaboracion, baseFact);

    await expect(service.revokeOperationalMemory(elaboracion, memory.id, "duplicado")).rejects.toBeInstanceOf(
      CreamyMemoryForbiddenError
    );

    const revoked = await service.revokeOperationalMemory(produccion, memory.id, "duplicado");
    expect(revoked.estado).toBe("REVOCADA");
  });

  it("corrige: el informante o Calidad/Producción pueden corregir, y una corrección desvalida", async () => {
    const service = makeService();
    const elaboracion = actor("op@genus.com", "ELABORACION");
    const calidad = actor("qa@genus.com", "CALIDAD");
    const otro = actor("otro@genus.com", "ENVASADO_MASIVO");
    const { memory } = await service.createOperationalMemory(elaboracion, baseFact);
    const validated = await service.validateOperationalMemory(calidad, memory.id);
    expect(validated.estado).toBe("VALIDADA");

    await expect(
      service.correctOperationalMemory(otro, memory.id, { motivo: "Otro motivo" })
    ).rejects.toBeInstanceOf(CreamyMemoryForbiddenError);

    const corrected = await service.correctOperationalMemory(elaboracion, memory.id, {
      motivo: "Motivo corregido tras revisión",
    });
    expect(corrected.motivo).toBe("Motivo corregido tras revisión");
    expect(corrected.estado).toBe("REPORTADA");
    expect(corrected.validadoPor).toBeNull();
  });

  it("deduplica por clave normalizada (cliente+producto+original+utilizada)", async () => {
    const service = makeService();
    const elaboracion = actor("op@genus.com", "ELABORACION");
    const first = await service.createOperationalMemory(elaboracion, baseFact);
    const second = await service.createOperationalMemory(elaboracion, {
      ...baseFact,
      motivo: "Motivo actualizado en el segundo reporte",
    });

    expect(second.deduped).toBe(true);
    expect(second.memory.id).toBe(first.memory.id);

    const results = await service.searchOperationalMemories(elaboracion, { client: "Cliente ACME" });
    expect(results).toHaveLength(1);
    expect(results[0].motivo).toBe("Motivo actualizado en el segundo reporte");
  });

  it("detecta contradicciones cuando hay reportes con distinta MP utilizada para el mismo original", async () => {
    const service = makeService();
    const elaboracion = actor("op@genus.com", "ELABORACION");
    await service.createOperationalMemory(elaboracion, baseFact);
    await service.createOperationalMemory(elaboracion, {
      ...baseFact,
      materiaPrimaUtilizada: "Glicerina de Coco",
      motivo: "Otro motivo distinto",
    });

    const results = await service.searchOperationalMemories(elaboracion, { client: "Cliente ACME" });
    expect(results).toHaveLength(2);

    const contradictions = service.detectContradictions(results);
    expect(contradictions).toHaveLength(1);
    expect(contradictions[0].memories).toHaveLength(2);
  });

  it("rechaza reportar hechos con valores tipo TEST_/fixture/mock", async () => {
    const service = makeService();
    const elaboracion = actor("op@genus.com", "ELABORACION");
    await expect(
      service.createOperationalMemory(elaboracion, { ...baseFact, client: "TEST_ACME" })
    ).rejects.toBeInstanceOf(CreamyMemoryValidationError);
  });

  it("filtra resultados TEST_* al buscar aunque hayan sido insertados directamente", async () => {
    const repo = new (await import("@/lib/creamy-memory/memory-repository")).MemoryCreamyMemoryRepository();
    const service = new CreamyMemoryService(repo);
    const elaboracion = actor("op@genus.com", "ELABORACION");

    await repo.insertOperationalMemory({
      id: "test-record-1",
      client: "Cliente Legítimo",
      product: "TEST_PRODUCTO",
      productCode: null,
      materiaPrimaOriginal: "MP-A",
      materiaPrimaUtilizada: "MP-B",
      codigoMpOriginal: null,
      codigoMpUtilizado: null,
      motivo: "Insertado directo para test de filtrado",
      observacion: null,
      cantidadOProporcion: null,
      relatedOrderRef: null,
      relatedOrderId: null,
      fecha: null,
      informadoPor: "seed@genus.com",
      validadoPor: null,
      estado: "REPORTADA",
      fuente: "CHAT",
      evidenceId: null,
      normalizedKey: "seed-key",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: "active",
    });

    const results = await service.searchOperationalMemories(elaboracion, { client: "Cliente Legítimo" });
    expect(results).toHaveLength(0);
  });

  it("no permite validar/corregir/revocar una memoria inexistente", async () => {
    const service = makeService();
    const calidad = actor("qa@genus.com", "CALIDAD");
    await expect(service.validateOperationalMemory(calidad, "no-existe")).rejects.toBeInstanceOf(
      CreamyMemoryNotFoundError
    );
  });
});

describe("CreamyMemoryService — sin secretos en la serialización", () => {
  it("un registro de memoria operativa serializado no contiene secretos ni claves", async () => {
    const service = makeService();
    const elaboracion = actor("op@genus.com", "ELABORACION");
    const { memory } = await service.createOperationalMemory(elaboracion, baseFact);
    const serialized = JSON.stringify(memory);
    expect(serialized).not.toMatch(/GEMINI_API_KEY|OPENAI_API_KEY|AIza|sk-[A-Za-z0-9]/);
  });
});
