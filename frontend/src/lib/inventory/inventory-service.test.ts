import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  calcControlEstado,
  calcDiasAlVence,
  calcFalta,
  calcMpEstadoStock,
  calcMpEstadoVencimiento,
  multiplyTotal,
} from "@/lib/inventory/calcs";
import { MemoryInventoryRepo } from "@/lib/inventory/memory-repo";
import {
  InventoryForbiddenError,
  InventoryService,
  InventoryValidationError,
} from "@/lib/inventory/inventory-service";
import {
  ME_ALERT_NOTIFY_SECTORS,
  canReadInventory,
  canWriteInventory,
} from "@/lib/inventory/rbac";
import {
  ME_INGRESO_COLUMNS,
  ME_SALIDA_COLUMNS,
  MP_COMPRA_COLUMNS,
  MP_CONTROL_COLUMNS,
  MP_INGRESO_COLUMNS,
  MP_STOCK_COLUMNS,
  MP_TABS,
} from "@/lib/inventory/types";
import { MOCK_PREVIEW_USERS } from "@/features/os/auth/lib/mock-preview-users";
import { resolveSectorHome } from "@/lib/role-engine/role-engine";
import { applyOaDeliveryToMe } from "@/lib/inventory/me-oa-bridge";
import {
  createEmptyOaContent,
  emptyOaMaterial,
  normalizeOrderContent,
} from "@/lib/orders/content";
import type { OperationalOrderRecord } from "@/lib/orders/types";
import type { SectorId } from "@/types/operational/sector";

const deposito = {
  email: "deposito@laboratoriogenus.com.ar",
  sector: "DEPOSITO" as SectorId,
};
const mp = { email: "mp@laboratoriogenus.com.ar", sector: "MATERIA_PRIMA" as SectorId };
const produccion = {
  email: "produccion@laboratoriogenus.com.ar",
  sector: "PRODUCCION" as SectorId,
  displayName: "Producción",
};
const elaboracion = {
  email: "elaboracion@laboratoriogenus.com.ar",
  sector: "ELABORACION" as SectorId,
};

function makeOaForSalida(materialId: string, codigo: string, usados: string): OperationalOrderRecord {
  const content = createEmptyOaContent({ productName: "Crema", client: "Cliente X" });
  content.materials = [
    emptyOaMaterial(1, {
      id: "line-1",
      codigo,
      nombreInsumo: "Insumo",
      usados,
      materialId,
    }),
  ];
  const normalized = normalizeOrderContent(content);
  return {
    id: "oa-anular-test",
    orderNumber: "OA-2026-000001",
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
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe("DEPOSITO acceso y navegación", () => {
  it("login deposito está entre los ocho accesos", () => {
    expect(MOCK_PREVIEW_USERS).toHaveLength(8);
    const u = MOCK_PREVIEW_USERS.find((x) => x.email === "deposito@laboratoriogenus.com.ar");
    expect(u).not.toHaveProperty("password");
    expect(u?.sector).toBe("DEPOSITO");
  });

  it("sidebar DEPOSITO: Ingresos ME, Salidas ME, Avisos, Semanas", () => {
    const home = resolveSectorHome("DEPOSITO");
    expect(home.sidebarItems).toEqual([
      "ingresos_me",
      "salidas_me",
      "inventario_me",
      "deposito_graneles",
      "avisos",
      "semanas_produccion",
      "procedimientos",
    ]);
    expect(home.sidebarItems).not.toContain("avisos_me");
  });

  it("semanas solo lectura para DEPOSITO", () => {
    expect(canWriteInventory("DEPOSITO", "semanas_ro")).toBe(false);
    expect(canReadInventory("DEPOSITO", "semanas_ro")).toBe(true);
    const repo = new MemoryInventoryRepo();
    const svc = new InventoryService(repo);
    expect(() => svc.assertCanMutateSemanas(deposito)).toThrow(InventoryForbiddenError);
  });
});

describe("Columnas exactas ME/MP", () => {
  it("Ingresos ME columnas", () => {
    expect([...ME_INGRESO_COLUMNS]).toEqual([
      "FECHA",
      "INGRESO Nº",
      "PROVEEDOR",
      "CLIENTE",
      "REMITO Nº",
      "CÓDIGO",
      "DESCRIPCIÓN INSUMO",
      "BULTOS",
      "CANTIDAD",
      "TOTAL",
      "UBICACIÓN",
    ]);
  });

  it("Salidas ME columnas", () => {
    expect([...ME_SALIDA_COLUMNS]).toEqual([
      "FECHA",
      "EGRESO N.º",
      "CLIENTE",
      "REMITO N.º",
      "DESCRIPCIÓN",
      "BULTOS",
      "CANTIDAD",
      "TOTAL",
      "CONTROL",
      "ENTREGADO",
      "COMENTARIOS",
    ]);
  });

  it("MP pestañas Stock/Ingresos/Control/Compras/COA'S y columnas", () => {
    expect([...MP_TABS]).toEqual([
      "Stock",
      "Ingresos MP",
      "Control semanal",
      "Compras MP",
      "COA'S",
    ]);
    expect(MP_STOCK_COLUMNS).toHaveLength(13);
    expect(MP_INGRESO_COLUMNS).toHaveLength(14);
    expect(MP_STOCK_COLUMNS).toContain("PRODUCTO");
    expect(MP_INGRESO_COLUMNS).toContain("PRODUCTO");
    expect(MP_CONTROL_COLUMNS).toHaveLength(7);
    expect(MP_COMPRA_COLUMNS).toHaveLength(9);
    const home = resolveSectorHome("MATERIA_PRIMA");
    expect(home.sidebarItems.slice(0, 4)).toEqual([
      "stock",
      "mp_ingresos",
      "control_mp",
      "mp_compras",
    ]);
  });
});

describe("Cálculos automáticos", () => {
  it("TOTAL = BULTOS × CANTIDAD; vacío si falta; sin NaN", () => {
    expect(multiplyTotal(2, 10)).toBe(20);
    expect(multiplyTotal(2.5, 4)).toBe(10);
    expect(multiplyTotal(null, 4)).toBeNull();
    expect(multiplyTotal(2, null)).toBeNull();
    expect(multiplyTotal(Number.NaN, 1)).toBeNull();
  });

  it("estado stock / vencimiento MP", () => {
    expect(calcMpEstadoStock(null)).toBe("Sin dato");
    expect(calcMpEstadoStock(0)).toBe("Sin stock");
    expect(calcMpEstadoStock(1)).toBe("Stock crítico");
    expect(calcMpEstadoStock(3)).toBe("Stock bajo");
    expect(calcMpEstadoStock(5)).toBe("Stock OK");
    const dias = calcDiasAlVence("2099-01-01", new Date("2026-07-20"));
    expect(dias).toBeGreaterThan(90);
    expect(calcMpEstadoVencimiento(dias)).toBe("Vigente");
    expect(calcMpEstadoVencimiento(-1)).toBe("Vencido");
    expect(calcMpEstadoVencimiento(30)).toBe("Vence pronto");
    expect(calcMpEstadoVencimiento(null)).toBe("Sin dato");
  });

  it("FALTA y ESTADO control", () => {
    expect(calcFalta(null, 5)).toBeNull();
    expect(calcFalta(10, null)).toBe(10);
    expect(calcFalta(10, 3)).toBe(7);
    expect(calcFalta(10, 20)).toBe(0);
    expect(calcControlEstado(7)).toBe("FALTA");
    expect(calcControlEstado(0)).toBe("HAY");
    expect(calcControlEstado(null)).toBe("");
  });
});

describe("InventoryService ME/MP", () => {
  let repo: MemoryInventoryRepo;
  let svc: InventoryService;
  let notifications: { title: string; sectors: SectorId[] }[];

  beforeEach(() => {
    repo = new MemoryInventoryRepo();
    svc = new InventoryService(repo);
    notifications = [];
    svc.onNotify((p) => {
      notifications.push({ title: p.title, sectors: p.sectors });
    });
  });

  it("CRUD ingreso ME actualiza stock y TOTAL auto", () => {
    const row = svc.upsertMeIngreso(deposito, {
      codigo: "CAJ-01",
      descripcionInsumo: "Cajas",
      bultos: 10,
      cantidad: 25,
      ingresoNro: "EXT-100",
    });
    expect(row.total).toBe(250);
    expect(row.ingresoNro).toBe("EXT-100");
    const mats = svc.listMeMaterials(deposito);
    expect(mats[0]?.stockActual).toBe(250);

    const edited = svc.upsertMeIngreso(deposito, {
      id: row.id,
      codigo: "CAJ-01",
      descripcionInsumo: "Cajas",
      bultos: 5,
      cantidad: 25,
      materialId: row.materialId,
    });
    expect(edited.total).toBe(125);
    expect(svc.listMeMaterials(deposito)[0]?.stockActual).toBe(125);

    svc.deleteMeIngreso(deposito, row.id, "corrección");
    expect(svc.listMeMaterials(deposito)[0]?.stockActual).toBe(0);
  });

  it("varios ingresos con mismo Ingreso Nº", () => {
    svc.upsertMeIngreso(deposito, {
      ingresoNro: "R-1",
      descripcionInsumo: "Tapas",
      bultos: 1,
      cantidad: 10,
    });
    svc.upsertMeIngreso(deposito, {
      ingresoNro: "R-1",
      descripcionInsumo: "Etiquetas",
      bultos: 2,
      cantidad: 5,
    });
    const list = svc.listMeIngresos(deposito);
    expect(list.filter((r) => r.ingresoNro === "R-1")).toHaveLength(2);
    expect(list[0]!.id).not.toBe(list[1]!.id);
  });

  it("salida MANUAL no descuenta; OA sí descuenta con confirmación si negativo", () => {
    const ing = svc.upsertMeIngreso(deposito, {
      descripcionInsumo: "Cajas",
      codigo: "CAJ-X",
      bultos: 1,
      cantidad: 100,
    });
    // Manual: no afecta stock
    svc.upsertMeSalida(deposito, {
      descripcion: "Cajas",
      codigo: "CAJ-X",
      materialId: ing.materialId,
      bultos: 2,
      cantidad: 100,
      origen: "MANUAL",
    });
    expect(svc.listMeMaterials(deposito)[0]?.stockActual).toBe(100);

    expect(() =>
      svc.applyOaStockDelta(deposito, ing.materialId!, -200, {})
    ).toThrow(InventoryValidationError);

    svc.applyOaStockDelta(deposito, ing.materialId!, -200, {
      allowNegative: true,
      reason: "urgencia producción",
    });
    expect(svc.listMeMaterials(deposito)[0]?.stockActual).toBe(-100);
  });

  it("aviso al cruzar mínimo sin duplicar; notifica 8 sectores; dismiss no borra aviso", () => {
    const ing = svc.upsertMeIngreso(deposito, {
      descripcionInsumo: "Cajas",
      bultos: 1,
      cantidad: 1000,
    });
    svc.updateMeThresholds(deposito, ing.materialId!, {
      stockMinimo: 500,
      puntoReposicion: 800,
    });
    // Bajar stock
    svc.adjustMeStock(deposito, ing.materialId!, 250, "consumo");
    expect(notifications).toHaveLength(1);
    expect(notifications[0]!.sectors).toEqual(ME_ALERT_NOTIFY_SECTORS);
    expect(ME_ALERT_NOTIFY_SECTORS).toHaveLength(8);

    // Otro movimiento: actualiza, no duplica
    svc.adjustMeStock(deposito, ing.materialId!, 200, "más consumo");
    expect(svc.listMeAlerts(deposito)).toHaveLength(1);
    expect(svc.listMeAlerts(deposito)[0]!.stockActual).toBe(200);

    const alertId = svc.listMeAlerts(deposito)[0]!.id;
    svc.dismissAlertForUser(elaboracion, alertId);
    expect(svc.listMeAlerts(deposito)).toHaveLength(1);
    expect(repo.getAlertRead(alertId, elaboracion.email)?.dismissedAt).toBeTruthy();

    // Recuperación
    svc.adjustMeStock(deposito, ing.materialId!, 900, "reposición");
    expect(svc.listMeAlerts(deposito)[0]!.status).toBe("STOCK_RECUPERADO");

    // Vuelve a bajar → nuevo aviso
    svc.adjustMeStock(deposito, ing.materialId!, 100, "otra vez");
    expect(svc.listMeAlerts(deposito).filter((a) => a.status !== "STOCK_RECUPERADO").length).toBe(
      1
    );
    expect(notifications.length).toBeGreaterThanOrEqual(2);
  });

  it("ajuste inventario ME solo DEPOSITO/PRODUCCION", () => {
    const ing = svc.upsertMeIngreso(deposito, {
      descripcionInsumo: "X",
      bultos: 1,
      cantidad: 10,
    });
    expect(() => svc.adjustMeStock(mp, ing.materialId!, 5, "no")).toThrow(InventoryForbiddenError);
    svc.adjustMeStock(produccion, ing.materialId!, 5, "conteo");
    expect(svc.listMeMaterials(deposito)[0]?.stockActual).toBe(5);
  });

  it("MP ingreso visible + stock aumenta; editar aplica delta; anular revierte y conserva fila", async () => {
    const row = await svc.upsertMpIngreso(mp, {
      codigo: "GLI-01",
      descripcion: "Glicerina",
      lote: "L1",
      bultos: 2,
      cantidad: 25,
    });
    expect(row.total).toBe(50);
    expect(row.status).toBe("CONFIRMADO");
    expect(row.stockImpacted).toBe(true);
    expect(svc.listMpStock(mp)[0]?.cantidadKg).toBe(50);

    await svc.upsertMpIngreso(mp, {
      id: row.id,
      codigo: "GLI-01",
      descripcion: "Glicerina",
      lote: "L1",
      bultos: 1,
      cantidad: 25,
      stockLotId: row.stockLotId,
    });
    expect(svc.listMpStock(mp)[0]?.cantidadKg).toBe(25);

    const anul = await svc.anularMpIngreso(mp, row.id, "error carga");
    expect(anul.status).toBe("ANULADO");
    expect(svc.listMpIngresos(mp).find((r) => r.id === row.id)).toBeTruthy();
    expect(svc.listMpStock(mp)[0]?.cantidadKg).toBe(0);
  });

  it("MP ingreso incompleto = BORRADOR sin stock; completar = un impacto", async () => {
    const draft = await svc.upsertMpIngreso(mp, {
      descripcion: "Sin datos",
    });
    expect(draft.status).toBe("BORRADOR");
    expect(draft.stockImpacted).toBe(false);
    expect(draft.stockMessage).toMatch(/Guardado sin afectar Stock/);
    expect(svc.listMpStock(mp)).toHaveLength(0);

    const empty = await svc.upsertMpIngreso(mp, {});
    expect(empty.status).toBe("BORRADOR");
    expect(empty.stockImpacted).toBe(false);

    const incomplete = await svc.upsertMpIngreso(mp, {
      codigo: "MP-X",
      descripcion: "Solo código",
    });
    expect(incomplete.status).toBe("BORRADOR");
    expect(incomplete.stockImpacted).toBe(false);

    const completed = await svc.upsertMpIngreso(mp, {
      id: incomplete.id,
      codigo: "MP-X",
      descripcion: "Solo código",
      bultos: 1,
      cantidad: 40,
      confirm: true,
    });
    expect(completed.status).toBe("CONFIRMADO");
    expect(completed.stockImpacted).toBe(true);
    expect(svc.listMpStock(mp)[0]?.cantidadKg).toBe(40);
  });

  it("MP ingreso sin código + qty confirma con INT-MP y aparece en Stock", async () => {
    const row = await svc.upsertMpIngreso(mp, {
      descripcion: "Sin codigo proveedor",
      lote: "L-SC",
      bultos: 1,
      cantidad: 12,
      confirm: true,
    });
    expect(row.status).toBe("CONFIRMADO");
    expect(row.stockImpacted).toBe(true);
    expect(row.codigoPendiente).toBe(true);
    expect(row.codigo).toMatch(/^INT-MP-/i);
    const lot = svc.listMpStock(mp).find((s) => s.id === row.stockLotId);
    expect(lot?.cantidadKg).toBe(12);
    expect(lot?.codigoPendiente).toBe(true);
    expect(lot?.codigo).toBe(row.codigo);
  });

  it("MP cambio de código revierte viejo y aplica nuevo; producto no duplica saldo", async () => {
    const row = await svc.upsertMpIngreso(mp, {
      codigo: "OLD-1",
      producto: "Crema A",
      descripcion: "Base",
      bultos: 1,
      cantidad: 10,
    });
    expect(svc.listMpStock(mp).find((s) => s.codigo === "OLD-1")?.cantidadKg).toBe(10);

    const moved = await svc.upsertMpIngreso(mp, {
      id: row.id,
      codigo: "NEW-2",
      producto: "Crema A",
      descripcion: "Base",
      bultos: 1,
      cantidad: 10,
    });
    expect(moved.stockImpacted).toBe(true);
    expect(svc.listMpStock(mp).find((s) => s.codigo === "OLD-1")?.cantidadKg).toBe(0);
    expect(svc.listMpStock(mp).find((s) => s.codigo === "NEW-2")?.cantidadKg).toBe(10);

    await svc.upsertMpIngreso(mp, {
      codigo: "NEW-2",
      producto: "Crema B",
      descripcion: "Base",
      bultos: 1,
      cantidad: 5,
    });
    const stock = svc.listMpStock(mp).find((s) => s.codigo === "NEW-2");
    expect(stock?.cantidadKg).toBe(15);
    expect(stock?.productosAsociados).toBe("Crema A · Crema B");
  });

  it("control semanal calcula FALTA/ESTADO y toma stock", () => {
    svc.upsertMpStock(mp, { descripcion: "Agua", cantidadKg: 40, lote: "A" });
    const row = svc.upsertMpControl(mp, {
      productoElaborar: "Crema",
      materiaPrima: "Agua",
      cantNecesaria: 100,
    });
    expect(row.enInventario).toBe(40);
    expect(row.inventarioOrigen).toBe("STOCK");
    expect(row.falta).toBe(60);
    expect(row.estado).toBe("FALTA");
  });

  it("compra En planta ofrece ingreso sin duplicar stock", async () => {
    const res = svc.upsertMpCompra(mp, {
      materiaPrima: "Alcohol",
      cantidad: 10,
      estado: "En planta",
      proveedor: "Prov",
    });
    expect(res.offerCreateIngreso).toBe(true);
    expect(res.ingresoPrefill?.descripcion).toBe("Alcohol");
    expect(svc.listMpStock(mp)).toHaveLength(0);

    const ing = await svc.upsertMpIngreso(mp, {
      codigo: "ALC-01",
      descripcion: "Alcohol",
      bultos: 1,
      cantidad: 10,
      lote: "C1",
    });
    expect(ing.status).toBe("CONFIRMADO");
    svc.linkCompraToIngreso(mp, res.compra.id, ing.id);
    expect(() => svc.linkCompraToIngreso(mp, res.compra.id, ing.id)).toThrow(
      InventoryValidationError
    );
  });

  it("API-style: actor ausente / sector incorrecto no escribe", () => {
    expect(() =>
      svc.upsertMeIngreso({ email: "x", sector: undefined as unknown as SectorId }, {})
    ).toThrow();
    expect(() => svc.upsertMeIngreso(elaboracion, { descripcionInsumo: "no" })).toThrow(
      InventoryForbiddenError
    );
    expect(repo.meIngresos).toHaveLength(0);
  });

  it("PRODUCCION consulta ME pero no escribe movimientos", () => {
    expect(canReadInventory("PRODUCCION", "me_ingresos")).toBe(true);
    expect(canWriteInventory("PRODUCCION", "me_ingresos")).toBe(false);
    expect(canWriteInventory("PRODUCCION", "me_avisos")).toBe(true);
  });
});

describe("ME salidas anular", () => {
  it("anular salida OA es idempotente y reintegra stock una sola vez", () => {
    const repo = new MemoryInventoryRepo();
    const svc = new InventoryService(repo);
    const ing = svc.upsertMeIngreso(deposito, {
      codigo: "ANU-01",
      descripcionInsumo: "Cajas",
      bultos: 1,
      cantidad: 500,
    });
    const oa = makeOaForSalida(ing.materialId!, "ANU-01", "80");
    applyOaDeliveryToMe(svc, produccion, oa);
    expect(svc.listMeInventario(deposito)[0]?.cantidadTotal).toBe(420);

    const salida = svc.listMeSalidas(deposito).find((s) => s.origen === "OA" && !s.reverted)!;
    const first = svc.anularMeSalida(deposito, salida.id, "Error de carga");
    expect(first.reverted).toBe(true);
    expect(svc.listMeInventario(deposito)[0]?.cantidadTotal).toBe(500);

    const second = svc.anularMeSalida(deposito, salida.id, "segundo intento");
    expect(second.reverted).toBe(true);
    expect(second.id).toBe(first.id);
    expect(svc.listMeInventario(deposito)[0]?.cantidadTotal).toBe(500);
  });
});

describe("Pegado Excel — campos calculados ignorados", () => {
  it("multiplyTotal ignora basura pegada recalculando", () => {
    // Simula que el usuario pegó TOTAL=999 pero la app recalcula
    const bultos = 3;
    const cantidad = 4;
    const pastedTotal = 999;
    expect(multiplyTotal(bultos, cantidad)).not.toBe(pastedTotal);
    expect(multiplyTotal(bultos, cantidad)).toBe(12);
  });
});

describe("MP Stock — archivo lógico seguro", () => {
  let svc: InventoryService;

  beforeEach(() => {
    svc = new InventoryService(new MemoryInventoryRepo());
  });

  it("bloquea deleteMpStock si hay ingreso activo ligado", async () => {
    const row = await svc.upsertMpIngreso(mp, {
      codigo: "ARC-01",
      descripcion: "A",
      lote: "L-A",
      bultos: 1,
      cantidad: 10,
      confirm: true,
    });
    expect(row.stockLotId).toBeTruthy();
    expect(() => svc.deleteMpStock(mp, row.stockLotId!, "cleanup")).toThrow(
      /vinculado al ingreso/i
    );
    expect(svc.listMpStock(mp)).toHaveLength(1);
  });

  it("archiva saldo manual sin ingresos y lo oculta del listado", () => {
    const lot = svc.upsertMpStock(mp, {
      codigo: "MAN-1",
      descripcion: "Manual",
      cantidadKg: 0,
      origen: "manual",
    });
    const archived = svc.deleteMpStock(mp, lot.id, "sin uso");
    expect(archived.archived).toBe(true);
    expect(svc.listMpStock(mp).find((r) => r.id === lot.id)).toBeUndefined();
  });

  it("permite archivar tras anular el ingreso origen", async () => {
    const row = await svc.upsertMpIngreso(mp, {
      codigo: "ARC-02",
      descripcion: "B",
      lote: "L-B",
      bultos: 1,
      cantidad: 5,
      confirm: true,
    });
    await svc.anularMpIngreso(mp, row.id, "error");
    const archived = svc.deleteMpStock(mp, row.stockLotId!, "limpieza");
    expect(archived.archived).toBe(true);
    expect(svc.listMpStock(mp).find((r) => r.id === row.stockLotId)).toBeUndefined();
  });
});

describe("Permisos sectoriales inventario", () => {
  it.each([
    ["DEPOSITO", "me_ingresos", true],
    ["DEPOSITO", "mp_stock", false],
    ["MATERIA_PRIMA", "mp_compras", true],
    ["MATERIA_PRIMA", "me_ingresos", false],
    ["CALIDAD", "me_ingresos", false],
    ["CALIDAD", "mp_stock", false],
    ["ELABORACION", "me_avisos", false],
  ] as const)("%s write %s => %s", (sector, mod, expected) => {
    expect(canWriteInventory(sector, mod)).toBe(expected);
  });
});

// silenciar unused vi
void vi;
