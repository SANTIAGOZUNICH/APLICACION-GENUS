/**
 * Contrato estricto de la interpretación del remito + validación server-side.
 * La IA NUNCA entrega movimientos: solo este objeto, que se valida campo por campo.
 */
import { normalizeUnidad } from "./normalize";
import type { RemitoExtraction, RemitoExtractionItem } from "./types";

export class RemitoAiInvalidResponseError extends Error {
  status = 502;
  code = "REMITO_AI_INVALID_RESPONSE";
  constructor(message = "La interpretación del remito no tiene el formato esperado.") {
    super(message);
    this.name = "RemitoAiInvalidResponseError";
  }
}

export class RemitoUnreadableError extends Error {
  status = 422;
  code = "REMITO_ILEGIBLE";
  constructor(detail?: string) {
    super(
      `NO PUDIMOS LEER EL REMITO CON SEGURIDAD. Sacá otra foto procurando incluir el documento completo.${
        detail ? ` (${detail})` : ""
      }`
    );
    this.name = "RemitoUnreadableError";
  }
}

export const MAX_REMITO_ITEMS = 200;

/** JSON Schema entregado al modelo (structured output). */
export const REMITO_EXTRACTION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["esRemito", "legible", "motivo", "proveedor", "numeroRemito", "fecha", "items"],
  properties: {
    esRemito: { type: "boolean", description: "false si el documento no es un remito de entrega/ingreso." },
    legible: {
      type: "boolean",
      description: "false si está borroso, cortado, incompleto o de baja resolución.",
    },
    motivo: { type: "string", description: "Si esRemito/legible es false, por qué. Si no, cadena vacía." },
    proveedor: { type: "string", description: "Razón social del EMISOR del remito. Vacío si no se lee." },
    numeroRemito: {
      type: "string",
      description: "Número de remito tal como está impreso (ej. 0001-000123). Vacío si no se lee.",
    },
    fecha: {
      type: "string",
      description: "Fecha del remito en formato dd/mm/aaaa o aaaa-mm-dd. Vacío si no se lee.",
    },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["descripcionOriginal", "codigoProveedor", "cantidadTexto", "unidadOriginal"],
        properties: {
          descripcionOriginal: { type: "string", description: "Descripción tal cual figura en el remito." },
          codigoProveedor: { type: "string", description: "Código impreso de la línea. Vacío si no hay." },
          cantidadTexto: {
            type: "string",
            description:
              "CANTIDAD ENTREGADA exactamente como está impresa (ej. '1.000'). No es la capacidad del envase (30 ML).",
          },
          unidadOriginal: {
            type: "string",
            description: "Unidad impresa (UN, U, PCS, CAJAS, BULTOS, KG). Vacío si no figura.",
          },
        },
      },
    },
  },
} as const;

function str(v: unknown, max: number): string {
  if (v == null) return "";
  if (typeof v !== "string" && typeof v !== "number") {
    throw new RemitoAiInvalidResponseError();
  }
  return String(v).replace(/\s+/g, " ").trim().slice(0, max);
}

/** dd/mm/aaaa | dd-mm-aa | aaaa-mm-dd → ISO; null si inválida o fuera de rango razonable. */
export function parseRemitoDate(raw: string, now: Date = new Date()): string | null {
  const s = raw.trim();
  if (!s) return null;
  let y: number, m: number, d: number;
  let mt = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (mt) {
    y = Number(mt[1]);
    m = Number(mt[2]);
    d = Number(mt[3]);
  } else {
    mt = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
    if (!mt) return null;
    d = Number(mt[1]);
    m = Number(mt[2]);
    y = Number(mt[3]);
    if (y < 100) y += 2000;
  }
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  const max = new Date(now.getTime() + 2 * 86_400_000);
  if (dt > max || y < 2000) return null;
  return dt.toISOString().slice(0, 10);
}

export function validateRemitoExtraction(raw: unknown, now: Date = new Date()): RemitoExtraction {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new RemitoAiInvalidResponseError();
  const r = raw as Record<string, unknown>;
  if (typeof r.esRemito !== "boolean" || typeof r.legible !== "boolean" || !Array.isArray(r.items)) {
    throw new RemitoAiInvalidResponseError();
  }
  if (r.items.length > MAX_REMITO_ITEMS) throw new RemitoAiInvalidResponseError("El remito tiene demasiadas líneas.");

  const items: RemitoExtractionItem[] = r.items.map((it) => {
    if (!it || typeof it !== "object" || Array.isArray(it)) throw new RemitoAiInvalidResponseError();
    const o = it as Record<string, unknown>;
    const descripcionOriginal = str(o.descripcionOriginal, 300);
    const unidadOriginal = str(o.unidadOriginal, 30);
    return {
      descripcionOriginal,
      codigoProveedor: str(o.codigoProveedor, 60),
      cantidadTexto: str(o.cantidadTexto, 40),
      unidadOriginal,
      unidad: normalizeUnidad(unidadOriginal),
    };
  });

  const fechaRaw = str(r.fecha, 40);
  return {
    esRemito: r.esRemito,
    legible: r.legible,
    motivo: str(r.motivo, 300),
    proveedor: str(r.proveedor, 160),
    numeroRemito: str(r.numeroRemito, 60),
    fecha: parseRemitoDate(fechaRaw, now),
    items: items.filter((i) => i.descripcionOriginal.length > 0),
  };
}

/** Lanza RemitoUnreadableError si no es un remito o no se leyó con seguridad. */
export function assertReadable(ex: RemitoExtraction): void {
  if (!ex.esRemito) throw new RemitoUnreadableError("el archivo no parece un remito");
  if (!ex.legible) throw new RemitoUnreadableError(ex.motivo || "imagen poco legible");
  if (ex.items.length === 0) throw new RemitoUnreadableError("no se detectaron líneas de materiales");
}
