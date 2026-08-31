import type { AssignableSector } from "../components/assign-work-dialog";

/**
 * Auto-completar OA/OE desde el N° de Pedido seleccionado en "Asignar
 * trabajo" — Envasado Masivo/Premium/Codificado usan OA, Elaboración usa OE,
 * ambos con formato "{PREFIJO}-{AÑO}-{NÚMERO}" (ej. Pedido OP-4521 en
 * Envasado, año 2026 → "OA-2026-4521").
 *
 * `production_pedidos.op` es texto libre sin formato fijo — confirmado
 * revisando el schema (`op: text("op")`, sin CHECK ni regex), la
 * normalización existente (`normalizeTextKeepLeadingZeros` en
 * production-pedidos/types.ts, que solo trimea) y el import de Excel
 * (excel-paste.ts copia la celda tal cual). Puede llegar como "OP-4521",
 * "4521", "Pedido 4521", "0004521", etc. — nunca se asume un único formato.
 */
export function extractPedidoNumber(op: string | null | undefined): string | null {
  if (!op) return null;
  const matches = op.match(/\d+/g);
  if (!matches || matches.length === 0) return null;
  // Último grupo de dígitos: cubre "OP-4521" y "Pedido N° 4521" igual, y si
  // el propio N° de Pedido ya viene con año embebido (ej. "2026-4521") toma
  // el número de secuencia, no el año.
  return matches[matches.length - 1];
}

/**
 * Año para el OA/OE — SIEMPRE de la fecha de producción/asignación que el
 * usuario ve y controla en el formulario (plannedDate, "Desde"), nunca de
 * `new Date()` ni hardcodeado.
 */
function yearFromPlannedDate(plannedDate: string | null | undefined): string | null {
  const year = plannedDate?.slice(0, 4);
  return year && /^\d{4}$/.test(year) ? year : null;
}

/**
 * Construye el OA/OE autogenerado, o null si falta un dato real (nunca se
 * inventa un número ni un año).
 */
export function buildAutoOrderRef(
  sector: AssignableSector,
  pedidoOp: string | null | undefined,
  plannedDate: string | null | undefined
): string | null {
  const numero = extractPedidoNumber(pedidoOp);
  if (!numero) return null;
  const year = yearFromPlannedDate(plannedDate);
  if (!year) return null;
  const prefix = sector === "ELABORACION" ? "OE" : "OA";
  return `${prefix}-${year}-${numero}`;
}
