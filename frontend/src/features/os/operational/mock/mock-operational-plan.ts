import { createSectorWorkItem } from "@/lib/__fixtures__/work-item.factory";
import type { WorkItem } from "@/types/operational/work-item";
import type { SectorId } from "@/types/operational/sector";
import type { QualityItem, OperationalPlanSnapshot } from "../types";

const TODAY = "Hoy";

function mockElaboracionItems(): WorkItem[] {
  return [
    createSectorWorkItem("ELABORACION", "mock-el-1", {
      ownerPerson: "Cristian",
      client: "Icono",
      product: "Serum Niacinamida",
      quantity: "120",
      unit: "kg",
      dayLabel: TODAY,
      priority: "HOY",
      oeRef: "OE-101",
      loteRef: "L-2026-0891",
    }),
    createSectorWorkItem("ELABORACION", "mock-el-2", {
      ownerPerson: "Cristian",
      client: "Bahia Evans",
      product: "Crema Vitamina C",
      quantity: "80",
      unit: "kg",
      dayLabel: "Mañana",
      priority: "ESTA_SEMANA",
      oeRef: "OE-102",
    }),
    createSectorWorkItem("ELABORACION", "mock-el-3", {
      ownerPerson: "Nicolás",
      client: "Natura",
      product: "After Shave",
      quantity: "90",
      unit: "kg",
      dayLabel: TODAY,
      priority: "HOY",
      oeRef: "OE-201",
      loteRef: "L-2026-0892",
    }),
    createSectorWorkItem("ELABORACION", "mock-el-4", {
      ownerPerson: "Nicolás",
      client: "Lab Premium",
      product: "Body Splash",
      quantity: "60",
      unit: "kg",
      dayLabel: "Jueves",
      oeRef: "OE-202",
    }),
  ];
}

function mockEnvasadoMasivoItems(): WorkItem[] {
  return [
    createSectorWorkItem("ENVASADO_MASIVO", "mock-em-1", {
      line: "LÍNEA 1",
      client: "Thelma y Louise",
      product: "Exfoliante Arroz",
      quantity: "3300",
      unit: "u",
      dayLabel: TODAY,
      priority: "HOY",
      oaRef: null,
    }),
    createSectorWorkItem("ENVASADO_MASIVO", "mock-em-2", {
      line: "LÍNEA 2",
      client: "Bahia Evans",
      product: "Tratamiento Straight",
      quantity: "300",
      unit: "u",
      dayLabel: TODAY,
      priority: "URGENTE",
      oaRef: "OA-2026-2205",
      status: "en_curso",
    }),
    createSectorWorkItem("ENVASADO_MASIVO", "mock-em-3", {
      line: "LÍNEA 1",
      client: "Icono",
      product: "Crema Hidratante",
      quantity: "1200",
      unit: "u",
      dayLabel: "Miércoles",
      priority: "ESTA_SEMANA",
    }),
  ];
}

function mockEnvasadoPremiumItems(): WorkItem[] {
  return [
    createSectorWorkItem("ENVASADO_PREMIUM", "mock-ep-1", {
      line: "PREMIUM A",
      client: "Natura",
      product: "Serum Vitamina C",
      quantity: "500",
      unit: "u",
      dayLabel: TODAY,
      priority: "HOY",
      oaRef: "OA-P-1102",
      status: "en_curso",
    }),
    createSectorWorkItem("ENVASADO_PREMIUM", "mock-ep-2", {
      line: "PREMIUM B",
      client: "Lab Premium",
      product: "Aceite Facial",
      quantity: "200",
      unit: "u",
      dayLabel: "Jueves",
      oaRef: null,
    }),
  ];
}

export function mockQualityItems(): QualityItem[] {
  return [
    {
      id: "q-granel-1",
      kind: "granel",
      lote: "L-2026-0891",
      product: "Serum Niacinamida",
      client: "Icono",
      oe: "OE-101",
      oa: null,
      line: null,
      quantity: "120 kg",
      dayLabel: TODAY,
      status: "pendiente",
      relatedWorkItemId: "mock-el-1",
    },
    {
      id: "q-granel-2",
      kind: "granel",
      lote: "L-2026-0892",
      product: "After Shave",
      client: "Natura",
      oe: "OE-201",
      oa: null,
      line: null,
      quantity: "90 kg",
      dayLabel: TODAY,
      status: "pendiente",
      relatedWorkItemId: "mock-el-3",
    },
    {
      id: "q-salida-1",
      kind: "salida",
      lote: null,
      product: "Exfoliante Arroz",
      client: "Thelma y Louise",
      oe: "OE-0142",
      oa: "OA-301",
      line: "LÍNEA 1",
      quantity: "3300 u",
      dayLabel: TODAY,
      status: "pendiente",
      relatedWorkItemId: "mock-em-1",
    },
    {
      id: "q-salida-2",
      kind: "salida",
      lote: null,
      product: "Serum Vitamina C",
      client: "Natura",
      oe: "OE-P-01",
      oa: "OA-P-1102",
      line: "PREMIUM A",
      quantity: "500 u",
      dayLabel: TODAY,
      status: "pendiente",
      relatedWorkItemId: "mock-ep-1",
    },
    {
      id: "q-granel-3",
      kind: "granel",
      lote: "L-2026-0875",
      product: "Shampoo Reparador",
      client: "Natura",
      oe: "OE-0129",
      oa: "OA-2190",
      line: null,
      quantity: "200 kg",
      dayLabel: "Ayer",
      status: "aprobado",
      relatedWorkItemId: null,
    },
    {
      id: "q-salida-3",
      kind: "salida",
      lote: null,
      product: "Gel Limpiador",
      client: "Bahia Evans",
      oe: "OE-0120",
      oa: null,
      line: "LÍNEA 3",
      quantity: "800 u",
      dayLabel: TODAY,
      status: "rechazado",
      relatedWorkItemId: null,
    },
  ];
}

export function mockWorkItemsForSector(
  sector: SectorId,
  ownerPerson?: string | null
): WorkItem[] {
  let items: WorkItem[] = [];

  switch (sector) {
    case "ELABORACION":
      items = mockElaboracionItems();
      break;
    case "ENVASADO_MASIVO":
      items = mockEnvasadoMasivoItems();
      break;
    case "ENVASADO_PREMIUM":
      items = mockEnvasadoPremiumItems();
      break;
    case "PRODUCCION":
    case "CALIDAD":
      items = [
        ...mockElaboracionItems(),
        ...mockEnvasadoMasivoItems(),
        ...mockEnvasadoPremiumItems(),
      ];
      break;
    default:
      items = [];
  }

  if (ownerPerson?.trim()) {
    items = items.filter(
      (item) =>
        item.sector !== "ELABORACION" ||
        item.ownerPerson?.toLowerCase().includes(ownerPerson.trim().toLowerCase())
    );
  }

  return items;
}

export function buildMockOperationalSnapshot(
  sector: SectorId,
  ownerPerson?: string | null
): OperationalPlanSnapshot {
  return {
    sector,
    ownerPerson,
    source: "demo",
    scannedAt: new Date().toISOString(),
    workItems: mockWorkItemsForSector(sector, ownerPerson),
    qualityItems: mockQualityItems(),
    message:
      "Datos demo — configurá GENUS_DATA_MODE=real y Drive para SEMANAS 2026 en vivo.",
  };
}
