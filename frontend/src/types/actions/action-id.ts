/** Canonical action identifiers — vocabulary aligned with /docss/18-convenciones.md §7 */
export const ActionIds = {
  OE_REGISTRAR_CONSUMO: "oe.registrar-consumo",
  OE_REGISTRAR_CONTROL: "oe.registrar-control",
  OE_CERRAR: "oe.cerrar",
  OA_REGISTRAR_CONSUMO: "oa.registrar-consumo",
  OA_CERRAR: "oa.cerrar",
  LOTE_CARGAR_ANALISIS: "lote.cargar-analisis",
  LIBERACION_PREPARAR_DISPOSICION: "liberacion.preparar-disposicion",
  LIBERACION_FIRMAR: "liberacion.firmar",
  PEDIDO_DESPACHAR: "pedido.despachar",
} as const;

export type ActionId = (typeof ActionIds)[keyof typeof ActionIds];

export const RoleIds = {
  OP: "ROL-OP",
  SU: "ROL-SU",
  CA: "ROL-CA",
  DT: "ROL-DT",
  AD: "ROL-AD",
  DI: "ROL-DI",
} as const;

export type RoleId = (typeof RoleIds)[keyof typeof RoleIds];
