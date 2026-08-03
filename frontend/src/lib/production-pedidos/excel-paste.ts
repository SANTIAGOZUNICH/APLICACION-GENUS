import {
  coercePedidoFields,
  type ProductionPedidoInput,
  type ProductionPedidoStatus,
} from "./types";

export type PastePreviewRow = {
  rowIndex: number;
  input: ProductionPedidoInput;
  op: string | null;
  fecha: string | null;
  nroOc: string | null;
  cliente: string | null;
  producto: string | null;
  s: string | null;
  q: number | null;
  ml: number | null;
  kg: number | null;
  estado: ProductionPedidoStatus | null;
  errors: string[];
  warnings: string[];
  valid: boolean;
};

const HEADER_ALIASES: Record<string, keyof ProductionPedidoInput | "kgIgnored"> = {
  op: "op",
  fecha: "fecha",
  "n.º oc": "nroOc",
  "n° oc": "nroOc",
  "nº oc": "nroOc",
  "nro oc": "nroOc",
  "nro. oc": "nroOc",
  "numero oc": "nroOc",
  "número oc": "nroOc",
  oc: "nroOc",
  cliente: "cliente",
  producto: "producto",
  s: "s",
  q: "q",
  ml: "ml",
  kg: "kgIgnored",
  estado: "estado",
};

function normHeader(cell: string): string {
  return cell
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ");
}

function splitRows(text: string): string[] {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((r) => r.replace(/\t+$/, ""))
    .filter((r) => r.trim().length > 0);
}

function splitCols(line: string): string[] {
  // Prefer tabs (Excel). Fallback to semicolon.
  if (line.includes("\t")) return line.split("\t").map((c) => c.trim());
  if (line.includes(";")) return line.split(";").map((c) => c.trim());
  return line.split("\t").map((c) => c.trim());
}

function detectHeader(cols: string[]): Array<keyof ProductionPedidoInput | "kgIgnored" | null> | null {
  const mapped = cols.map((c) => HEADER_ALIASES[normHeader(c)] ?? null);
  const hits = mapped.filter((m) => m && m !== "kgIgnored").length;
  if (hits >= 3) return mapped;
  return null;
}

const DEFAULT_ORDER: Array<keyof ProductionPedidoInput> = [
  "op",
  "fecha",
  "nroOc",
  "cliente",
  "producto",
  "s",
  "q",
  "ml",
  "estado",
];

function rowToInput(
  cols: string[],
  mapping: Array<keyof ProductionPedidoInput | "kgIgnored" | null> | null
): ProductionPedidoInput {
  const input: ProductionPedidoInput = {};
  if (mapping) {
    mapping.forEach((key, i) => {
      if (!key || key === "kgIgnored") return;
      input[key] = cols[i] ?? "";
    });
    return input;
  }
  // Sin encabezado: OP FECHA N.ºOC CLIENTE PRODUCTO S Q ML ESTADO
  DEFAULT_ORDER.forEach((key, i) => {
    input[key] = cols[i] ?? "";
  });
  return input;
}

function duplicateKey(r: {
  op: string | null;
  nroOc: string | null;
  cliente: string | null;
  producto: string | null;
  fecha: string | null;
}): string {
  return [r.op ?? "", r.nroOc ?? "", r.cliente ?? "", r.producto ?? "", r.fecha ?? ""]
    .join("|")
    .toLowerCase();
}

/**
 * Parsea clipboard Excel → filas de preview (no persiste).
 * KG de Excel se ignora y se recalcula.
 */
export function parseExcelPaste(
  text: string,
  existingKeys: string[] = []
): { rows: PastePreviewRow[]; headerDetected: boolean } {
  const lines = splitRows(text);
  if (!lines.length) return { rows: [], headerDetected: false };

  const firstCols = splitCols(lines[0]!);
  const headerMap = detectHeader(firstCols);
  const dataLines = headerMap ? lines.slice(1) : lines;
  const existing = new Set(existingKeys.map((k) => k.toLowerCase()));
  const seen = new Map<string, number>();

  const rows: PastePreviewRow[] = dataLines.map((line, idx) => {
    const cols = splitCols(line);
    const input = rowToInput(cols, headerMap);
    const coerced = coercePedidoFields(input);
    const warnings: string[] = [];
    const key = duplicateKey(coerced);
    const empty =
      !coerced.op &&
      !coerced.fecha &&
      !coerced.nroOc &&
      !coerced.cliente &&
      !coerced.producto &&
      !coerced.s &&
      coerced.q == null &&
      coerced.ml == null &&
      !coerced.estado;
    if (empty) coerced.errors.push("Fila vacía");
    if (seen.has(key) && key !== "||||") {
      warnings.push(`Posible duplicado interno (fila ${seen.get(key)! + 1})`);
    } else {
      seen.set(key, idx);
    }
    if (existing.has(key) && key !== "||||") {
      warnings.push("Posible duplicado con un pedido ya guardado");
    }
    return {
      rowIndex: idx + 1,
      input,
      op: coerced.op,
      fecha: coerced.fecha,
      nroOc: coerced.nroOc,
      cliente: coerced.cliente,
      producto: coerced.producto,
      s: coerced.s,
      q: coerced.q,
      ml: coerced.ml,
      kg: coerced.kg,
      estado: coerced.estado,
      errors: coerced.errors,
      warnings,
      valid: coerced.errors.length === 0,
    };
  });

  return { rows, headerDetected: Boolean(headerMap) };
}

export function duplicateKeyFromRecord(r: {
  op: string | null;
  nroOc: string | null;
  cliente: string | null;
  producto: string | null;
  fecha: string | null;
}): string {
  return duplicateKey(r);
}
