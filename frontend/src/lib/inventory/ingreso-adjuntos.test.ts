import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { IngresoAdjuntosService, MemoryAdjuntosStore } from "@/lib/inventory/ingreso-adjuntos-service";
import {
  ADJUNTO_MAX_BYTES,
  ADJUNTO_MAX_PER_INGRESO,
  canManageAdjuntos,
  canViewAdjuntos,
  sniffImageType,
  validateAdjuntoFile,
} from "@/lib/inventory/ingreso-adjuntos-rules";
import { getFileStorage, resetMemoryFileStorageForTests } from "@/lib/storage/file-storage";
import type { SectorId } from "@/types/operational/sector";

const ING_MP = "11111111-1111-4111-8111-111111111111";
const ING_ME = "22222222-2222-4222-8222-222222222222";
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
const HEIC = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0]);
const actor = (sector: SectorId) => ({ email: `${sector.toLowerCase()}@genus.test`, sector });

describe("Fotos de remito en ingresos MP/ME", () => {
  let store: MemoryAdjuntosStore;
  let service: IngresoAdjuntosService;

  beforeEach(() => {
    resetMemoryFileStorageForTests();
    store = new MemoryAdjuntosStore();
    store.ingresos.add(`MP:${ING_MP}`);
    store.ingresos.add(`ME:${ING_ME}`);
    service = new IngresoAdjuntosService(store);
  });

  it("formatos: JPG/JPEG/PNG/HEIC sí; otros no; tamaño máximo 4 MB", () => {
    for (const name of ["a.jpg", "a.JPEG", "a.png", "IMG_1.HEIC", "b.heif"]) {
      expect(validateAdjuntoFile({ name, type: "", size: 10 }).ok).toBe(true);
    }
    expect(validateAdjuntoFile({ name: "a.pdf", type: "application/pdf", size: 10 }).ok).toBe(false);
    expect(validateAdjuntoFile({ name: "a.gif", type: "image/gif", size: 10 }).ok).toBe(false);
    expect(validateAdjuntoFile({ name: "a.jpg", type: "image/jpeg", size: ADJUNTO_MAX_BYTES + 1 })).toMatchObject({ ok: false });
    expect(validateAdjuntoFile({ name: "a.jpg", type: "image/jpeg", size: 0 })).toMatchObject({ ok: false });
    expect(sniffImageType(JPG)).toBe("image/jpeg");
    expect(sniffImageType(PNG)).toBe("image/png");
    expect(sniffImageType(HEIC)).toBe("image/heic");
    expect(sniffImageType(new Uint8Array([1, 2, 3, 4, 5]))).toBeNull();
  });

  it("permisos: MP adjunta en Ingresos MP, Depósito en Ingresos ME, Dirección en ambos; otros solo ven", () => {
    expect(canManageAdjuntos("MATERIA_PRIMA", "MP")).toBe(true);
    expect(canManageAdjuntos("DEPOSITO", "ME")).toBe(true);
    expect(canManageAdjuntos("DIRECCION", "MP")).toBe(true);
    expect(canManageAdjuntos("DIRECCION", "ME")).toBe(true);
    expect(canManageAdjuntos("DEPOSITO", "MP")).toBe(false);
    expect(canManageAdjuntos("MATERIA_PRIMA", "ME")).toBe(false);
    expect(canManageAdjuntos("PRODUCCION", "MP")).toBe(false);
    expect(canViewAdjuntos("PRODUCCION", "MP")).toBe(true);
    expect(canViewAdjuntos("ELABORACION", "MP")).toBe(false);
  });

  it("varias fotos por ingreso, guardadas en el almacenamiento persistente con quién y cuándo", async () => {
    const a = await service.upload(actor("MATERIA_PRIMA"), { module: "MP", ingresoId: ING_MP, fileName: "remito 1.jpg", contentType: "image/jpeg", bytes: JPG });
    const b = await service.upload(actor("MATERIA_PRIMA"), { module: "MP", ingresoId: ING_MP, fileName: "IMG_2.HEIC", contentType: "", bytes: HEIC });
    const list = await service.list(actor("PRODUCCION"), "MP", ING_MP);
    expect(list.map((x) => x.id)).toEqual([a.id, b.id]);
    expect(list[0]).toMatchObject({ uploadedBy: "materia_prima@genus.test", uploadedBySector: "MATERIA_PRIMA", contentType: "image/jpeg" });
    expect(list[1]!.contentType).toBe("image/heic");
    const got = await service.download(actor("PRODUCCION"), a.id);
    expect([...got.bytes]).toEqual([...JPG]);
    expect(store.rows[0]!.storageKey).toMatch(new RegExp(`^ingresos-remitos/mp/${ING_MP}/`));
    expect(await getFileStorage().exists(store.rows[0]!.storageKey)).toBe(true);
    expect(await service.counts(actor("PRODUCCION"), "MP")).toEqual({ [ING_MP]: 2 });
  });

  it("rechaza sector sin permiso, ingreso inexistente y archivos que no son imagen", async () => {
    await expect(
      service.upload(actor("DEPOSITO"), { module: "MP", ingresoId: ING_MP, fileName: "a.jpg", contentType: "image/jpeg", bytes: JPG })
    ).rejects.toThrow(/permiso/);
    await expect(
      service.upload(actor("MATERIA_PRIMA"), { module: "MP", ingresoId: ING_ME, fileName: "a.jpg", contentType: "image/jpeg", bytes: JPG })
    ).rejects.toThrow(/No se encontró el ingreso/);
    await expect(
      service.upload(actor("MATERIA_PRIMA"), { module: "MP", ingresoId: ING_MP, fileName: "a.jpg", contentType: "image/jpeg", bytes: new Uint8Array([1, 2, 3, 4]) })
    ).rejects.toThrow(/no es una imagen/);
    await expect(service.list(actor("ELABORACION"), "MP", ING_MP)).rejects.toThrow(/permiso/);
    expect(store.rows).toHaveLength(0);
  });

  it("ME: Depósito adjunta y Envasado puede verlas", async () => {
    const x = await service.upload(actor("DEPOSITO"), { module: "ME", ingresoId: ING_ME, fileName: "r.png", contentType: "image/png", bytes: PNG });
    expect((await service.list(actor("ENVASADO_MASIVO"), "ME", ING_ME)).map((i) => i.id)).toEqual([x.id]);
    expect(await service.list(actor("DEPOSITO"), "MP", ING_ME)).toEqual([]);
  });

  it("quitar una foto: deja de listarse pero el archivo y el registro se conservan (auditable); idempotente", async () => {
    const a = await service.upload(actor("MATERIA_PRIMA"), { module: "MP", ingresoId: ING_MP, fileName: "a.jpg", contentType: "image/jpeg", bytes: JPG });
    await expect(service.remove(actor("PRODUCCION"), a.id)).rejects.toThrow(/permiso/);
    await service.remove(actor("MATERIA_PRIMA"), a.id);
    await service.remove(actor("MATERIA_PRIMA"), a.id);
    expect(await service.list(actor("MATERIA_PRIMA"), "MP", ING_MP)).toEqual([]);
    expect(store.rows[0]).toMatchObject({ deletedBy: "materia_prima@genus.test" });
    expect(await getFileStorage().exists(store.rows[0]!.storageKey)).toBe(true);
    await expect(service.download(actor("MATERIA_PRIMA"), a.id)).rejects.toThrow(/no encontrada/);
  });

  it(`máximo ${ADJUNTO_MAX_PER_INGRESO} fotos activas por ingreso`, async () => {
    for (let i = 0; i < ADJUNTO_MAX_PER_INGRESO; i++) {
      await service.upload(actor("MATERIA_PRIMA"), { module: "MP", ingresoId: ING_MP, fileName: `f${i}.jpg`, contentType: "image/jpeg", bytes: JPG });
    }
    await expect(
      service.upload(actor("MATERIA_PRIMA"), { module: "MP", ingresoId: ING_MP, fileName: "extra.jpg", contentType: "image/jpeg", bytes: JPG })
    ).rejects.toThrow(/máximo/);
  });
});
