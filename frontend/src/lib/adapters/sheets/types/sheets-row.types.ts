/** Normalized row shapes after header mapping from Google Sheets tabs. */

export interface LoteRow {
  loteId: string;
  tipoItem: string;
  itemId: string;
  nroLote: string;
  proveedor: string;
  fechaRecepcion: string;
  fechaVencimiento: string;
  estado: string;
  coaLink: string;
}

export interface SaldoRow {
  loteId: string;
  itemId: string;
  tipoItem: string;
  descripcion: string;
  cantidadActual: string;
  unidad: string;
  estadoLote: string;
  fechaVencimiento: string;
}

export interface MovimientoRow {
  movId: string;
  fechaHora: string;
  tipoItem: string;
  itemId: string;
  loteId: string;
  tipoMovimiento: string;
  cantidad: string;
  unidad: string;
  cantidadSigno: string;
  motivo: string;
  usuario: string;
  referenciaTipo: string;
  referenciaId: string;
}

export interface LoteSheetData {
  lote: LoteRow;
  saldo: SaldoRow | null;
  movimientos: MovimientoRow[];
}
