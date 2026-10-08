import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getAsignacionCellAuditMemory,
  getAsignacionLotesService,
  resetAsignacionLotesMemoryForTests,
} from "./asignacion-lotes-service";
import {
  getAsignacionLoteSourcesService,
  resetAsignacionLoteSourcesMemoryForTests,
} from "./asignacion-lote-sources-service";
import {
  patchCellsWithWriteback,
  reconcileWritebacks,
  setWritebackGatewayForTests,
  columnLetter,
} from "./asignacion-lotes-writeback-service";
import { getWritebackOpsMemory, resetWritebackOpsMemoryForTests } from "./writeback-ops";
import type { SheetCellGateway } from "./writeback-gateway";
import type { AsignacionLote } from "./types";

const SHEET = "SHEET-TEST-COPY";
const TAB = "AGOSTO 2026";
const HEADER = ["N° LOTE", "FECHA", "PRODUCTO", "CODIGO", "MARCA", "CANTIDAD", "VTO"];

const produccion = { email: "prod@laboratoriogenus.com.ar", sector: "PRODUCCION" as const, displayName: "Producción" };

/** Sheet en memoria: fila 1 = título combinado, fila 2 = encabezados (como la planilla real). */
class FakeSheet implements SheetCellGateway {
  grid: string[][] = [["ASIGNACION DE LOTE AGOSTO 2026"], HEADER, ["G26042", "03/08/2026", "MILKY TONNER", "MT-1", "THE MINIMAL CO", "500", "31/08/2028"], ["G26043", "03/08/2026", "CREMA FACIAL", "CF-1", "KORIDERM", "1200", "30/09/2028"]];
  formulas = new Set<string>();
  writes: Array<{ a1: string; value: string }> = [];
  failWrite = false;
  swallowWrite = false;
  private pos(a1: string) {
    const m = a1.match(/^([A-Z]+)(\d+)$/)!;
    let col = 0;
    for (const ch of m[1]!) col = col * 26 + (ch.charCodeAt(0) - 64);
    return { row: Number(m[2]) - 1, col: col - 1 };
  }
  /** ms de latencia simulada por llamada (fuerza intercalado entre usuarios concurrentes). */
  latency = 0;
  private async lag() { if (this.latency) await new Promise((r) => setTimeout(r, this.latency)); }
  async readTab() { await this.lag(); return this.grid.map((r) => [...r]); }
  async readCell(_s: string, _t: string, a1: string) { await this.lag(); const p = this.pos(a1); return this.grid[p.row]?.[p.col] ?? ""; }
  async readFormula(_s: string, _t: string, a1: string) { return this.formulas.has(a1) ? "=SUM(A1:A2)" : null; }
  async writeCell(_s: string, _t: string, a1: string, value: string) {
    await this.lag();
    if (this.failWrite) throw new Error("403 The caller does not have permission");
    this.writes.push({ a1, value });
    if (this.swallowWrite) return;
    const p = this.pos(a1);
    this.grid[p.row]![p.col] = value;
  }
}

let sheet: FakeSheet;
let sourceId: string;

async function seedRecord(lote = "G26042"): Promise<AsignacionLote> {
  const svc = getAsignacionLotesService();
  const { record } = await svc.upsertFromSource(
    sourceId,
    { email: "sync@sistema", displayName: "Sync" },
    { lote, fecha: "2026-08-03", producto: lote === "G26042" ? "MILKY TONNER" : "CREMA FACIAL", codigo: lote === "G26042" ? "MT-1" : "CF-1", marca: "X", cantidades: lote === "G26042" ? 500 : 1200, vto: lote === "G26042" ? "2028-08-31" : "2028-09-30", updatedBy: "Sync" },
    TAB
  );
  return record;
}
const change = (r: AsignacionLote, value: string, field: "cantidades" | "observaciones" | "vto" = "cantidades") => ({ id: r.id, field, value, expectedVersion: r.updatedAt });

describe("write-back a Google Sheets (opción C)", () => {
  beforeEach(async () => {
    vi.stubEnv("ASIGNACION_LOTES_WRITEBACK", "1");
    vi.stubEnv("ASIGNACION_LOTES_WRITEBACK_SPREADSHEET_IDS", SHEET);
    resetAsignacionLotesMemoryForTests();
    resetAsignacionLoteSourcesMemoryForTests();
    resetWritebackOpsMemoryForTests();
    getAsignacionCellAuditMemory().length = 0;
    sheet = new FakeSheet();
    setWritebackGatewayForTests(sheet);
    const src = await getAsignacionLoteSourcesService().createSpreadsheetLevelSourceForSync({ name: "2026", period: "2026", spreadsheetId: SHEET, createdBy: "t" });
    sourceId = src.id;
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    setWritebackGatewayForTests(null);
  });

  it("columnLetter", () => {
    expect([0, 5, 25, 26, 27].map(columnLetter)).toEqual(["A", "F", "Z", "AA", "AB"]);
  });

  it("escribe SOLO la celda en Google (F3), refleja en Neon, audita y deja Sheet y Neon consistentes", async () => {
    const r = await seedRecord();
    const res = await patchCellsWithWriteback(produccion, [change(r, "7000")]);
    expect(res.ok).toBe(true);
    expect(sheet.writes).toEqual([{ a1: "F3", value: "7000" }]);
    expect(sheet.grid[2]).toEqual(["G26042", "03/08/2026", "MILKY TONNER", "MT-1", "THE MINIMAL CO", "7000", "31/08/2028"]);
    expect(sheet.grid[3]![5]).toBe("1200"); // otra fila intacta
    const [rec] = (await getAsignacionLotesService().list(produccion)).filter((x) => x.id === r.id);
    expect(rec!.cantidades).toBe(7000);
    expect(rec!.vto).toBe("2028-08-31");
    expect(getWritebackOpsMemory()[0]).toMatchObject({ status: "confirmed", a1: "F3", oldValue: "500", newValue: "7000", actorEmail: produccion.email, field: "cantidades" });
    expect(getAsignacionCellAuditMemory().at(-1)).toMatchObject({ field: "cantidades", oldValue: "500", newValue: "7000" });
  });

  it("fecha se escribe como dd/mm/aaaa", async () => {
    const r = await seedRecord();
    await patchCellsWithWriteback(produccion, [change(r, "15/09/2028", "vto")]);
    expect(sheet.writes[0]).toEqual({ a1: "G3", value: "15/09/2028" });
  });

  it("no asume el n° de fila: tras insertar una fila arriba escribe en la fila correcta", async () => {
    const r = await seedRecord();
    sheet.grid.splice(2, 0, ["G00001", "01/08/2026", "OTRO", "O-1", "M", "1", "01/01/2029"]); // inserción
    const res = await patchCellsWithWriteback(produccion, [change(r, "9000")]);
    expect(res.ok).toBe(true);
    expect(sheet.writes[0]!.a1).toBe("F4");
    expect(sheet.grid[2]![5]).toBe("1"); // la fila insertada no se tocó
  });

  it("conflicto: si el valor en Google cambió desde la última lectura, NO escribe y no cambia Neon", async () => {
    const r = await seedRecord();
    sheet.grid[2]![5] = "777"; // alguien editó la Sheet
    const res = await patchCellsWithWriteback(produccion, [change(r, "7000")]);
    expect(res.ok).toBe(false);
    expect(res.results[0]).toMatchObject({ status: "failed", code: "GOOGLE_CONFLICT" });
    expect(sheet.writes).toHaveLength(0);
    expect((await getAsignacionLotesService().list(produccion))[0]!.cantidades).toBe(500);
    expect(getWritebackOpsMemory()[0]!.status).toBe("conflict");
  });

  it("si Google rechaza la escritura: error, Neon intacto, jamás éxito", async () => {
    const r = await seedRecord();
    sheet.failWrite = true;
    const res = await patchCellsWithWriteback(produccion, [change(r, "7000")]);
    expect(res.ok).toBe(false);
    expect(res.results[0]).toMatchObject({ status: "failed", code: "GOOGLE_ERROR" });
    expect((await getAsignacionLotesService().list(produccion))[0]!.cantidades).toBe(500);
    expect(getWritebackOpsMemory()[0]!.status).toBe("failed");
  });

  it("Google no confirma la relectura → pendiente (no éxito) y Neon intacto", async () => {
    const r = await seedRecord();
    sheet.swallowWrite = true;
    const res = await patchCellsWithWriteback(produccion, [change(r, "7000")]);
    expect(res.ok).toBe(false);
    expect(res.results[0]).toMatchObject({ status: "pending", code: "GOOGLE_PENDING" });
    expect((await getAsignacionLotesService().list(produccion))[0]!.cantidades).toBe(500);
  });

  it("Google confirma pero Neon falla → pendiente; la reconciliación lo completa sin reescribir en Google", async () => {
    const r = await seedRecord();
    const svc = getAsignacionLotesService();
    const real = svc.patchCells.bind(svc);
    let failedOnce = false;
    vi.spyOn(svc, "patchCells").mockImplementation(async (actor, changes, options) => {
      if (options?.bypassSourceProtection && !options.dryRun && !failedOnce) {
        failedOnce = true;
        throw new Error("Neon caído");
      }
      return real(actor, changes, options);
    });
    const res = await patchCellsWithWriteback(produccion, [change(r, "7000")]);
    expect(res.ok).toBe(false);
    expect(res.results[0]).toMatchObject({ status: "pending", code: "GOOGLE_PENDING" });
    expect(getWritebackOpsMemory()[0]!.status).toBe("google_done");
    expect((await svc.list(produccion))[0]!.cantidades).toBe(500); // Neon aún viejo, estado marcado pendiente
    const rec = await reconcileWritebacks();
    expect(rec.confirmed).toBe(1);
    expect((await svc.list(produccion))[0]!.cantidades).toBe(7000);
    expect(sheet.writes).toHaveLength(1);
    expect(getWritebackOpsMemory()[0]!.status).toBe("confirmed");
  });

  it("idempotente: repetir el mismo cambio (reintento) no vuelve a escribir en Google", async () => {
    const r = await seedRecord();
    const c = change(r, "7000");
    expect((await patchCellsWithWriteback(produccion, [c])).ok).toBe(true);
    const again = await patchCellsWithWriteback(produccion, [c]);
    expect(again.ok).toBe(true);
    expect(sheet.writes).toHaveLength(1);
    expect(getWritebackOpsMemory()).toHaveLength(1);
  });

  it("reintento tras un fallo de Google reutiliza la misma operación", async () => {
    const r = await seedRecord();
    const c = change(r, "7000");
    sheet.failWrite = true;
    expect((await patchCellsWithWriteback(produccion, [c])).ok).toBe(false);
    sheet.failWrite = false;
    expect((await patchCellsWithWriteback(produccion, [c])).ok).toBe(true);
    expect(getWritebackOpsMemory()).toHaveLength(1);
    expect(getWritebackOpsMemory()[0]!.attempts).toBe(2);
  });

  it("el cron no revierte: un sync con lectura anterior a la escritura no pisa el valor", async () => {
    const r = await seedRecord();
    const runStartedAt = new Date(Date.now() - 1000).toISOString();
    await patchCellsWithWriteback(produccion, [change(r, "7000")]);
    const svc = getAsignacionLotesService();
    // El cron leyó la Sheet ANTES de la escritura (cantidad 500) y recién ahora hace upsert.
    const stale = await svc.upsertFromSource(sourceId, { email: "s", displayName: "S" }, { lote: "G26042", fecha: "2026-08-03", producto: "MILKY TONNER", codigo: "MT-1", marca: "X", cantidades: 500, vto: "2028-08-31", updatedBy: "s" }, TAB, runStartedAt);
    expect(stale.changed).toBe(false);
    expect((await svc.list(produccion))[0]!.cantidades).toBe(7000);
    // La corrida siguiente lee 7000 desde Google: consistente.
    const next = await svc.upsertFromSource(sourceId, { email: "s", displayName: "S" }, { lote: "G26042", fecha: "2026-08-03", producto: "MILKY TONNER", codigo: "MT-1", marca: "X", cantidades: 7000, vto: "2028-08-31", updatedBy: "s" }, TAB, new Date().toISOString());
    expect(next.record.cantidades).toBe(7000);
  });

  it("sin habilitación/allowlist no se escribe nada (PROTECTED_SOURCE)", async () => {
    const r = await seedRecord();
    vi.stubEnv("ASIGNACION_LOTES_WRITEBACK_SPREADSHEET_IDS", "OTRA-PLANILLA");
    const res = await patchCellsWithWriteback(produccion, [change(r, "7000")]);
    expect(res.results[0]).toMatchObject({ status: "failed", code: "PROTECTED_SOURCE" });
    expect(sheet.writes).toHaveLength(0);
    vi.stubEnv("ASIGNACION_LOTES_WRITEBACK", "0");
    vi.stubEnv("ASIGNACION_LOTES_WRITEBACK_SPREADSHEET_IDS", SHEET);
    expect((await patchCellsWithWriteback(produccion, [change(r, "7000")])).ok).toBe(false);
    expect(sheet.writes).toHaveLength(0);
  });

  it("no sobrescribe fórmulas", async () => {
    const r = await seedRecord();
    sheet.formulas.add("F3");
    const res = await patchCellsWithWriteback(produccion, [change(r, "7000")]);
    expect(res.ok).toBe(false);
    expect(sheet.writes).toHaveLength(0);
  });

  it("filas duplicadas en la Sheet (misma identidad): ambiguo, no escribe", async () => {
    const r = await seedRecord();
    sheet.grid.push([...sheet.grid[2]!]);
    const res = await patchCellsWithWriteback(produccion, [change(r, "7000")]);
    expect(res.ok).toBe(false);
    expect(sheet.writes).toHaveLength(0);
  });

  it("si la fila desapareció de la Sheet, no escribe", async () => {
    const r = await seedRecord();
    sheet.grid.splice(2, 1);
    const res = await patchCellsWithWriteback(produccion, [change(r, "7000")]);
    expect(res.ok).toBe(false);
    expect(sheet.writes).toHaveLength(0);
  });

  it("permisos: Codificado no edita cantidades de Google; valor inválido no llega a Google", async () => {
    const r = await seedRecord();
    const cod = { email: "c@x", sector: "CODIFICADO" as const, displayName: "C" };
    expect((await patchCellsWithWriteback(cod, [change(r, "1")])).results[0]).toMatchObject({ status: "failed", code: "FORBIDDEN_FIELD" });
    expect((await patchCellsWithWriteback(produccion, [change(r, "-4")])).results[0]).toMatchObject({ status: "failed", code: "INVALID_VALUE" });
    expect(sheet.writes).toHaveLength(0);
  });

  it("mezcla en un pegado: celdas manuales atómicas + celdas de Google con resultado por celda", async () => {
    const google = await seedRecord();
    const svc = getAsignacionLotesService();
    const manual = await svc.upsert(produccion, { lote: "M1", fecha: "2026-08-04", producto: "MANUAL", codigo: "M-1", cantidades: 10, updatedBy: "P" });
    const res = await patchCellsWithWriteback(produccion, [change(manual, "11"), change(google, "7000")]);
    expect(res.ok).toBe(true);
    expect(res.results.map((x) => x.status)).toEqual(["confirmed", "confirmed"]);
    expect(sheet.writes).toHaveLength(1);
  });

  it("NUNCA escribe en Production (VERCEL_ENV=production) aunque flag y allowlist estén activos", async () => {
    const r = await seedRecord();
    vi.stubEnv("VERCEL_ENV", "production");
    const res = await patchCellsWithWriteback(produccion, [change(r, "7000")]);
    expect(res.results[0]).toMatchObject({ status: "failed", code: "PROTECTED_SOURCE" });
    expect(sheet.writes).toHaveLength(0);
  });

  it("DOS USUARIOS editan la MISMA celda de Google a la vez: una sola escritura, el otro recibe conflicto", async () => {
    const r = await seedRecord();
    sheet.latency = 5;
    const other = { email: "cal@laboratoriogenus.com.ar", sector: "CALIDAD" as const, displayName: "Calidad" };
    const [a, b] = await Promise.all([
      patchCellsWithWriteback(produccion, [change(r, "7000")]),
      patchCellsWithWriteback(other, [change(r, "9000")]),
    ]);
    const oks = [a, b].filter((x) => x.ok);
    expect(oks).toHaveLength(1);
    expect(sheet.writes).toHaveLength(1);
    const loser = [a, b].find((x) => !x.ok)!;
    expect(loser.results[0]).toMatchObject({ status: "failed" });
    const final = (await getAsignacionLotesService().list(produccion))[0]!.cantidades;
    expect(final).toBe(Number(sheet.writes[0]!.value));
    expect(sheet.grid[2]![5]).toBe(sheet.writes[0]!.value); // Sheet y Neon consistentes
  });

  it("DOS USUARIOS cambian el LOTE del mismo registro de Google a la vez: solo uno gana y Sheet/Neon quedan consistentes", async () => {
    const r = await seedRecord();
    sheet.latency = 5;
    const other = { email: "cal@laboratoriogenus.com.ar", sector: "CALIDAD" as const, displayName: "Calidad" };
    const [a, b] = await Promise.all([
      patchCellsWithWriteback(produccion, [{ id: r.id, field: "lote" as never, value: "G-NUEVO-A", expectedVersion: r.updatedAt }]),
      patchCellsWithWriteback(other, [{ id: r.id, field: "lote" as never, value: "G-NUEVO-B", expectedVersion: r.updatedAt }]),
    ]);
    expect([a, b].filter((x) => x.ok)).toHaveLength(1);
    expect(sheet.writes).toHaveLength(1);
    const rec = (await getAsignacionLotesService().list(produccion))[0]!;
    expect(rec.lote).toBe(sheet.writes[0]!.value);
    expect(sheet.grid[2]![0]).toBe(rec.lote);
  });

  it("DOS USUARIOS cambian la identidad de DOS registros manuales al MISMO lote a la vez: uno gana, no se duplica", async () => {
    const svc = getAsignacionLotesService();
    const a = await svc.upsert(produccion, { lote: "M1", fecha: "2026-08-04", producto: "IGUAL", codigo: "X", cantidades: 1, updatedBy: "P" });
    const b = await svc.upsert(produccion, { lote: "M2", fecha: "2026-08-04", producto: "IGUAL", codigo: "X", cantidades: 1, updatedBy: "P" });
    const results = await Promise.all([
      patchCellsWithWriteback(produccion, [{ id: a.id, field: "lote" as never, value: "COMPARTIDO", expectedVersion: a.updatedAt }]),
      patchCellsWithWriteback(produccion, [{ id: b.id, field: "lote" as never, value: "COMPARTIDO", expectedVersion: b.updatedAt }]),
    ]);
    expect(results.filter((x) => x.ok)).toHaveLength(1);
    const rows = (await svc.list(produccion)).filter((x) => x.lote === "COMPARTIDO");
    expect(rows).toHaveLength(1);
  });

  it("reintento de un fallo por Google reabre la celda y un tercero no puede colarse mientras tanto", async () => {
    const r = await seedRecord();
    sheet.failWrite = true;
    await patchCellsWithWriteback(produccion, [change(r, "7000")]);
    sheet.failWrite = false;
    sheet.latency = 5;
    const other = { email: "cal@laboratoriogenus.com.ar", sector: "CALIDAD" as const, displayName: "Calidad" };
    const [retry, intruder] = await Promise.all([
      patchCellsWithWriteback(produccion, [change(r, "7000")]),
      patchCellsWithWriteback(other, [change(r, "8000")]),
    ]);
    expect([retry, intruder].filter((x) => x.ok)).toHaveLength(1);
    expect(sheet.writes).toHaveLength(1);
  });
});
