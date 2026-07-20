import { describe, expect, it, beforeEach } from "vitest";
import { MemoryOrdersRepository } from "@/lib/orders/memory-repository";
import { OrdersService } from "@/lib/orders/orders-service";
import { canOrderAction } from "@/lib/orders/rbac";
import {
  CREMA_FACIAL_LAUDE_PRODUCT_ID,
  SEED_OA_LAUDE_TEMPLATE_ID,
  SEED_OE_SERUM_TEMPLATE_ID,
  SERUM_ANTIAGE_PRODUCT_ID,
  listBuiltinTemplates,
  seedTemplateRecords,
} from "@/lib/orders/seed-templates";
import {
  emptyTemplatesExplanation,
  validateCreateOrderForm,
} from "@/features/os/operational/lib/create-order-validation";
import type { OrdersActor } from "@/lib/orders/types";

const calidad: OrdersActor = {
  email: "calidad@laboratoriogenus.com.ar",
  sector: "CALIDAD",
  displayName: "Calidad",
};
const produccion: OrdersActor = {
  email: "produccion@laboratoriogenus.com.ar",
  sector: "PRODUCCION",
  displayName: "Producción",
};
const elaboracion: OrdersActor = {
  email: "elaboracion@laboratoriogenus.com.ar",
  sector: "ELABORACION",
  displayName: "Elaboración",
};
const masivo: OrdersActor = {
  email: "emasivo@laboratoriogenus.com.ar",
  sector: "ENVASADO_MASIVO",
  displayName: "Masivo",
};

describe("plantillas maestras — empty state y RBAC", () => {
  it("sin plantillas aparece explicación clara", () => {
    expect(emptyTemplatesExplanation()).toContain(
      "No hay plantillas maestras disponibles"
    );
    const v = validateCreateOrderForm("OA", {
      templateId: "",
      product: "",
      code: "",
      client: "",
      lot: "",
      assignedSector: "ENVASADO_MASIVO",
      templatesCount: 0,
      dbUnavailable: false,
    });
    expect(v.ok).toBe(false);
    expect(v.errors.template).toContain("No hay plantillas maestras disponibles");
    expect(v.disableReasons).toContain("Falta plantilla");
  });

  it("Calidad y Producción pueden crear/importar plantillas; otros no", () => {
    expect(canOrderAction("OE", "manage_templates", "CALIDAD")).toBe(true);
    expect(canOrderAction("OA", "manage_templates", "PRODUCCION")).toBe(true);
    expect(canOrderAction("OE", "manage_templates", "ELABORACION")).toBe(false);
    expect(canOrderAction("OA", "manage_templates", "ENVASADO_MASIVO")).toBe(false);
    expect(canOrderAction("OA", "manage_templates", "ENVASADO_PREMIUM")).toBe(false);
    expect(canOrderAction("OE", "manage_templates", "MATERIA_PRIMA")).toBe(false);
  });

  it("sin DATABASE_URL: vista previa disponible, creación bloqueada con causa", () => {
    const builtin = listBuiltinTemplates("OA");
    expect(builtin.length).toBeGreaterThan(0);
    const v = validateCreateOrderForm("OA", {
      templateId: builtin[0]!.id,
      product: "CREMA FACIAL",
      code: "HIDRATANTE",
      client: "LAUDE",
      lot: "J1",
      assignedSector: "ENVASADO_MASIVO",
      templatesCount: builtin.length,
      dbUnavailable: true,
    });
    expect(v.ok).toBe(false);
    expect(v.errors.database).toContain("base de datos no está configurada");
    expect(v.disableReasons).toContain("Falta base de datos");
  });

  it("modal explica faltantes de campos", () => {
    const v = validateCreateOrderForm("OE", {
      templateId: SEED_OE_SERUM_TEMPLATE_ID,
      product: "",
      code: "",
      client: "",
      lot: "",
      assignedSector: "ELABORACION",
      templatesCount: 1,
      dbUnavailable: false,
    });
    expect(v.disableReasons).toEqual(
      expect.arrayContaining([
        "Falta producto",
        "Falta código",
        "Falta cliente",
        "Falta lote",
      ])
    );
  });
});

describe("seed idempotente y creación con snapshot", () => {
  let service: OrdersService;
  let repo: MemoryOrdersRepository;

  beforeEach(() => {
    repo = new MemoryOrdersRepository(false);
    service = new OrdersService(repo);
  });

  it("con base (memoria) el seed carga OE y OA sin duplicar", async () => {
    await service.importSeedTemplates(calidad);
    const oe = await service.listTemplates("OE");
    const oa = await service.listTemplates("OA");
    expect(oe).toHaveLength(1);
    expect(oa).toHaveLength(1);
    expect(oe[0]!.id).toBe(SEED_OE_SERUM_TEMPLATE_ID);
    expect(oa[0]!.id).toBe(SEED_OA_LAUDE_TEMPLATE_ID);
    expect(oe[0]!.status).toBe("VIGENTE");
    expect(oe[0]!.version).toBe(1);
    expect(oe[0]!.sourceFile).toContain("SERUM");
    expect(oa[0]!.sourceFile).toContain("LAUDE");

    await service.importSeedTemplates(produccion);
    expect(await service.listTemplates("OE")).toHaveLength(1);
    expect(await service.listTemplates("OA")).toHaveLength(1);
    expect(repo.templates.size).toBe(2);
  });

  it("UUIDs de seed son válidos", () => {
    const uuidRe =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    for (const t of seedTemplateRecords()) {
      expect(t.id).toMatch(uuidRe);
    }
  });

  it("la plantilla aparece en el selector y habilita Crear orden", async () => {
    await service.importSeedTemplates(calidad, "OA");
    const templates = await service.listTemplates("OA");
    expect(templates[0]!.productName).toBe("CREMA FACIAL");
    const v = validateCreateOrderForm("OA", {
      templateId: templates[0]!.id,
      product: templates[0]!.productName,
      code: templates[0]!.productCode,
      client: templates[0]!.brandClient ?? "LAUDE",
      lot: "J26099",
      assignedSector: "ENVASADO_MASIVO",
      templatesCount: templates.length,
      dbUnavailable: false,
    });
    expect(v.ok).toBe(true);
  });

  it("crear orden genera snapshot y no modifica la plantilla maestra", async () => {
    await service.importSeedTemplates(calidad);
    const t = (await service.listTemplates("OE"))[0]!;
    const before = structuredClone(t.content);
    const order = await service.createOrder(
      {
        type: "OE",
        templateId: t.id,
        assignedSector: "ELABORACION",
        product: "SERUM FACIAL ANTIAGE",
        code: "PT-SERUM-ANTIAGE",
        client: "CLIENTE ORDEN",
        lot: "L-ORDEN-1",
      },
      calidad
    );
    expect(order.templateSnapshot).toEqual(before);
    expect(order.formData.kind).toBe("OE");
    if (order.formData.kind === "OE") {
      expect(order.formData.header.client).toBe("CLIENTE ORDEN");
      expect(order.formData.header.lot).toBe("L-ORDEN-1");
    }
    const master = await service.getTemplate(t.id);
    expect(master.content).toEqual(before);
    if (master.content.kind === "OE") {
      expect(master.content.header.client).toBe("");
      expect(master.content.header.lot).toBe("");
    }
  });

  it("datos variables no viven como obligatorios en la plantilla", () => {
    const oe = seedTemplateRecords().find((t) => t.productId === SERUM_ANTIAGE_PRODUCT_ID)!;
    const oa = seedTemplateRecords().find(
      (t) => t.productId === CREMA_FACIAL_LAUDE_PRODUCT_ID
    )!;
    expect(oe.content.kind).toBe("OE");
    if (oe.content.kind === "OE") {
      expect(oe.content.header.lot).toBe("");
      expect(oe.content.header.date).toBe("");
      expect(oe.content.header.quantityKg).toBeNull();
      expect(oe.content.header.client).toBe("");
      expect(oe.content.materials.length).toBeGreaterThan(0);
      expect(oe.content.procedureSteps.length).toBeGreaterThan(0);
    }
    expect(oa.content.kind).toBe("OA");
    if (oa.content.kind === "OA") {
      expect(oa.content.header.lot).toBe("");
      expect(oa.content.header.client).toBe("");
      expect(oa.content.header.vto).toBe("");
      expect(oa.content.materials.some((m) => m.nombreInsumo)).toBe(true);
    }
    expect(oe.brandClient).toBe("THELMA Y LOUISE");
    expect(oa.brandClient).toBe("LAUDE");
  });

  it("Elaboración no puede importar plantillas", async () => {
    await expect(service.importSeedTemplates(elaboracion, "OE")).rejects.toMatchObject({
      code: "ORDERS_FORBIDDEN",
    });
  });

  it("Masivo no puede crear plantillas", async () => {
    await expect(
      service.createTemplate(
        { type: "OA", productName: "X", productCode: "Y" },
        masivo
      )
    ).rejects.toMatchObject({ code: "ORDERS_FORBIDDEN" });
  });

  it("Calidad puede crear plantilla manual sin archivo", async () => {
    const t = await service.createTemplate(
      {
        type: "OE",
        productName: "GEL LIMPIADOR",
        productCode: "PT-GEL-01",
        brandClient: "DEMO",
      },
      calidad
    );
    expect(t.version).toBe(1);
    expect(t.status).toBe("VIGENTE");
    expect(t.changeReason).toContain("sin archivo");
  });
});
