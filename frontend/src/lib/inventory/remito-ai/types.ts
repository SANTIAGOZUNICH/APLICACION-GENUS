/** Tipos de la carga asistida de ingresos ME desde remito (IA propone, humano confirma). */

export type RemitoUnidad = "UN" | "CAJA" | "BULTO" | "KG" | "OTRO";

export type RemitoConfianza = "ALTA" | "MEDIA" | "BAJA" | "SIN_COINCIDENCIA";

export type RemitoMatchSource = "ALIAS" | "CODIGO" | "DESCRIPCION" | "NINGUNO";

/** Salida estricta (ya validada server-side) de la interpretación del documento. */
export type RemitoExtractionItem = {
  descripcionOriginal: string;
  codigoProveedor: string;
  /** Cantidad exactamente como está impresa ("1.000", "2,5"). El número se deriva server-side. */
  cantidadTexto: string;
  unidadOriginal: string;
  unidad: RemitoUnidad | null;
};

export type RemitoExtraction = {
  esRemito: boolean;
  legible: boolean;
  motivo: string;
  proveedor: string;
  numeroRemito: string;
  /** ISO yyyy-mm-dd o null si no se pudo leer. */
  fecha: string | null;
  items: RemitoExtractionItem[];
};

export type RemitoCandidate = {
  materialId: string;
  codigo: string;
  descripcion: string;
  score: number;
};

export type MeRemitoLine = {
  id: string;
  descripcionOriginal: string;
  codigoProveedor: string;
  cantidadTexto: string;
  cantidadInterpretada: number | null;
  unidad: RemitoUnidad | null;
  unidadOriginal: string;
  /** Unidad ≠ UN sin equivalencia conocida: el operario debe ingresar las unidades. */
  requiereConversion: boolean;
  materialSugeridoId: string | null;
  confianza: RemitoConfianza;
  matchSource: RemitoMatchSource;
  candidates: RemitoCandidate[];
  warnings: string[];
  /** La cantidad leída merece revisión (ilegible, igual a la capacidad del envase, etc.). */
  revisarCantidad: boolean;
  /** Línea repetida / no confiable: arranca excluida. */
  includeDefault: boolean;
};

export type MeRemitoFileRef = {
  storageKey: string;
  name: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
};

export type MeRemitoCorrection = {
  lineId: string;
  campo: "cantidad" | "material" | "excluida" | "proveedor" | "numeroRemito" | "fecha";
  interpretado: string | number | null;
  confirmado: string | number | null;
};

export type MeRemitoDoc = {
  id: string;
  status: "ANALIZADO" | "CONFIRMADO";
  proveedor: string;
  proveedorNorm: string;
  numeroRemito: string;
  /** Vacío = sin número legible (no se puede garantizar detección de duplicados). */
  numeroRemitoNorm: string;
  fecha: string | null;
  files: MeRemitoFileRef[];
  /** sha256 de los hashes ordenados de los archivos (detecta el mismo documento re-subido). */
  filesSha: string;
  lines: MeRemitoLine[];
  warnings: string[];
  ia: { provider: string; model: string };
  createdBy: string;
  createdAt: string;
  confirmedBy: string | null;
  confirmedAt: string | null;
  ingresoIds: string[];
  corrections: MeRemitoCorrection[];
  /** Lo que efectivamente se confirmó por línea (ISO 9001: interpretado vs confirmado). */
  confirmedLines: Array<{
    lineId: string;
    incluida: boolean;
    materialId: string | null;
    cantidad: number | null;
    ingresoId: string | null;
  }>;
};

export type MeRemitoAlias = {
  id: string;
  proveedorNorm: string;
  proveedorOriginal: string;
  descripcionNorm: string;
  descripcionOriginal: string;
  materialId: string;
  materialCodigo: string;
  confirmedBy: string;
  confirmedAt: string;
  timesConfirmed: number;
  history: Array<{ materialId: string; at: string; by: string }>;
};
