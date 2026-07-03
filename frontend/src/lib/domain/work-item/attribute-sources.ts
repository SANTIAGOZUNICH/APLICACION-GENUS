/** Fuente oficial por atributo — doc 30 v3. Sin prioridad global entre Sheets. */

export const ATTRIBUTE_SOURCES = [
  "pedidos_2026",
  "semanas_2026",
  "asignacion_lotes_2026",
  "dashboard_pedidos",
] as const;

export type AttributeSource = (typeof ATTRIBUTE_SOURCES)[number];

/** Campo de dominio → fuente oficial que lo define. */
export const OFFICIAL_ATTRIBUTE_SOURCE: Record<string, AttributeSource> = {
  op: "pedidos_2026",
  pedidoRef: "pedidos_2026",
  client: "pedidos_2026",
  product: "pedidos_2026",
  quantity: "pedidos_2026",
  estado: "pedidos_2026",
  responsable: "pedidos_2026",
  sectorComercial: "pedidos_2026",

  dayLabel: "semanas_2026",
  weekLabel: "semanas_2026",
  date: "semanas_2026",
  sector: "semanas_2026",
  ownerSector: "semanas_2026",
  line: "semanas_2026",
  branchOwner: "semanas_2026",
  sectorLead: "semanas_2026",
  plannedClient: "semanas_2026",
  plannedProduct: "semanas_2026",
  plannedQuantity: "semanas_2026",
  notes: "semanas_2026",

  loteRef: "asignacion_lotes_2026",
  oeRef: "asignacion_lotes_2026",
  oaRef: "asignacion_lotes_2026",
  rl: "asignacion_lotes_2026",
  estadoCalidad: "asignacion_lotes_2026",
  fechaAnalisis: "asignacion_lotes_2026",
  numeroAnalisis: "asignacion_lotes_2026",
  observacionCalidad: "asignacion_lotes_2026",
};

/** Orden de matching entre WorkItems — no implica prioridad de datos. */
export const MATCH_KEY_PRIORITY = ["op", "loteRef", "internalId", "clientProduct"] as const;

export type MatchKey = (typeof MATCH_KEY_PRIORITY)[number];
