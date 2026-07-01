/** Maps raw Google Sheets header cells to normalized field keys. */
const HEADER_ALIASES: Record<string, string> = {
  lote_id: "loteId",
  tipo_item: "tipoItem",
  item_id: "itemId",
  nro_lote: "nroLote",
  proveedor: "proveedor",
  fecha_recepcion: "fechaRecepcion",
  fecha_vencimiento: "fechaVencimiento",
  estado: "estado",
  coa_link: "coaLink",
  mov_id: "movId",
  fecha_hora: "fechaHora",
  tipo_movimiento: "tipoMovimiento",
  cantidad: "cantidad",
  unidad: "unidad",
  cantidad_signo: "cantidadSigno",
  motivo: "motivo",
  usuario: "usuario",
  referencia_tipo: "referenciaTipo",
  referencia_id: "referenciaId",
  cantidad_actual: "cantidadActual",
  descripcion: "descripcion",
  estado_lote: "estadoLote",
};

function normalizeHeader(header: string): string {
  const key = header.trim().toLowerCase().replace(/\s+/g, "_");
  return HEADER_ALIASES[key] ?? key;
}

export function rowsToRecords(rows: string[][]): Record<string, string>[] {
  if (rows.length < 2) return [];

  const headers = rows[0].map(normalizeHeader);
  const records: Record<string, string>[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row.some((cell) => cell.trim())) continue;

    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      record[header] = row[index]?.trim() ?? "";
    });
    records.push(record);
  }

  return records;
}

export function pickField(
  record: Record<string, string>,
  ...keys: string[]
): string {
  for (const key of keys) {
    const value = record[key];
    if (value) return value;
  }
  return "";
}
