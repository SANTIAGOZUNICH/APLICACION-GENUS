/**
 * Carga asistida de ingresos ME desde remito (IA propone → preview → humano confirma → ledger).
 * La IA se simula con un lector falso: se prueba todo lo que ocurre server-side.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { InventoryService, InventoryValidationError } from "../inventory-service";
import { MemoryInventoryRepo } from "../memory-repo";
import { applyOaDeliveryToMe } from "../me-oa-bridge";
import { createEmptyOaContent, emptyOaMaterial, normalizeOrderContent } from "@/lib/orders/content";
import type { OperationalOrderRecord } from "@/lib/orders/types";
import { getFileStorage } from "@/lib/storage/file-storage";
import type { SectorId } from "@/types/operational/sector";
import { RemitoAiInvalidResponseError, RemitoUnreadableError, parseRemitoDate } from "./extraction";
import { normalizeRemitoNumber, parseCantidadRemito } from "./normalize";
import type { RemitoReader, RemitoReaderFile } from "./reader";
import {
  MeRemitoIngresoService,
  RemitoDuplicateError,
  type ConfirmLineInput,
  type RemitoPreview,
} from "./remito-ingreso-service";

const deposito = { email: "deposito@laboratoriogenus.com.ar", sector: "DEPOSITO" as SectorId };
const produccion = {
  email: "produccion@laboratoriogenus.com.ar",
  sector: "PRODUCCION" as SectorId,
  displayName: "Producción",
};

class FakeReader implements RemitoReader {
  info = { provider: "fake", model: "fake-1" };
  next: unknown = null;
  calls: RemitoReaderFile[][] = [];
  async read(files: RemitoReaderFile[]) {
    this.calls.push(files);
    return this.next;
  }
}

let seq = 0;
function jpeg(): RemitoReaderFile {
  seq += 1;
  return {
    bytes: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(`foto-${seq}-${Math.random()}`)]),
    contentType: "image/jpeg",
    name: `remito-${seq}.jpg`,
  };
}

type RawItem = { d: string; q: string; u?: string; code?: string };
function raw(items: RawItem[], over: Record<string, unknown> = {}) {
  return {
    esRemito: true,
    legible: true,
    motivo: "",
    proveedor: "Vidriería Norte SA",
    numeroRemito: "0001-000123",
    fecha: "05/10/2026",
    items: items.map((i) => ({
      descripcionOriginal: i.d,
      codigoProveedor: i.code ?? "",
      cantidadTexto: i.q,
      unidadOriginal: i.u ?? "UN",
    })),
    ...over,
  };
}

let repo: MemoryInventoryRepo;
let inv: InventoryService;
let reader: FakeReader;
let svc: MeRemitoIngresoService;
const mat: Record<string, string> = {};

function seedMaterial(key: string, codigo: string, descripcion: string, extra: { cantidadPorBulto?: number } = {}) {
  const m = inv.resolveMeMaterialByCodigo(deposito, { codigo, descripcion });
  if (extra.cantidadPorBulto) {
    repo.upsertMeMaterial({ ...repo.getMeMaterial(m.id)!, cantidadPorBulto: extra.cantidadPorBulto });
  }
  mat[key] = m.id;
  return m.id;
}

beforeEach(() => {
  repo = new MemoryInventoryRepo();
  inv = new InventoryService(repo);
  reader = new FakeReader();
  svc = new MeRemitoIngresoService(inv, repo, { reader, storage: getFileStorage });
  seedMaterial("frasco30", "FR-V30", "FRASCO VIDRIO 30 ML");
  seedMaterial("gotero", "GOT-N", "GOTERO NEGRO");
  seedMaterial("estuche", "EST-R", "ESTUCHE ROSEHIP");
  seedMaterial("tapa24", "TP-24", "TAPA BLANCA 24/410");
  seedMaterial("tapa28", "TP-28", "TAPA BLANCA 28/410");
  seedMaterial("pet", "PET-250", "FRASCO PET CILINDRICO NATURAL 250 ML");
});

async function analyze(items: RawItem[], over: Record<string, unknown> = {}, files = [jpeg()]) {
  reader.next = raw(items, over);
  return svc.analyze(deposito, files);
}

/** Confirmación "feliz": acepta lo sugerido tal cual. */
function acceptAll(p: RemitoPreview, overrides: Record<string, Partial<ConfirmLineInput>> = {}): ConfirmLineInput[] {
  return p.lines.map((l) => ({
    lineId: l.id,
    include: l.includeDefault,
    materialId: l.materialSugeridoId,
    cantidad: l.cantidadInterpretada,
    ...overrides[l.id],
  }));
}

const stockOf = (id: string) => inv.listMeMaterials(deposito).find((m) => m.id === id)?.stockActual;

describe("parseo determinístico", () => {
  it("cantidades es-AR: 1.000 / 1000 / 1,000 / 2,5 / 1.000,50", () => {
    expect(parseCantidadRemito("1.000")).toBe(1000);
    expect(parseCantidadRemito("1000")).toBe(1000);
    expect(parseCantidadRemito("1,000")).toBe(1000);
    expect(parseCantidadRemito("2,5")).toBe(2.5);
    expect(parseCantidadRemito("1.000,50")).toBe(1000.5);
    expect(parseCantidadRemito("2.000.000")).toBe(2_000_000);
    expect(parseCantidadRemito("abc")).toBeNull();
  });
  it("fechas y número de remito", () => {
    expect(parseRemitoDate("05/10/2026", new Date("2026-10-07"))).toBe("2026-10-05");
    expect(parseRemitoDate("31/02/2026")).toBeNull();
    expect(parseRemitoDate("")).toBeNull();
    expect(normalizeRemitoNumber("0001-000123")).toBe(normalizeRemitoNumber("1 - 123"));
  });
});

describe("1-3 · interpretación y matching", () => {
  it("1. foto clara con 3 materiales → preview con los 3 asociados (ALTA) y nada guardado", async () => {
    const p = await analyze([
      { d: "FRASCO VIDRIO 30 ML", q: "2.000" },
      { d: "GOTERO NEGRO", q: "2.000" },
      { d: "ESTUCHE ROSEHIP", q: "1.000" },
    ]);
    expect(p.docId).toBeTruthy();
    expect(p.lines.map((l) => [l.confianza, l.cantidadInterpretada])).toEqual([
      ["ALTA", 2000],
      ["ALTA", 2000],
      ["ALTA", 1000],
    ]);
    expect(p.lines.map((l) => l.materialSugeridoId)).toEqual([mat.frasco30, mat.gotero, mat.estuche]);
    // Analizar NO crea movimientos.
    expect(repo.meIngresos).toHaveLength(0);
    expect(repo.meRemitoDocs[0]?.status).toBe("ANALIZADO");
    expect(repo.meRemitoDocs[0]?.files).toHaveLength(1);
  });

  it("2. abreviaciones del mismo material", async () => {
    const p = await analyze([
      { d: "FCO VID 30", q: "100" },
      { d: "FRASCO VIDRIO X30", q: "100" },
      { d: "FCO V° 30 ML", q: "100" },
    ]);
    for (const l of p.lines) {
      expect(l.materialSugeridoId).toBe(mat.frasco30);
      expect(["ALTA", "MEDIA"]).toContain(l.confianza);
    }
  });

  it("3. material exacto por descripción y por código", async () => {
    const p = await analyze([
      { d: "GOTERO NEGRO", q: "10" },
      { d: "cualquier cosa del proveedor", q: "10", code: "est-r" },
    ]);
    expect(p.lines[0]).toMatchObject({ materialSugeridoId: mat.gotero, confianza: "ALTA", matchSource: "DESCRIPCION" });
    expect(p.lines[1]).toMatchObject({ materialSugeridoId: mat.estuche, confianza: "ALTA", matchSource: "CODIGO" });
  });

  it("5. match ambiguo (TAPA BLANCA 24 vs 24/410, 28/410): NO decide, ofrece candidatos", async () => {
    const p = await analyze([{ d: "TAPA BLANCA 24", q: "500" }]);
    const l = p.lines[0]!;
    expect(l.materialSugeridoId).toBeNull();
    expect(l.confianza).toBe("BAJA");
    expect(l.candidates.map((c) => c.materialId)).toContain(mat.tapa24);
  });

  it("6. material inexistente → SIN_COINCIDENCIA y no inventa", async () => {
    const p = await analyze([{ d: "BOMBA DOSIFICADORA ROJA", q: "50" }]);
    expect(p.lines[0]).toMatchObject({ materialSugeridoId: null, confianza: "SIN_COINCIDENCIA", candidates: [] });
  });
});

describe("7-8 · cantidades y unidades", () => {
  it("7. FRASCO 30 ML con 1000 UN → cantidad 1000, no 30", async () => {
    const p = await analyze([{ d: "FRASCO VIDRIO 30 ML", q: "1000", u: "UN" }]);
    expect(p.lines[0]!.cantidadInterpretada).toBe(1000);
    expect(p.lines[0]!.revisarCantidad).toBe(false);
  });
  it("7b. si la cantidad coincide con la medida del envase se marca para revisar", async () => {
    const p = await analyze([{ d: "FRASCO VIDRIO 30 ML", q: "30", u: "UN" }]);
    expect(p.lines[0]!.revisarCantidad).toBe(true);
  });
  it("8. cajas sin conversión conocida → REQUIERE CONVERSIÓN, nunca asume 10 unidades", async () => {
    const p = await analyze([{ d: "GOTERO NEGRO", q: "10", u: "CAJAS" }]);
    const l = p.lines[0]!;
    expect(l.requiereConversion).toBe(true);
    expect(() =>
      svc.confirm(deposito, { docId: p.docId!, lines: [{ lineId: l.id, include: true, materialId: mat.gotero, cantidad: 10 }] })
    ).toThrow(/confirmá las unidades/i);
    expect(repo.meIngresos).toHaveLength(0);
    const ok = svc.confirm(deposito, {
      docId: p.docId!,
      lines: [{ lineId: l.id, include: true, materialId: mat.gotero, cantidad: 5000, conversionConfirmada: true }],
    });
    expect(ok.ingresos[0]!.total).toBe(5000);
  });
});

describe("4/11/12/13 · confirmación humana, alias y auditoría", () => {
  it("4. alias histórico: lo confirmado por el operario se reconoce la próxima vez (ALTA)", async () => {
    const first = await analyze([{ d: "BOT X 250 N", q: "300" }], { numeroRemito: "0001-000200" });
    expect(first.lines[0]!.materialSugeridoId).toBeNull();
    svc.confirm(deposito, {
      docId: first.docId!,
      lines: [{ lineId: first.lines[0]!.id, include: true, materialId: mat.pet, cantidad: 300 }],
    });
    expect(repo.meRemitoAliases).toHaveLength(1);

    const second = await analyze([{ d: "bot x 250 n", q: "100" }], { numeroRemito: "0001-000201" });
    expect(second.lines[0]).toMatchObject({ materialSugeridoId: mat.pet, confianza: "ALTA", matchSource: "ALIAS" });
    // Otro proveedor NO hereda el alias.
    const third = await analyze([{ d: "BOT X 250 N", q: "100" }], { numeroRemito: "9", proveedor: "Otro Proveedor" });
    expect(third.lines[0]!.matchSource).not.toBe("ALIAS");
  });

  it("11. el usuario corrige la cantidad: queda interpretado vs confirmado", async () => {
    const p = await analyze([{ d: "GOTERO NEGRO", q: "100" }]);
    const res = svc.confirm(deposito, { docId: p.docId!, lines: acceptAll(p, { [p.lines[0]!.id]: { cantidad: 1000 } }) });
    const ing = res.ingresos[0]!;
    expect(ing).toMatchObject({
      source: "REMITO_AI",
      total: 1000,
      cantidadInterpretada: 100,
      descripcionOriginal: "GOTERO NEGRO",
      remitoNro: "0001-000123",
      proveedor: "Vidriería Norte SA",
      fecha: "2026-10-05",
      remitoDocumentoId: p.docId,
      confirmadoPor: deposito.email,
    });
    expect(ing.confirmadoAt).toBeTruthy();
    expect(res.doc.corrections).toContainEqual({ lineId: p.lines[0]!.id, campo: "cantidad", interpretado: 100, confirmado: 1000 });
    expect(stockOf(mat.gotero!)).toBe(1000);
  });

  it("12. el usuario cambia el material sugerido (queda registrado y se aprende)", async () => {
    const p = await analyze([{ d: "GOTERO NEGRO", q: "10" }]);
    const res = svc.confirm(deposito, { docId: p.docId!, lines: acceptAll(p, { [p.lines[0]!.id]: { materialId: mat.estuche! } }) });
    expect(res.ingresos[0]!.codigo).toBe("EST-R");
    expect(res.ingresos[0]!.materialSugeridoId).toBe(mat.gotero);
    expect(res.doc.corrections.some((c) => c.campo === "material")).toBe(true);
    expect(repo.meRemitoAliases[0]!.materialId).toBe(mat.estuche);
  });

  it("13. el usuario excluye una fila: no se ingresa ni se aprende", async () => {
    const p = await analyze([
      { d: "GOTERO NEGRO", q: "10" },
      { d: "ESTUCHE ROSEHIP", q: "20" },
    ]);
    const res = svc.confirm(deposito, { docId: p.docId!, lines: acceptAll(p, { [p.lines[1]!.id]: { include: false } }) });
    expect(res.ingresos).toHaveLength(1);
    expect(stockOf(mat.estuche!)).toBe(0);
    expect(repo.meRemitoAliases).toHaveLength(1);
    expect(res.doc.confirmedLines.find((l) => l.lineId === p.lines[1]!.id)?.incluida).toBe(false);
  });

  it("no confirma líneas sin material, con material inexistente o sin ninguna línea", async () => {
    const p = await analyze([{ d: "BOMBA DOSIFICADORA ROJA", q: "5" }]);
    const id = p.lines[0]!.id;
    expect(() => svc.confirm(deposito, { docId: p.docId!, lines: [{ lineId: id, include: true, materialId: null, cantidad: 5 }] })).toThrow(
      InventoryValidationError
    );
    expect(() =>
      svc.confirm(deposito, { docId: p.docId!, lines: [{ lineId: id, include: true, materialId: "00000000-0000-4000-8000-000000000000", cantidad: 5 }] })
    ).toThrow(/catálogo/);
    expect(() => svc.confirm(deposito, { docId: p.docId!, lines: [{ lineId: id, include: false, materialId: null, cantidad: null }] })).toThrow(
      /No hay líneas/
    );
    expect(repo.meIngresos).toHaveLength(0);
  });
});

describe("9/10 · duplicados", () => {
  it("9. mismo proveedor + N° de remito ya cargado → bloquea y muestra quién/cuándo", async () => {
    const p = await analyze([{ d: "GOTERO NEGRO", q: "10" }]);
    const done = svc.confirm(deposito, { docId: p.docId!, lines: acceptAll(p) });
    const again = await analyze([{ d: "GOTERO NEGRO", q: "10" }]); // otra foto del mismo remito
    expect(again.docId).toBeNull();
    expect(again.duplicate).toMatchObject({ motivo: "NUMERO", numeroRemito: "0001-000123", confirmedBy: deposito.email });
    expect(again.duplicate!.ingresoNros).toEqual(done.ingresos.map((i) => i.ingresoNro));
    expect(repo.meIngresos).toHaveLength(1);
    expect(stockOf(mat.gotero!)).toBe(10);
  });

  it("9b. el mismo archivo re-subido se detecta sin gastar IA; reconfirmar el doc no duplica", async () => {
    const f = jpeg();
    const p = await analyze([{ d: "GOTERO NEGRO", q: "10" }], {}, [f]);
    svc.confirm(deposito, { docId: p.docId!, lines: acceptAll(p) });
    const calls = reader.calls.length;
    const again = await svc.analyze(deposito, [f]);
    expect(again.duplicate?.motivo).toBe("ARCHIVO");
    expect(reader.calls.length).toBe(calls);
    // Reintento/doble click de la confirmación: no crea otro movimiento.
    expect(() => svc.confirm(deposito, { docId: p.docId!, lines: acceptAll(p) })).toThrow(RemitoDuplicateError);
    expect(repo.meIngresos).toHaveLength(1);
    expect(stockOf(mat.gotero!)).toBe(10);
  });

  it("9c. corregir el N° de remito a uno ya cargado también bloquea", async () => {
    const a = await analyze([{ d: "GOTERO NEGRO", q: "10" }]);
    svc.confirm(deposito, { docId: a.docId!, lines: acceptAll(a) });
    const b = await analyze([{ d: "GOTERO NEGRO", q: "10" }], { numeroRemito: "0001-000999" });
    expect(() => svc.confirm(deposito, { docId: b.docId!, header: { numeroRemito: "1-123" }, lines: acceptAll(b) })).toThrow(
      RemitoDuplicateError
    );
  });

  it("10. número de remito ilegible → advierte que no se garantiza la detección de duplicados", async () => {
    const p = await analyze([{ d: "GOTERO NEGRO", q: "10" }], { numeroRemito: "" });
    expect(p.warnings.join(" ")).toMatch(/duplicados/i);
    expect(p.duplicate).toBeNull();
  });
});

describe("14-16 · varias páginas, respuesta inválida, no-remito", () => {
  it("14. varias páginas = un mismo remito; línea idéntica repetida arranca excluida", async () => {
    const files = [jpeg(), jpeg()];
    const p = await analyze(
      [
        { d: "GOTERO NEGRO", q: "10" },
        { d: "ESTUCHE ROSEHIP", q: "20" },
        { d: "ESTUCHE ROSEHIP", q: "20" },
      ],
      {},
      files
    );
    expect(reader.calls[0]).toHaveLength(2);
    expect(repo.meRemitoDocs[0]!.files).toHaveLength(2);
    expect(p.lines.map((l) => l.includeDefault)).toEqual([true, true, false]);
    const res = svc.confirm(deposito, { docId: p.docId!, lines: acceptAll(p) });
    expect(res.ingresos).toHaveLength(2);
    expect(stockOf(mat.estuche!)).toBe(20);
  });

  it("15. respuesta de IA inválida → error y nada guardado", async () => {
    for (const bad of [{ foo: 1 }, "texto libre", null, { esRemito: true, legible: true, items: "x" }]) {
      reader.next = bad;
      await expect(svc.analyze(deposito, [jpeg()])).rejects.toBeInstanceOf(RemitoAiInvalidResponseError);
    }
    expect(repo.meRemitoDocs).toHaveLength(0);
    expect(repo.meIngresos).toHaveLength(0);
  });

  it("16. archivo que no es remito / ilegible / sin líneas → 'no pudimos leer' sin inventar", async () => {
    reader.next = raw([], { esRemito: false, motivo: "es una selfie" });
    await expect(svc.analyze(deposito, [jpeg()])).rejects.toBeInstanceOf(RemitoUnreadableError);
    reader.next = raw([{ d: "GOTERO", q: "1" }], { legible: false, motivo: "borroso" });
    await expect(svc.analyze(deposito, [jpeg()])).rejects.toThrow(/NO PUDIMOS LEER EL REMITO CON SEGURIDAD/);
    reader.next = raw([]);
    await expect(svc.analyze(deposito, [jpeg()])).rejects.toBeInstanceOf(RemitoUnreadableError);
    expect(repo.meRemitoDocs).toHaveLength(0);
  });

  it("archivos: solo imagen/PDF reales (contenido, no el content-type declarado)", async () => {
    reader.next = raw([{ d: "GOTERO NEGRO", q: "1" }]);
    await expect(
      svc.analyze(deposito, [{ bytes: Buffer.from("<script>alert(1)</script>"), contentType: "image/jpeg", name: "x.jpg" }])
    ).rejects.toThrow(/JPG\/PNG\/WEBP o PDF/);
    await expect(svc.analyze(deposito, [])).rejects.toBeInstanceOf(InventoryValidationError);
    const pdf = { bytes: Buffer.from("%PDF-1.4 remito"), contentType: "application/pdf", name: "r.pdf" };
    await expect(svc.analyze(deposito, [pdf])).resolves.toBeTruthy();
  });

  it("solo Depósito (escritura me_ingresos) puede analizar o confirmar", async () => {
    reader.next = raw([{ d: "GOTERO NEGRO", q: "1" }]);
    await expect(svc.analyze({ email: "x@x", sector: "CALIDAD" as SectorId }, [jpeg()])).rejects.toThrow();
  });
});

describe("17-18 · integración con el ledger", () => {
  function oa(usados: string): OperationalOrderRecord {
    const content = createEmptyOaContent({ productName: "Crema", client: "Cliente X" });
    content.materials = [emptyOaMaterial(1, { id: "l1", codigo: "GOT-N", nombreInsumo: "GOTERO NEGRO", usados })];
    const normalized = normalizeOrderContent(content);
    const now = new Date().toISOString();
    return {
      id: "oa-r1",
      orderNumber: "OA-2026-000777",
      type: "OA",
      templateId: "t",
      templateVersion: 1,
      templateSnapshot: normalized,
      product: "Crema",
      client: "Cliente X",
      code: "C1",
      lot: "L1",
      assignedSector: "ENVASADO_MASIVO",
      formulaProductId: null,
      formulaVersionId: null,
      formulaVersionHash: null,
      status: "COMPLETA",
      formData: normalized,
      completionPercentage: 100,
      revision: 1,
      version: 1,
      linkedWorkItemId: null,
      reviewedAt: null,
      reviewedBy: null,
      completedAt: null,
      completedBy: null,
      createdBy: produccion.email,
      updatedBy: produccion.email,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      deletedBy: null,
      deleteReason: null,
    };
  }

  it("17. consumo previo -600 + ingreso por remito +1000 = 400 (sin duplicar el consumo)", async () => {
    applyOaDeliveryToMe(inv, produccion, oa("600"));
    expect(stockOf(mat.gotero!)).toBe(-600);
    const p = await analyze([{ d: "GOTERO NEGRO", q: "1.000" }]);
    svc.confirm(deposito, { docId: p.docId!, lines: acceptAll(p) });
    expect(stockOf(mat.gotero!)).toBe(400);
    expect(repo.meSalidas.filter((s) => s.origen === "OA" && !s.reverted)).toHaveLength(1);
  });

  it("17b. remito que no alcanza deja negativo visible pero se guarda", async () => {
    applyOaDeliveryToMe(inv, produccion, oa("600"));
    const p = await analyze([{ d: "GOTERO NEGRO", q: "500" }]);
    const res = svc.confirm(deposito, { docId: p.docId!, lines: acceptAll(p) });
    expect(res.stock[0]).toMatchObject({ stockActual: -100, negativo: true });
  });

  it("18. refrescar: movimientos, remito y alias persisten y el saldo se rederiva", async () => {
    applyOaDeliveryToMe(inv, produccion, oa("600"));
    const p = await analyze([{ d: "GOTERO NEGRO", q: "1000" }]);
    svc.confirm(deposito, { docId: p.docId!, lines: acceptAll(p) });

    const fresh = new MemoryInventoryRepo();
    Object.assign(fresh, JSON.parse(JSON.stringify(repo)));
    fresh.meMaterials = fresh.meMaterials.map((m) => ({ ...m, stockActual: 12345 })); // caché vieja
    const inv2 = new InventoryService(fresh);
    expect(inv2.listMeMaterials(deposito).find((m) => m.id === mat.gotero)?.stockActual).toBe(400);
    const ing = inv2.listMeIngresos(deposito).find((i) => i.source === "REMITO_AI")!;
    expect(ing.remitoDocumentoId).toBe(p.docId);
    expect(fresh.meRemitoDocs[0]).toMatchObject({ status: "CONFIRMADO", numeroRemito: "0001-000123" });
    // [VER REMITO]: el original sigue disponible desde el ingreso.
    const svc2 = new MeRemitoIngresoService(inv2, fresh, { reader, storage: getFileStorage });
    const file = await svc2.getDocumentFile(deposito, ing.remitoDocumentoId!);
    expect(file.bytes.length).toBeGreaterThan(0);
  });
});
