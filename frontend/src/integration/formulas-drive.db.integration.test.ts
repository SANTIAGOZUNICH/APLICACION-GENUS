/**
 * Fuente de fórmulas = carpeta NUEVA de Drive — contra un Postgres de PRUEBA real, con un Drive SIMULADO en memoria
 * (carpetas de clientes y archivos .xlsx/.xls descartables). Usa las MISMAS funciones que la app: actualización del
 * índice, búsqueda, vínculos, resolveFormulaForWork (OE automática) y «Ver OE / Fórmula».
 *
 * Se SALTA sin base local marcada.
 */
import { randomUUID } from "node:crypto";
import * as XLSX from "xlsx";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { assertMarkedDatabase, e2eEnvironmentProblem } from "../../scripts/e2e/e2e-safety.mjs";

const PROBLEM = e2eEnvironmentProblem() ?? (process.env.GENUS_E2E_DATABASE_URL ? null : "falta GENUS_E2E_DATABASE_URL");
const RUN = Date.now().toString().slice(-6);
const ROOT = `it-formulas-root-${RUN}`;
const prod = { email: "it-formulas-prod@laboratoriogenus.com.ar", sector: "PRODUCCION", displayName: "IT Producción" };
const elab = { email: "it-formulas-elab@laboratoriogenus.com.ar", sector: "ELABORACION", displayName: "IT Elaboración" };
const NOTE = `IT-FORMULAS-DRIVE-${RUN}`;
const OE_BASE = 900000 + Math.floor(Math.random() * 900) * 100;
let oeSeq = 0;

function formulaXlsx(product: string, rows: Array<[string, string, number]>): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([["PRODUCTO:", product], ["MATERIA PRIMA", "CÓDIGO", "Fórmula %"], ...rows, ["PROCEDIMIENTO"], ["Mezclar a 40 °C"]]),
    "Hoja1"
  );
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

type Node = { id: string; name: string; mimeType: string; modifiedTime: string; children?: string[]; data?: Buffer };
const FOLDER = "application/vnd.google-apps.folder";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Drive simulado: árbol en memoria + estados forzados (sin acceso / borrado). */
class FakeDrive {
  nodes = new Map<string, Node>();
  denied = new Set<string>();
  rootDenied = false;
  constructor() {
    this.nodes.set(ROOT, { id: ROOT, name: "ORDEN DE ELABORACION", mimeType: FOLDER, modifiedTime: new Date().toISOString(), children: [] });
  }
  folder(parent: string, name: string) {
    const id = `fold-${randomUUID()}`;
    this.nodes.set(id, { id, name, mimeType: FOLDER, modifiedTime: new Date().toISOString(), children: [] });
    this.nodes.get(parent)!.children!.push(id);
    return id;
  }
  file(parent: string, name: string, data: Buffer, mimeType = XLSX_MIME) {
    const id = `file-${randomUUID()}`;
    this.nodes.set(id, { id, name, mimeType, modifiedTime: new Date().toISOString(), data });
    this.nodes.get(parent)!.children!.push(id);
    return id;
  }
  remove(parent: string, id: string) {
    const p = this.nodes.get(parent)!;
    p.children = p.children!.filter((c) => c !== id);
    this.nodes.delete(id);
  }
  lister() {
    return {
      canAccess: async (id: string) =>
        this.rootDenied && id === ROOT
          ? { ok: false as const, reason: "no_access" as const, message: "it-sa@genus.iam no tiene permiso de lectura sobre la carpeta de fórmulas. Compartila con permiso de LECTOR." }
          : this.nodes.has(id)
            ? { ok: true as const, name: this.nodes.get(id)!.name }
            : { ok: false as const, reason: "not_found" as const, message: "no existe" },
      listChildren: async (id: string) =>
        (this.nodes.get(id)?.children ?? []).map((c) => {
          const n = this.nodes.get(c)!;
          return { id: n.id, name: n.name, mimeType: n.mimeType, modifiedTime: n.modifiedTime, md5: null };
        }),
      fileState: async (id: string) => (this.denied.has(id) ? ("no_access" as const) : this.nodes.has(id) ? ("ok" as const) : ("not_found" as const)),
      download: async (id: string) => {
        if (this.denied.has(id)) throw Object.assign(new Error("forbidden"), { code: 403 });
        const n = this.nodes.get(id);
        if (!n?.data) throw Object.assign(new Error("not found"), { code: 404 });
        return n.data;
      },
    };
  }
}

describe.skipIf(Boolean(PROBLEM))(`Fórmulas: carpeta nueva de Drive en Postgres real${PROBLEM ? ` — saltado: ${PROBLEM}` : ""}`, () => {
  let pool: import("@neondatabase/serverless").Pool;
  const q = async (text: string, params: unknown[] = []) => (await pool.query(text, params)).rows as Record<string, unknown>[];
  const drive = new FakeDrive();
  const ids: Record<string, string> = {};
  let src: typeof import("@/lib/formulas/drive-formula-source");
  let resolve: typeof import("@/lib/formulas/resolve-for-work").resolveFormulaForWork;
  let snapshot = "";

  const integritySnapshot = async () =>
    JSON.stringify({
      movs: (await q("select count(*)::int n from mp_stock_movements"))[0]!.n,
      bal: await q("select codigo, stock_actual from mp_stock_balances order by codigo"),
      inv: await q("select count(*)::int n, coalesce(sum(length(payload::text)),0)::int s from inv_mp_stock"),
      lotes: await q("select count(*)::int n from asignacion_lotes"),
    });
  let ordersBefore: Record<string, unknown>[] = [];

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.GENUS_E2E_DATABASE_URL!;
    process.env.GENUS_FORMULAS_DRIVE_ROOT_ID = ROOT;
    const { Pool, neonConfig } = await import("@neondatabase/serverless");
    neonConfig.webSocketConstructor = (await import("ws")).default as never;
    pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
    await assertMarkedDatabase(q);
    vi.resetModules();
    src = await import("@/lib/formulas/drive-formula-source");
    src.setFormulaDriveListerForTests(drive.lister());
    resolve = (await import("@/lib/formulas/resolve-for-work")).resolveFormulaForWork;

    const base: Array<[string, string, number]> = [["Agua", "MP-1", 80], ["Glicerina", "MP-2", 15], ["Perfume", "MP-3", 5]];
    const ab = drive.folder(ROOT, "ALL BEAUTY");
    ids.abCrema = drive.file(ab, "CREMA DE ORDEÑE - ALL BEAUTY.xlsx", formulaXlsx("CREMA DE ORDEÑE", base));
    ids.abCremaCopia = drive.file(ab, "Copia de CREMA DE ORDEÑE - ALL BEAUTY.xlsx", formulaXlsx("CREMA DE ORDEÑE", base));
    ids.abEmulsion = drive.file(ab, "EMULSION CORPORAL- ALL BEAUTY.xlsx", formulaXlsx("EMULSION CORPORAL", base));
    const fi = drive.folder(ROOT, "FIRMEA");
    ids.fiSerum = drive.file(fi, "SERUM-ADN 1%.xls", formulaXlsx("SERUM ADN 1%", base), "application/vnd.ms-excel");
    ids.fiOther = drive.file(fi, "EMULSION CORPORAL- ALL BEAUTY.xlsx", formulaXlsx("EMULSION CORPORAL", base));
    const lu = drive.folder(ROOT, "LUCENT");
    ids.luGel = drive.file(lu, "GEL FRIO.xlsx", formulaXlsx("GEL FRIO", base));
    const luOld = drive.folder(lu, "VERSIONES ANTERIORES");
    ids.luGelOld = drive.file(luOld, "GEL FRIO.xlsx", formulaXlsx("GEL FRIO", [["Agua", "MP-1", 90], ["Perfume", "MP-3", 10]]));
    ids.loose = drive.file(ROOT, "FORMULA SUELTA.xlsx", formulaXlsx("SUELTA", base));
    ids.ab = ab;
    ids.fi = fi;
    snapshot = await integritySnapshot();
    // Órdenes ya emitidas (de antes de esta corrida; otras pruebas pueden estar creando las suyas en paralelo).
    ordersBefore = await q("select id, version, md5(form_data::text) h from operational_orders where created_at < now() - interval '10 minutes' order by id");
  }, 60_000);

  afterAll(async () => {
    src?.setFormulaDriveListerForTests(null);
    delete process.env.GENUS_FORMULAS_DRIVE_ROOT_ID;
    await q("update work_items set deleted_at = now() where notes = $1", [NOTE]).catch(() => undefined);
    await pool?.end();
  });

  it("antes de indexar la carpeta nueva se mantiene la búsqueda anterior (no se corta Elaboración)", async () => {
    expect(await src.isNewFormulaSourceValidated()).toBe(false);
    const r = await resolve({ client: "ALL BEAUTY", product: "EMULSION CORPORAL" });
    expect(r.ok).toBe(false); // sin banco ni credenciales en la prueba: «no encontrada» por el camino anterior
    if (!r.ok) expect(r.message).not.toMatch(/carpeta de cliente/);
  });

  it("actualizar índice: carpetas de clientes, subcarpetas, .xls, hojas sueltas y marcas (copia, otro cliente, repetidos)", async () => {
    const res = await src.syncFormulaIndex({ trigger: "manual", actorEmail: prod.email });
    expect(res).toMatchObject({ ok: true, clientCount: 3, fileCount: 8, added: 8, removed: 0 });
    const rows = await q("select file_name, client_folder_name, sub_path, flags from formula_drive_index where root_folder_id = $1 and removed_at is null order by file_name", [ROOT]);
    expect(rows).toHaveLength(8);
    const flagsOf = (name: string, folder: string) => (rows.find((r) => r.file_name === name && r.client_folder_name === folder)!.flags as { flags: string[] }).flags;
    expect(flagsOf("Copia de CREMA DE ORDEÑE - ALL BEAUTY.xlsx", "ALL BEAUTY")).toEqual(expect.arrayContaining(["copia", "duplicado"]));
    expect(flagsOf("EMULSION CORPORAL- ALL BEAUTY.xlsx", "FIRMEA")).toContain("otro_cliente");
    expect(rows.find((r) => r.sub_path === "VERSIONES ANTERIORES")).toBeTruthy();
    expect(rows.find((r) => r.client_folder_name === "(sin carpeta de cliente)")?.file_name).toBe("FORMULA SUELTA.xlsx");
    const st = await src.getIndexStatus();
    expect(st).toMatchObject({ validated: true, stale: false });
    expect(await src.isNewFormulaSourceValidated()).toBe(true);
  });

  it("cliente y producto exactos (con tildes/mayúsculas distintas) → fórmula del archivo correcto", async () => {
    const r = await resolve({ client: "All Beauty", product: "Emulsión Corporal" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.ref).toMatchObject({ source: "DRIVE", driveFileId: ids.abEmulsion });
      expect(r.materials.map((m) => m.materiaPrima)).toEqual(["Agua", "Glicerina", "Perfume"]);
    }
  });

  it("nombre ligeramente distinto (guiones, signos, .xls) → se encuentra", async () => {
    const r = await resolve({ client: "FIRMEA", product: "Serum ADN 1 %" });
    expect(r.ok && r.ref.driveFileId).toBe(ids.fiSerum);
  });

  it("archivos repetidos/copias → ambigua, sin elegir; versión en subcarpeta anterior → ambigua", async () => {
    const r = await resolve({ client: "ALL BEAUTY", product: "CREMA DE ORDEÑE" });
    expect(r).toMatchObject({ ok: false, status: "ambiguous" });
    const g = await resolve({ client: "LUCENT", product: "GEL FRIO" });
    expect(g).toMatchObject({ ok: false, status: "ambiguous" });
  });

  it("archivo que parece de otro cliente → no se usa solo", async () => {
    const r = await resolve({ client: "FIRMEA", product: "EMULSION CORPORAL" });
    expect(r).toMatchObject({ ok: false, status: "ambiguous" });
    if (!r.ok) expect(r.message).toMatch(/otro cliente/);
  });

  it("nunca usa otro cliente ni otro producto: sin carpeta → «no encontrada»", async () => {
    const r = await resolve({ client: "CLIENTE INEXISTENTE", product: "EMULSION CORPORAL" });
    expect(r).toMatchObject({ ok: false, status: "not_found" });
  });

  it("vínculo explícito: Producción elige el archivo; se usa ese, queda auditado; reemplazar conserva el anterior", async () => {
    const link = await src.linkFormula(prod, { client: "ALL BEAUTY", product: "Crema de ordeñe", fileId: ids.abCrema, note: "El original" });
    expect(link.fileId).toBe(ids.abCrema);
    const r = await resolve({ client: "all beauty", product: "CREMA DE ORDEÑE" });
    expect(r.ok && r.ref.driveFileId).toBe(ids.abCrema);
    const audit = await q("select * from feature_audit_events where domain = 'formulas_drive' and action = 'link' and entity_id = $1", [link.id]);
    expect(audit).toHaveLength(1);
    const again = await src.linkFormula(prod, { client: "ALL BEAUTY", product: "CREMA DE ORDEÑE", fileId: ids.abCremaCopia });
    const all = await q("select id, file_id, ended_at, end_reason from formula_drive_links where client_key = 'all beauty' order by linked_at");
    expect(all.filter((l) => !l.ended_at)).toHaveLength(1);
    expect(all.find((l) => l.id === link.id)).toMatchObject({ end_reason: "Reemplazado por otro archivo" });
    expect(again.fileId).toBe(ids.abCremaCopia);
    // Solo archivos del índice: un id cualquiera de Drive no se puede vincular.
    await expect(src.linkFormula(prod, { client: "ALL BEAUTY", product: "X", fileId: "otro-id-de-drive" })).rejects.toThrow(/no está en la carpeta/);
  });

  it("vínculo sin acceso al archivo → aviso claro, NO se usa otro archivo", async () => {
    drive.denied.add(ids.abCremaCopia);
    await q("update formula_drive_links set last_validated_at = now() - interval '1 hour' where file_id = $1", [ids.abCremaCopia]);
    const r = await resolve({ client: "ALL BEAUTY", product: "CREMA DE ORDEÑE" });
    expect(r).toMatchObject({ ok: false, status: "error" });
    if (!r.ok) expect(r.message).toMatch(/no tiene permiso/);
    drive.denied.delete(ids.abCremaCopia);
    await q("update formula_drive_links set last_validated_at = now() - interval '1 hour' where file_id = $1", [ids.abCremaCopia]);
    expect((await resolve({ client: "ALL BEAUTY", product: "CREMA DE ORDEÑE" })).ok).toBe(true);
  });

  it("agregar un archivo nuevo y actualizar el índice → aparece; quitar uno → queda marcado (no se borra) y su vínculo avisa", async () => {
    ids.fiNuevo = drive.file(ids.fi!, "BALSAMO LABIAL.xlsx", formulaXlsx("BALSAMO LABIAL", [["Cera", "MP-9", 60], ["Aceite", "MP-8", 40]]));
    const r1 = await src.syncFormulaIndex({ trigger: "manual" });
    expect(r1).toMatchObject({ ok: true, added: 1, removed: 0 });
    expect((await resolve({ client: "FIRMEA", product: "Bálsamo labial" })).ok).toBe(true);

    drive.remove(ids.ab!, ids.abCremaCopia!);
    const r2 = await src.syncFormulaIndex({ trigger: "manual" });
    expect(r2).toMatchObject({ ok: true, removed: 1 });
    const [row] = await q("select removed_at from formula_drive_index where file_id = $1", [ids.abCremaCopia]);
    expect(row!.removed_at).not.toBeNull();
    await q("update formula_drive_links set last_validated_at = now() - interval '1 hour' where file_id = $1", [ids.abCremaCopia]);
    const r = await resolve({ client: "ALL BEAUTY", product: "CREMA DE ORDEÑE" });
    expect(r).toMatchObject({ ok: false, status: "error" });
    if (!r.ok) expect(r.message).toMatch(/ya no está en la carpeta/);
  });

  it("sin permiso sobre la carpeta → la actualización falla con un aviso claro y el índice anterior se conserva", async () => {
    drive.rootDenied = true;
    const r = await src.syncFormulaIndex({ trigger: "manual" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/permiso de lectura/);
    const st = await src.getIndexStatus();
    expect(st.lastRun).toMatchObject({ status: "error" });
    expect(st.validated).toBe(true);
    expect((await src.loadIndexFiles()).length).toBeGreaterThan(0);
    drive.rootDenied = false;
    await expect(src.readIndexedFile("no-indexado")).rejects.toThrow(/no encontrado/i);
  });

  it("OE: se prepara con la fórmula de la carpeta nueva; una versión nueva del archivo NO reemplaza la OE ya preparada; Elaboración la abre", async () => {
    const { assignWorkItemDurable } = await import("@/lib/planning/work-assignment-service");
    const { prepareOeAfterWorkChange } = await import("@/lib/planning/oe-auto-prep");
    const orderNumber = `OE-2026-${String(OE_BASE + ++oeSeq).padStart(6, "0")}`;
    const result = await assignWorkItemDurable(
      { sector: "ELABORACION", client: "ALL BEAUTY", product: "EMULSION CORPORAL", plannedQuantity: "100", unit: "kg", plannedDate: "2026-11-20", branchOwner: "Cristian", orderNumber, packagingLote: "IT-F-L1", notes: NOTE, idempotencyKey: randomUUID() } as never,
      prod,
      randomUUID()
    );
    const orderId = result.order!.id;
    const p1 = await prepareOeAfterWorkChange(orderId, prod, "Asignación del trabajo a Elaboración");
    expect(p1?.status).toBe("applied");
    const before = (await q("select form_data, version from operational_orders where id = $1", [orderId]))[0]!;
    const fd1 = before.form_data as { autoPrep: { formula: { driveFileId: string; versionHash: string } }; materials: Array<{ materiaPrima: string }> };
    expect(fd1.autoPrep.formula.driveFileId).toBe(ids.abEmulsion);

    // Otra versión del archivo (otro contenido) + corrección del trabajo: la OE conserva su fórmula.
    drive.nodes.get(ids.abEmulsion!)!.data = formulaXlsx("EMULSION CORPORAL", [["Agua", "MP-1", 70], ["Aceite", "MP-8", 30]]);
    const p2 = await prepareOeAfterWorkChange(orderId, prod, "Corrección del trabajo");
    expect(["unchanged", "applied"]).toContain(p2?.status);
    const fd2 = (await q("select form_data from operational_orders where id = $1", [orderId]))[0]!.form_data as typeof fd1 & { autoPrep: { formula: { message: string } } };
    expect(fd2.autoPrep.formula.versionHash).toBe(fd1.autoPrep.formula.versionHash);
    expect(fd2.materials.map((m) => m.materiaPrima)).toEqual(fd1.materials.map((m) => m.materiaPrima));

    // Elaboración: «Ver OE / Fórmula» → la OE y el archivo con el que se preparó (sin opciones para elegir).
    const { getWorkFormulaInfo } = await import("@/lib/formulas/work-formula-info");
    const info = await getWorkFormulaInfo(elab, result.item.id);
    expect(info.oe).toMatchObject({ id: orderId, number: orderNumber });
    expect(info.document).toMatchObject({ fileId: ids.abEmulsion, via: "oe", downloadable: true });
    expect(info.candidates).toEqual([]);
    expect(info.canLink).toBe(false);
    const file = await src.readIndexedFile(info.document!.fileId);
    expect(file.fileName).toBe("EMULSION CORPORAL- ALL BEAUTY.xlsx");
  });

  it("Producción ve las opciones de un trabajo ambiguo; Elaboración solo el aviso", async () => {
    const { assignWorkItemDurable } = await import("@/lib/planning/work-assignment-service");
    const orderNumber = `OE-2026-${String(OE_BASE + ++oeSeq).padStart(6, "0")}`;
    const result = await assignWorkItemDurable(
      { sector: "ELABORACION", client: "LUCENT", product: "GEL FRIO", plannedQuantity: "50", unit: "kg", plannedDate: "2026-11-21", branchOwner: "Cristian", orderNumber, packagingLote: "IT-F-L2", notes: NOTE, idempotencyKey: randomUUID() } as never,
      prod,
      randomUUID()
    );
    const { getWorkFormulaInfo } = await import("@/lib/formulas/work-formula-info");
    const forProd = await getWorkFormulaInfo(prod, result.item.id);
    expect(forProd.status).toBe("ambiguous");
    expect(forProd.candidates.map((c) => c.fileId).sort()).toEqual([ids.luGel, ids.luGelOld].sort());
    const forElab = await getWorkFormulaInfo(elab, result.item.id);
    expect(forElab).toMatchObject({ status: "ambiguous", candidates: [], canLink: false });
    await expect(getWorkFormulaInfo({ email: "x@x", sector: "ENVASADO_MASIVO" }, result.item.id)).rejects.toThrow(/no ve las fórmulas/);
  });

  // ---------- Caso TRC: el cliente del trabajo no se llama igual que su carpeta de Drive ----------
  const assignElab = async (client: string, product: string) => {
    const { assignWorkItemDurable } = await import("@/lib/planning/work-assignment-service");
    const { prepareOeAfterWorkChange } = await import("@/lib/planning/oe-auto-prep");
    const orderNumber = `OE-2026-${String(OE_BASE + ++oeSeq).padStart(6, "0")}`;
    const result = await assignWorkItemDurable(
      { sector: "ELABORACION", client, product, plannedQuantity: "200", unit: "kg", plannedDate: "2026-11-24", branchOwner: "Cristian", orderNumber, packagingLote: "IT-TRC-L1", notes: NOTE, idempotencyKey: randomUUID() } as never,
      prod,
      randomUUID()
    );
    await prepareOeAfterWorkChange(result.order!.id, prod, "Asignación del trabajo a Elaboración");
    const [o] = await q("select id, order_number, version, lot, form_data from operational_orders where id = $1", [result.order!.id]);
    return { workId: result.item.id, order: o!, orderNumber };
  };
  const fstatus = (o: Record<string, unknown>) => (o.form_data as { autoPrep?: { formula?: { status?: string; driveFileId?: string } } }).autoPrep?.formula;

  it("TRC / SHAMPOO PLUS: la OE automática encuentra la carpeta «TRC HAIR CARE» (misma regla que la búsqueda manual) y vincula", async () => {
    const trc = drive.folder(ROOT, "TRC HAIR CARE");
    ids.trc = trc;
    ids.trcShampoo = drive.file(trc, "SHAMPOO PLUS - TRC.xlsx", formulaXlsx("SHAMPOO PLUS", [["Agua", "MP-1", 85], ["Tensioactivo", "MP-5", 15]]));
    drive.file(ids.fi!, "SHAMPOO PLUS.xlsx", formulaXlsx("SHAMPOO PLUS", [["Agua", "MP-1", 90], ["Sal", "MP-6", 10]])); // otro cliente: nunca
    expect((await src.syncFormulaIndex({ trigger: "manual" })).ok).toBe(true);
    // Búsqueda manual (selector de Órdenes de Elaboración) sobre el MISMO índice.
    const idx = await import("@/lib/formulas/drive-formulas-index");
    idx.resetDriveFormulasIndexForTests();
    expect((await idx.searchDriveClients("TRC", 5)).map((c) => c.client)).toContain("TRC HAIR CARE");
    // Automática.
    const a = await assignElab("TRC", "SHAMPOO PLUS");
    expect(fstatus(a.order)).toMatchObject({ status: "ok", driveFileId: ids.trcShampoo });
    const links = await q("select * from formula_drive_links where client_key = 'trc' and ended_at is null");
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ file_id: ids.trcShampoo, note: "Vinculada automáticamente: única coincidencia segura" });
    // Elaboración la consulta enseguida.
    const { getWorkFormulaInfo } = await import("@/lib/formulas/work-formula-info");
    expect((await getWorkFormulaInfo(elab, a.workId)).document).toMatchObject({ fileId: ids.trcShampoo, via: "oe" });
  });

  it("vínculo guardado: una nueva asignación lo reutiliza aunque después aparezca una copia del archivo", async () => {
    drive.file(ids.trc!, "Copia de SHAMPOO PLUS - TRC.xlsx", formulaXlsx("SHAMPOO PLUS", [["Agua", "MP-1", 50], ["Otro", "MP-7", 50]]));
    expect((await src.syncFormulaIndex({ trigger: "manual" })).ok).toBe(true);
    const b = await assignElab("trc", "Shampoo Plus");
    expect(fstatus(b.order)).toMatchObject({ status: "ok", driveFileId: ids.trcShampoo });
  });

  it("OE que quedó pendiente (la carpeta todavía no estaba) → al actualizar el índice se completa: misma OE, sin duplicar", async () => {
    const before = await assignElab("TRC", "ACONDICIONADOR PLUS");
    expect(fstatus(before.order)?.status).not.toBe("ok");
    const ordersForWork = async () => (await q("select count(*)::int n from operational_orders where order_number = $1", [before.orderNumber]))[0]!.n;
    ids.trcAcond = drive.file(ids.trc!, "ACONDICIONADOR PLUS.xlsx", formulaXlsx("ACONDICIONADOR PLUS", [["Agua", "MP-1", 92], ["Cetílico", "MP-8", 8]]));
    expect((await src.syncFormulaIndex({ trigger: "manual" })).ok).toBe(true);
    const r = await src.retryPendingOeFormulas(prod, { workItemIds: [before.workId] }); // solo esta corrida (otras pruebas corren en paralelo)
    expect(r.orderNumbers).toContain(before.orderNumber);
    const [after] = await q("select id, order_number, lot, form_data from operational_orders where id = $1", [before.order.id]);
    expect(fstatus(after!)).toMatchObject({ status: "ok", driveFileId: ids.trcAcond });
    expect(after!.lot).toBe(before.order.lot);
    expect(await ordersForWork()).toBe(1);
    // Una OE ya preparada no se toca al reintentar.
    const again = await src.retryPendingOeFormulas(prod, { workItemIds: [before.workId] });
    expect(again.orderNumbers).not.toContain(before.orderNumber);
  });

  it("producto sin fórmula: queda pendiente con un mensaje claro (no se toma otro producto)", async () => {
    const c = await assignElab("TRC", "MASCARA INEXISTENTE");
    const f = fstatus(c.order) as { status?: string; message?: string };
    expect(f.status).toBe("not_found");
    expect(f.message).toMatch(/MASCARA INEXISTENTE/);
  });

  it("elección manual de Producción en una carpeta con otro nombre → queda como vínculo y también enseña la carpeta del cliente", async () => {
    const tric = drive.folder(ROOT, "TRICOLOGIA PROFESIONAL");
    ids.tricSerum = drive.file(tric, "SERUM CAPILAR.xlsx", formulaXlsx("SERUM CAPILAR", [["Agua", "MP-1", 95], ["Silicona", "MP-9", 5]]));
    ids.tricMasc = drive.file(tric, "MASCARA NUTRITIVA.xlsx", formulaXlsx("MASCARA NUTRITIVA", [["Agua", "MP-1", 80], ["Manteca", "MP-10", 20]]));
    expect((await src.syncFormulaIndex({ trigger: "manual" })).ok).toBe(true);
    const d = await assignElab("TRC BEAUTY", "SERUM CAPILAR");
    expect(fstatus(d.order)?.status).toBe("not_found"); // «TRICOLOGIA PROFESIONAL» no se parece a «TRC BEAUTY»
    await src.linkFormula(prod, { client: "TRC BEAUTY", product: "SERUM CAPILAR", fileId: ids.tricSerum! });
    const e = await assignElab("TRC BEAUTY", "SERUM CAPILAR");
    expect(fstatus(e.order)).toMatchObject({ status: "ok", driveFileId: ids.tricSerum });
    // La carpeta quedó aprendida para el cliente: otro producto suyo se encuentra solo.
    const m = await assignElab("TRC BEAUTY", "MASCARA NUTRITIVA");
    expect(fstatus(m.order)).toMatchObject({ status: "ok", driveFileId: ids.tricMasc });
    const diag = await src.loadClientFolderMatch("TRC BEAUTY");
    expect(diag).toMatchObject({ how: "vinculo", exact: ["TRICOLOGIA PROFESIONAL"] });
  });

  it("nada de esto tocó stock, consumos de MP, lotes ni otras órdenes", async () => {
    expect(await integritySnapshot()).toBe(snapshot);
    // Las órdenes que ya existían (OE/OA emitidas antes) siguen idénticas.
    const after = new Map((await q("select id, version, md5(form_data::text) h from operational_orders")).map((r) => [String(r.id), `${r.version}|${r.h}`]));
    for (const o of ordersBefore) expect(after.get(String(o.id))).toBe(`${o.version}|${o.h}`);
  });
});
