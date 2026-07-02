/**
 * Filas SEMANAS mínimas para tests — evitan falsos positivos de bloque ENTREGAS
 * cuando la columna header contiene "Entrega" (edge case documentado en tests).
 */
export const TEST_ELABORACION_ROWS: string[][] = [
  ["ELABORACIÓN"],
  ["CRISTIAN"],
  ["Cliente", "Producto", "Kg", "Plazo", "OE", "Observaciones"],
  ["Icono", "Serum Niacinamida", "120", "Hoy", "OE-101", ""],
  ["Bahia", "Crema Vitamina C", "80", "Mañana", "OE-102", "Urgente"],
  ["Thelma", "Shampoo Aloe", "200", "Viernes", "", "Verificar MP"],
  ["NICOLÁS"],
  ["Cliente", "Producto", "Kg", "Plazo", "OE"],
  ["Natura", "After Shave", "90", "Hoy", "OE-201"],
  ["Lab Premium", "Body Splash", "60", "Jueves", "OE-202"],
];

export const TEST_ENVASADO_ROWS: string[][] = [
  ["ACONDICIONAMIENTO MASIVO"],
  ["LÍNEA 1"],
  ["Cliente", "Producto", "Cantidad", "Plazo", "OA"],
  ["Thelma", "Exfoliante Arroz", "3300", "Hoy", "OA-301"],
  ["LÍNEA 2"],
  ["Bahia", "Tratamiento Straight", "1500", "Mañana", ""],
  ["LÍNEA 3"],
  [],
  ["ACONDICIONAMIENTO PREMIUM"],
  ["PREMIUM A"],
  ["Cliente", "Producto", "Cantidad", "Plazo", "OA"],
  ["Natura", "Serum Vitamina C", "500", "Hoy", "OA-P-01"],
  ["PREMIUM B"],
  ["Lab Premium", "Aceite Facial", "200", "Viernes", "OA-P-02"],
];

/** Fixture original con columna "Entrega" — reproduce edge case de segmentación. */
export const TEST_ELABORACION_ENTREGA_HEADER_ROWS: string[][] = [
  ["ELABORACIÓN"],
  ["CRISTIAN"],
  ["Cliente", "Producto", "Kg", "Entrega", "OE"],
  ["Icono", "Serum Niacinamida", "120", "Hoy", "OE-101"],
];
