import { describe, expect, it } from "vitest";
import {
  alertDecision, boxClientKey, cajasFromPackingGroups, classifyClient, computeStock, criticalMessage, decideEgress, egressDiff, ingresoTotal, periodStart, runningBalance,
  type ClientSettingLite, type EgressInput, type LedgerRow,
} from "./rules";

const OWN = ["BIOESENCIA", "ORIGINAL BLACK", "TRC", "JACTANS", "BL COSMETICS", "BAHIA EVANS"];
const settings = (): Map<string, ClientSettingLite> => new Map(OWN.map((n) => [boxClientKey(n)!, { clientKey: boxClientKey(n)!, usesOwnBoxes: true }]));

describe("ingreso: BULTOS × CANTIDAD", () => {
  it("10 × 50 = 500; enteros positivos; acepta texto con separadores", () => {
    expect(ingresoTotal(10, 50)).toEqual({ ok: true, bultos: 10, cantidad: 50, total: 500 });
    expect(ingresoTotal("10", "50")).toMatchObject({ ok: true, total: 500 });
    expect(ingresoTotal(0, 5)).toMatchObject({ ok: false });
    expect(ingresoTotal(2.5, 5)).toMatchObject({ ok: false });
    expect(ingresoTotal(3, -1)).toMatchObject({ ok: false });
    expect(ingresoTotal("abc", 1)).toMatchObject({ ok: false });
    expect(ingresoTotal(100000, 1000)).toMatchObject({ ok: false });
  });
});

describe("cajas de una entrega: suma las CAJAS de todos los grupos (no las unidades)", () => {
  it("5 de 100 = 5; 4 de 100 + 1 de 50 = 5; sin detalle o no enteras = revisión", () => {
    expect(cajasFromPackingGroups([{ cajas: 5, unidadesPorCaja: 100 }])).toMatchObject({ ok: true, total: 5 });
    expect(cajasFromPackingGroups([{ cajas: 4, unidadesPorCaja: 100 }, { cajas: 1, unidadesPorCaja: 50 }])).toMatchObject({ ok: true, total: 5 });
    expect(cajasFromPackingGroups(null)).toEqual({ ok: false, reason: "SIN_DETALLE" });
    expect(cajasFromPackingGroups([])).toEqual({ ok: false, reason: "SIN_DETALLE" });
    expect(cajasFromPackingGroups([{ cajas: 0, unidadesPorCaja: 10 }])).toEqual({ ok: false, reason: "SIN_DETALLE" });
    expect(cajasFromPackingGroups([{ cajas: 2.5, unidadesPorCaja: 10 }])).toEqual({ ok: false, reason: "CAJAS_NO_ENTERAS" });
  });
});

describe("clientes con cajas propias", () => {
  it("los seis, con variantes de escritura, usan cajas propias; clientes parecidos pero distintos NO", () => {
    const s = settings();
    for (const n of [...OWN, "bioesencia", "Original Black S.A.", "OriginalBlack", "B.L. Cosmetics", "Bahía Evans SRL", "  trc  ", "Jactans S.A."]) expect(classifyClient(n, s).status, n).toBe("PROPIAS");
    for (const n of ["TRC Cosmetics", "Bioesencia Pro", "BL Cosmetics Norte", "Black", "Evans", "Cliente Cualquiera"]) expect(classifyClient(n, s).status, n).toBe("GENUS");
  });
  it("sin nombre real = sin cliente (pendiente); las claves del maestro (alias) también clasifican; la clave exacta de la entrega manda", () => {
    const s = settings();
    for (const n of [null, undefined, "", "  ", "-", "sin cliente", "s/d"]) expect(classifyClient(n, s).status, String(n)).toBe("SIN_CLIENTE");
    expect(classifyClient("Bio Esencia Laboratorios", s, ["bioesencia"]).status).toBe("PROPIAS");
    const explicitNo = new Map(s).set("bioesencia", { clientKey: "bioesencia", usesOwnBoxes: false });
    expect(classifyClient("BIOESENCIA", explicitNo).status).toBe("GENUS");
  });
});

const base = (over: Partial<EgressInput> = {}): EgressInput => ({
  lineStatus: "ACTIVA", workItemDeleted: false, sourceSector: "ENVASADO_MASIVO", lineCreatedAt: new Date("2026-12-01"), trackingStartedAt: new Date("2026-11-01"),
  packingGroups: [{ cajas: 5, unidadesPorCaja: 100 }], client: { status: "GENUS", key: "x" }, ...over,
});
describe("qué se descuenta de una entrega", () => {
  it("entrega normal: sus cajas", () => expect(decideEgress(base())).toMatchObject({ cajas: 5, tracked: true, review: null, exempt: null }));
  it("cliente con cajas propias: 0 (se sigue en el libro)", () => expect(decideEgress(base({ client: { status: "PROPIAS", key: "x" } }))).toMatchObject({ cajas: 0, tracked: true, exempt: "CLIENTE_CAJAS_PROPIAS" }));
  it("sin cliente / sin detalle / cajas no enteras: pendiente de revisión, no inventa", () => {
    expect(decideEgress(base({ client: { status: "SIN_CLIENTE" } }))).toMatchObject({ cajas: 0, review: "SIN_CLIENTE" });
    expect(decideEgress(base({ packingGroups: null }))).toMatchObject({ cajas: 0, review: "SIN_DETALLE" });
    expect(decideEgress(base({ packingGroups: [{ cajas: 1.5, unidadesPorCaja: 10 }] }))).toMatchObject({ review: "CAJAS_NO_ENTERAS" });
  });
  it("anulada o trabajo borrado: 0 (se revierte lo descontado)", () => {
    expect(decideEgress(base({ lineStatus: "ANULADA" }))).toMatchObject({ cajas: 0, tracked: true, exempt: "ENTREGA_ANULADA" });
    expect(decideEgress(base({ workItemDeleted: true }))).toMatchObject({ cajas: 0, exempt: "ENTREGA_ANULADA" });
  });
  it("Elaboración (granel) y entregas anteriores al seguimiento no descuentan", () => {
    expect(decideEgress(base({ sourceSector: "ELABORACION" }))).toMatchObject({ cajas: 0, tracked: false, exempt: "SECTOR_NO_FINAL" });
    expect(decideEgress(base({ lineCreatedAt: new Date("2026-10-01") }))).toMatchObject({ cajas: 0, tracked: false, exempt: "ANTERIOR_AL_SEGUIMIENTO" });
  });
  it("Envasado Premium y Codificado sí", () => {
    expect(decideEgress(base({ sourceSector: "ENVASADO_PREMIUM" })).cajas).toBe(5);
    expect(decideEgress(base({ sourceSector: "CODIFICADO" })).cajas).toBe(5);
  });
  it("diferencia: solo lo que cambia (10 → 12 = −2; anulación = +10; sin cambio = nada)", () => {
    expect(egressDiff(0, 10)).toEqual({ delta: -10, kind: "EGRESO_ENTREGA" });
    expect(egressDiff(10, 12)).toEqual({ delta: -2, kind: "AJUSTE_ENTREGA" });
    expect(egressDiff(10, 8)).toEqual({ delta: 2, kind: "AJUSTE_ENTREGA" });
    expect(egressDiff(10, 0)).toEqual({ delta: 10, kind: "AJUSTE_ENTREGA" });
    expect(egressDiff(10, 10)).toBeNull();
  });
});

const row = (seq: number, kind: LedgerRow["kind"], delta: number, status = "ACTIVO"): LedgerRow => ({ seq, kind, delta, status, occurredOn: "2026-11-24" });
describe("stock = inicial + ingresos − egresos ± ajustes (solo lo posterior al stock inicial)", () => {
  it("sin stock inicial no hay stock", () => expect(computeStock([row(1, "INGRESO", 500)])).toMatchObject({ configured: false, stock: null, totalIngresos: 500 }));
  it("fórmula", () => {
    const s = computeStock([row(1, "INGRESO", 50), row(2, "STOCK_INICIAL", 1000), row(3, "INGRESO", 500), row(4, "EGRESO_ENTREGA", -5), row(5, "AJUSTE_ENTREGA", -2), row(6, "AJUSTE_MANUAL", 10)]);
    expect(s).toMatchObject({ configured: true, baseline: 1000, stock: 1503, ingresosDesdeBase: 500, egresosDesdeBase: 7, ajustesNetosDesdeBase: 10, totalIngresos: 550, totalEgresos: 7 });
  });
  it("los anulados no cuentan; vale el último stock inicial; puede quedar negativo", () => {
    const s = computeStock([row(1, "STOCK_INICIAL", 100), row(2, "INGRESO", 500, "ANULADO"), row(3, "STOCK_INICIAL", 10), row(4, "EGRESO_ENTREGA", -25)]);
    expect(s).toMatchObject({ baseline: 10, stock: -15 });
  });
  it("saldo acumulado por movimiento", () => {
    const rb = runningBalance([row(1, "INGRESO", 5), row(2, "STOCK_INICIAL", 100), row(3, "EGRESO_ENTREGA", -10), row(4, "INGRESO", 50, "ANULADO"), row(5, "INGRESO", 20)]);
    expect([...rb.entries()]).toEqual([[1, null], [2, 100], [3, 90], [4, 90], [5, 110]]);
  });
});

describe("alerta de stock crítico (≤ 300)", () => {
  const d = (stock: number | null, state: "NORMAL" | "CRITICO" = "NORMAL", configured = true) => alertDecision({ configured, stock, threshold: 300, state });
  it("301 normal; 300, 299, 0 y negativos críticos", () => {
    expect(d(301)).toEqual({ next: "NORMAL", notify: false, critical: false });
    expect(d(300)).toEqual({ next: "CRITICO", notify: true, critical: true });
    expect(d(299)).toMatchObject({ next: "CRITICO", critical: true });
    expect(d(0)).toMatchObject({ next: "CRITICO", critical: true });
    expect(d(-12)).toMatchObject({ next: "CRITICO", critical: true });
  });
  it("una notificación por episodio: ya crítico no repite; al reponer se desactiva; al volver a bajar notifica de nuevo", () => {
    expect(d(250, "CRITICO")).toEqual({ next: "CRITICO", notify: false, critical: true });
    expect(d(301, "CRITICO")).toEqual({ next: "NORMAL", notify: false, critical: false });
    expect(d(300, "NORMAL")).toMatchObject({ notify: true });
  });
  it("sin stock inicial configurado no hay alerta", () => {
    expect(d(null, "NORMAL", false)).toEqual({ next: "NORMAL", notify: false, critical: false });
    expect(d(10, "NORMAL", false)).toEqual({ next: "NORMAL", notify: false, critical: false });
  });
  it("mensaje exacto", () => expect(criticalMessage(120)).toBe("STOCK CRÍTICO DE CAJAS GENUS. Quedan solamente 120 cajas disponibles. Es necesario realizar una reposición"));
});

describe("períodos", () => {
  it("día, semana (lunes) y mes", () => {
    expect(periodStart("2026-11-24", "dia")).toBe("2026-11-24");
    expect(periodStart("2026-11-24", "semana")).toBe("2026-11-23"); // martes → lunes
    expect(periodStart("2026-11-22", "semana")).toBe("2026-11-16"); // domingo
    expect(periodStart("2026-11-24", "mes")).toBe("2026-11-01");
  });
});
