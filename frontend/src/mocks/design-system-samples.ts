/**
 * Mock samples for /design-system documentation — not production data.
 */

import { Status } from "@/types/ui/status";

export const sampleOECard = {
  oeId: "OE-2024-0142",
  productName: "Crema Hidratante Granel",
  status: Status.EN_CURSO,
  loteGranel: "LG-8842",
  batchSize: "500 kg",
  responsable: "María G.",
  progressPercent: 62,
  primaryAction: { label: "Continuar producción" },
} as const;

export const sampleOACard = {
  oaId: "OA-2024-0089",
  skuName: "Crema Hidratante 50 ml",
  status: Status.EN_CURSO,
  lotePt: "PT-4421",
  unidades: "12.000 u",
  responsable: "Carlos R.",
  progressPercent: 45,
  primaryAction: { label: "Registrar avance" },
} as const;

export const sampleLoteCard = {
  itemName: "Ácido Hialurónico",
  loteNumber: "MP-2024-331",
  status: Status.CUARENTENA,
  tipoItem: "Materia prima",
  saldo: "24 kg",
  vencimiento: "15/08/2026",
  vencimientoProximo: false,
  primaryAction: { label: "Ver trazabilidad" },
} as const;

export const sampleLiberacionCard = {
  loteNumber: "PT-4421",
  ordenRef: "OA-2024-0089",
  status: Status.CUARENTENA,
  evidencia: "Análisis microbiológico OK",
  diasCuarentena: 9,
  primaryAction: { label: "Disponer" },
} as const;

export const samplePedidoCard = {
  pedidoId: "PED-2024-1205",
  cliente: "Farmacia del Sol S.A.",
  status: Status.PARCIAL,
  compromiso: "05/07/2026",
  avanceDespacho: "3/5 renglones",
  compromisoPorVencer: true,
  primaryAction: { label: "Seguir despacho" },
} as const;

export const sampleTaskCard = {
  entityId: "TAREA-0042",
  title: "Registrar consumo de materia prima",
  status: Status.PENDIENTE,
  metadata: [
    { id: "oe", label: "Orden", value: "OE-2024-0142" },
    { id: "area", label: "Área", value: "Producción" },
  ],
  primaryAction: { label: "Registrar consumo" },
} as const;

export const sampleTableRows = [
  { id: "LG-8842", producto: "Crema Hidratante Granel", estado: Status.EN_CURSO, saldo: "320 kg" },
  { id: "MP-331", producto: "Ácido Hialurónico", estado: Status.CUARENTENA, saldo: "24 kg" },
  { id: "PT-4421", producto: "Crema 50 ml", estado: Status.LIBERADO, saldo: "8.400 u" },
] as const;

export const sampleChips = ["Producción", "Cuarentena", "Urgente"] as const;
