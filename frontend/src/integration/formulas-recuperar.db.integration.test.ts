/**
 * Fórmulas de Drive que no cargaban sus materias primas en la OE — contra un Postgres de PRUEBA real y un Drive SIMULADO en memoria.
 * Archivos SINTÉTICOS (no son fórmulas reales de clientes). Cubre: estructura distinta, archivo sin ingredientes (motivo claro),
 * recuperación de OE ya vinculadas con tabla vacía (sin duplicar ni pisar lo cargado a mano), archivo inaccesible y cantidades de 40 kg.
 * Se SALTA sin base local marcada.
 */
import { randomUUID } from "node:crypto";
import * as XLSX from "xlsx";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { assertMarkedDatabase, e2eEnvironmentProblem } from "../../scripts/e2e/e2e-safety.mjs";

const PROBLEM = e2eEnvironmentProblem() ?? (process.env.GENUS_E2E_DATABASE_URL ? null : "falta GENUS_E2E_DATABASE_URL");
const RUN = Date.now().toString().slice(-6);
const ROOT = `it-fmrec-root-${RUN}`;
const prod = { email: "it-fmrec-prod@laboratoriogenus.com.ar", sector: "PRODUCCION", displayName: "IT Producción" };
const NOTE = `IT-FORMULAS-RECUPERAR-${RUN}`;
const OE_BASE = 700000 + Math.floor(Math.random() * 900) * 100;
let oeSeq = 0;

const sheetXlsx = (rows: Array<Array<string | number>>): Buffer => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Hoja1");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
};
/** Estructura «complicada»: título arriba, encabezado desplazado, títulos de fase, subtotal y porcentajes escritos como texto. */
const complex = (items: Array<[string, string, string]>) =>
  sheetXlsx([
    ["", "ORDEN DE ELABORACIÓN"],
    ["", ""],
    ["", "Cliente: PILAR"],
    ["", ""],
    ["", "MATERIA PRIMA", "CÓDIGO", "Fórmula %"],
    ["", "FASE A:", "", ""],
    ...items.slice(0, 1).map((i) => ["", ...i]),
    ["", "Subtotal fase A", "", items[0]![2]],
    ["", "Fase B", "", ""],
    ...items.slice(1).map((i) => ["", ...i]),
    ["", "Total expresado en kg", "", "100"],
    ["", "PROCEDIMIENTO DE ELABORACIÓN"],
    ["", "1- Mezclar"],
  ]);
const ITEMS: Array<[string, string, string]> = [["AGUA DESIONIZADA", "MP-1", "94 %"], ["ACTIVO KOLLAREN", "MP-2", "5,0"], ["PERFUME", "MP-3", "1%"]];
const NOT_A_FORMULA = sheetXlsx([["Notas del producto"], ["Pendiente de completar"]]);

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


describe.skipIf(Boolean(PROBLEM))(`Fórmulas de Drive → OE: recuperación y lectura robusta${PROBLEM ? ` — saltado: ${PROBLEM}` : ""}`, () => {
  let pool: import("@neondatabase/serverless").Pool;
  const q = async (text: string, params: unknown[] = []) => (await pool.query(text, params)).rows as Record<string, unknown>[];
  const drive = new FakeDrive();
  const ids: Record<string, string> = {};
  let src: typeof import("@/lib/formulas/drive-formula-source");

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
    const pilar = drive.folder(ROOT, "PILAR RECUPERAR");
    ids.pilar = pilar;
    ids.kollaren = drive.file(pilar, "PILAR RECUPERAR - SERUM KOLLAREN.xlsx", complex(ITEMS));
    ids.vacia = drive.file(pilar, "SERUM VACIO.xlsx", NOT_A_FORMULA);
    ids.manual = drive.file(pilar, "SERUM MANUAL.xlsx", complex(ITEMS));
    ids.denegado = drive.file(pilar, "SERUM DENEGADO.xlsx", complex(ITEMS));
    ids.vaciada = drive.file(pilar, "SERUM VACIADA.xlsx", complex(ITEMS));
    expect((await src.syncFormulaIndex({ trigger: "manual", actorEmail: prod.email })).ok).toBe(true);
  }, 60_000);

  afterAll(async () => {
    src?.setFormulaDriveListerForTests(null);
    delete process.env.GENUS_FORMULAS_DRIVE_ROOT_ID;
    await q("update work_items set deleted_at = now() where notes = $1", [NOTE]).catch(() => undefined);
    await pool?.end();
  });

  const assign = async (product: string, qty = "40") => {
    const { assignWorkItemDurable } = await import("@/lib/planning/work-assignment-service");
    const { prepareOeAfterWorkChange } = await import("@/lib/planning/oe-auto-prep");
    const orderNumber = `OE-2026-${String(OE_BASE + ++oeSeq).padStart(6, "0")}`;
    const result = await assignWorkItemDurable(
      { sector: "ELABORACION", client: "PILAR RECUPERAR", product, plannedQuantity: qty, unit: "kg", plannedDate: "2026-11-25", branchOwner: "Cristian", orderNumber, packagingLote: "IT-REC-L1", notes: NOTE, idempotencyKey: randomUUID() } as never,
      prod,
      randomUUID()
    );
    await prepareOeAfterWorkChange(result.order!.id, prod, "Asignación del trabajo a Elaboración");
    return { workId: String(result.item.id), orderId: String(result.order!.id), orderNumber };
  };
  type Fd = { materials: Array<{ id: string; materiaPrima: string; formulaPct: number | null; kgAPesar: number | null; lote: string }>; totals: { kgSum: number | null }; autoPrep?: { formula: { status: string; message: string } } };
  const oe = async (id: string) => {
    const [r] = await q("select form_data, version from operational_orders where id = $1", [id]);
    return { fd: r!.form_data as Fd, version: Number(r!.version) };
  };

  it("A, 10) estructura compleja (encabezado desplazado, fases, subtotal, % como texto): carga las MP y calcula una orden de 40 kg", async () => {
    const a = await assign("SERUM KOLLAREN", "40");
    const { fd } = await oe(a.orderId);
    expect(fd.autoPrep?.formula.status).toBe("ok");
    expect(fd.materials.map((m) => [m.materiaPrima, m.formulaPct, m.kgAPesar])).toEqual([["AGUA DESIONIZADA", 94, 37.6], ["ACTIVO KOLLAREN", 5, 2], ["PERFUME", 1, 0.4]]);
    expect(fd.totals.kgSum).toBe(40);
  });

  it("7, B) archivo vinculado sin ingredientes: la OE explica la causa (no queda una tabla vacía sin aviso); al corregir el archivo, «reintentar» la completa SIN duplicar", async () => {
    const b = await assign("SERUM VACIO");
    const first = await oe(b.orderId);
    expect(first.fd.materials).toHaveLength(0);
    expect(first.fd.autoPrep?.formula.status).not.toBe("ok");
    expect(first.fd.autoPrep?.formula.message).toMatch(/No se pudieron cargar las materias primas de esta fórmula\./);
    expect(first.fd.autoPrep?.formula.message).toMatch(/tabla de materias primas/);

    // Producción vincula el archivo; sigue sin poder leerse: el motivo queda en la OE y no se inventa nada.
    await src.linkFormula(prod, { client: "PILAR RECUPERAR", product: "SERUM VACIO", fileId: ids.vacia! });
    const r0 = await src.retryPendingOeFormulas(prod, { workItemIds: [b.workId] });
    expect(r0.resolved).toBe(0);
    expect(r0.details[0]).toMatchObject({ outcome: "unreadable" });
    expect((await oe(b.orderId)).fd.materials).toHaveLength(0);

    // Se corrige el archivo en Drive (sin vincular de nuevo ni crear otra OE) y se reintenta.
    drive.nodes.get(ids.vacia!)!.data = complex(ITEMS);
    const r1 = await src.retryPendingOeFormulas(prod, { workItemIds: [b.workId] });
    expect(r1).toMatchObject({ resolved: 1 });
    expect(r1.details[0]).toMatchObject({ outcome: "loaded" });
    const done = await oe(b.orderId);
    expect(done.fd.materials).toHaveLength(3);
    expect(done.fd.materials.map((m) => m.kgAPesar)).toEqual([37.6, 2, 0.4]);
    expect(Number((await q("select count(*)::int n from operational_orders where order_number = $1", [b.orderNumber]))[0]!.n)).toBe(1);
    const ids1 = done.fd.materials.map((m) => m.id);

    // 11) reprocesar de nuevo: no duplica ni cambia nada.
    const r2 = await src.retryPendingOeFormulas(prod, { workItemIds: [b.workId] });
    expect(r2.resolved).toBe(0);
    const again = await oe(b.orderId);
    expect(again.version).toBe(done.version);
    expect(again.fd.materials.map((m) => m.id)).toEqual(ids1);
  });

  it("8) una OE con fórmula cargada y trabajando bien no se toca al reprocesar", async () => {
    const a = await assign("SERUM KOLLAREN", "40");
    const before = await oe(a.orderId);
    const r = await src.retryPendingOeFormulas(prod, { workItemIds: [a.workId] });
    expect(r.checked).toBe(0);
    expect((await oe(a.orderId)).version).toBe(before.version);
  });

  it("C) OE ya vinculada que quedó con la fórmula «ok» pero SIN materias primas: se recupera sin recrear la OE; el procedimiento escrito a mano se conserva", async () => {
    const c = await assign("SERUM VACIADA");
    const ok = await oe(c.orderId);
    expect(ok.fd.autoPrep?.formula.status).toBe("ok");
    // Estado que dejó el problema original: fórmula marcada «ok» pero tabla vacía y 0 kg; Producción escribió un procedimiento a mano.
    await q("update operational_orders set form_data = jsonb_set(jsonb_set(form_data, '{materials}', '[]'::jsonb), '{procedureSteps}', '[{\"id\":\"m1\",\"text\":\"Paso escrito a mano\"}]'::jsonb) where id = $1", [c.orderId]);
    const r = await src.retryPendingOeFormulas(prod, { workItemIds: [c.workId] });
    expect(r.resolved).toBe(1);
    const fixed = await oe(c.orderId);
    expect(fixed.fd.materials).toHaveLength(3);
    expect((fixed.fd as unknown as { procedureSteps: Array<{ text: string }> }).procedureSteps.map((s) => s.text)).toEqual(["Paso escrito a mano"]);
  });

  it("12) OE con materias primas cargadas a mano: no se pisan (ni con «reintentar»)", async () => {
    const m = await assign("SERUM MANUAL");
    await q("update operational_orders set form_data = jsonb_set(jsonb_set(form_data, '{materials,0,materiaPrima}', '\"MP A MANO\"'::jsonb), '{materials,0,lote}', '\"L-123\"'::jsonb) where id = $1", [m.orderId]);
    const before = await oe(m.orderId);
    const r = await src.retryPendingOeFormulas(prod, { workItemIds: [m.workId] });
    expect(r.checked).toBe(0);
    const after = await oe(m.orderId);
    expect(after.version).toBe(before.version);
    expect(after.fd.materials[0]).toMatchObject({ materiaPrima: "MP A MANO", lote: "L-123" });
  });

  it("9) archivo sin permisos: el motivo queda explícito en la OE y no se muestra una fórmula vacía como válida", async () => {
    drive.denied.add(ids.denegado!);
    const d = await assign("SERUM DENEGADO");
    const { fd } = await oe(d.orderId);
    expect(fd.materials).toHaveLength(0);
    expect(fd.autoPrep?.formula.status).not.toBe("ok");
    expect(fd.autoPrep?.formula.message?.length).toBeGreaterThan(10);
    drive.denied.delete(ids.denegado!);
    const r = await src.retryPendingOeFormulas(prod, { workItemIds: [d.workId] });
    expect(r.resolved).toBe(1);
    expect((await oe(d.orderId)).fd.materials).toHaveLength(3);
  });
});
