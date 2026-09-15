import { applyRelationalBoost, classifyCell } from "./cell-classifier";
import { parseVtoCandidate } from "./normalize";
import type {
  SmartPasteFieldAssignment,
  SmartPasteFieldCandidate,
  SmartPasteFieldKey,
  SmartPasteMasterData,
  SmartPasteRow,
  SmartPasteRowIssue,
} from "./types";

/** Nunca se asigna un campo con score por debajo de este piso — mejor "no identificado" que inventar. */
const MIN_ASSIGN_SCORE = 0.3;
/** Score y margen mínimos para considerar una asignación "alta" sin ambigüedad. */
const HIGH_CONFIDENCE_SCORE = 0.8;
const HIGH_CONFIDENCE_MARGIN = 0.2;
/** Si otra celda compite por el mismo campo dentro de este margen, es ambiguo aunque el score sea alto. */
const FIELD_COMPETITION_MARGIN = 0.15;

/** Patrón laxo de "esto parece un intento de fecha" — para distinguir VTO inválido de "no es una fecha". */
const DATE_ATTEMPT_PATTERN = /^\d{1,4}[/.-]\d{1,4}([/.-]\d{2,4})?$/;

interface CellCandidates {
  columnIndex: number;
  raw: string;
  candidates: SmartPasteFieldCandidate[];
}

/**
 * Resuelve UNA fila de celdas crudas en un objeto por campo — sin asumir
 * ningún orden de columnas. Cada celda se clasifica de forma independiente
 * (classifyCell) y después se resuelve la asignación completa buscando la
 * combinación más coherente (greedy por score, sin doble-reclamo de celda
 * ni de campo). Ver el módulo para el detalle de scoring.
 */
export function resolveRow(
  rowIndex: number,
  cells: string[],
  master: SmartPasteMasterData
): SmartPasteRow {
  const perCell: CellCandidates[] = cells.map((raw, columnIndex) => ({
    columnIndex,
    raw,
    candidates: classifyCell(raw, master),
  }));

  applyRowRelationalBoost(perCell, master);

  const assignments: Partial<Record<SmartPasteFieldKey, SmartPasteFieldAssignment>> = {};
  const claimedCells = new Set<number>();
  const claimedFields = new Set<SmartPasteFieldKey>();

  type Triple = { columnIndex: number; candidate: SmartPasteFieldCandidate };
  const triples: Triple[] = [];
  for (const cell of perCell) {
    for (const candidate of cell.candidates) {
      if (candidate.score >= MIN_ASSIGN_SCORE) triples.push({ columnIndex: cell.columnIndex, candidate });
    }
  }
  triples.sort((a, b) => b.candidate.score - a.candidate.score);

  for (const { columnIndex, candidate } of triples) {
    if (claimedCells.has(columnIndex) || claimedFields.has(candidate.field)) continue;
    const cell = perCell[columnIndex]!;
    const confidence = computeConfidence(cell, candidate, perCell);
    assignments[candidate.field] = {
      field: candidate.field,
      value: candidate.normalizedValue ?? cell.raw.trim(),
      raw: cell.raw,
      columnIndex,
      confidence,
      reason: candidate.reason,
      alternativeFields: alternativeFieldsFor(cell, candidate.field),
    };
    claimedCells.add(columnIndex);
    claimedFields.add(candidate.field);
  }

  const unassignedCells = perCell
    .filter((c) => !claimedCells.has(c.columnIndex) && c.raw.trim() !== "")
    .map((c) => ({ raw: c.raw, columnIndex: c.columnIndex }));

  const issues = buildIssues(perCell, assignments, claimedCells);
  const status = deriveStatus(assignments, issues);

  return { rowIndex, assignments, unassignedCells, status, issues };
}

function applyRowRelationalBoost(perCell: CellCandidates[], master: SmartPasteMasterData): void {
  const clienteCell = bestCandidateCell(perCell, "cliente");
  const productoCell = bestCandidateCell(perCell, "producto");
  if (!clienteCell || !productoCell || clienteCell === productoCell) return;
  const clienteCand = clienteCell.candidates.find((c) => c.field === "cliente")!;
  const productoCand = productoCell.candidates.find((c) => c.field === "producto")!;
  const boosted = applyRelationalBoost(clienteCand, productoCand, master);
  replaceCandidate(clienteCell, "cliente", boosted.cliente);
  replaceCandidate(productoCell, "producto", boosted.producto);
}

function bestCandidateCell(perCell: CellCandidates[], field: SmartPasteFieldKey): CellCandidates | null {
  let best: CellCandidates | null = null;
  let bestScore = -1;
  for (const cell of perCell) {
    const cand = cell.candidates.find((c) => c.field === field);
    if (cand && cand.score > bestScore) {
      best = cell;
      bestScore = cand.score;
    }
  }
  return best;
}

function replaceCandidate(cell: CellCandidates, field: SmartPasteFieldKey, next: SmartPasteFieldCandidate): void {
  cell.candidates = cell.candidates.map((c) => (c.field === field ? next : c));
  cell.candidates.sort((a, b) => b.score - a.score);
}

function computeConfidence(
  cell: CellCandidates,
  assigned: SmartPasteFieldCandidate,
  allCells: CellCandidates[]
): "alta" | "media" | "baja" {
  const runnerUp = cell.candidates.find((c) => c.field !== assigned.field);
  const margin = assigned.score - (runnerUp?.score ?? 0);
  const competingCell = allCells.some(
    (other) =>
      other.columnIndex !== cell.columnIndex &&
      other.candidates.some(
        (c) => c.field === assigned.field && assigned.score - c.score < FIELD_COMPETITION_MARGIN
      )
  );
  if (assigned.score >= HIGH_CONFIDENCE_SCORE && margin >= HIGH_CONFIDENCE_MARGIN && !competingCell) {
    return "alta";
  }
  if (assigned.score >= MIN_ASSIGN_SCORE) return "media";
  return "baja";
}

function alternativeFieldsFor(cell: CellCandidates, assignedField: SmartPasteFieldKey): SmartPasteFieldKey[] | undefined {
  const alts = cell.candidates.filter((c) => c.field !== assignedField && c.score >= 0.15).map((c) => c.field);
  return alts.length > 0 ? alts : undefined;
}

function buildIssues(
  perCell: CellCandidates[],
  assignments: Partial<Record<SmartPasteFieldKey, SmartPasteFieldAssignment>>,
  claimedCells: Set<number>
): SmartPasteRowIssue[] {
  const issues: SmartPasteRowIssue[] = [];

  for (const cell of perCell) {
    if (claimedCells.has(cell.columnIndex)) continue;
    const raw = cell.raw.trim();
    if (!raw) continue;
    if (DATE_ATTEMPT_PATTERN.test(raw) && !parseVtoCandidate(raw)) {
      issues.push({ field: "vto", message: `"${raw}" parece una fecha pero no es un VTO válido.`, severity: "error" });
      continue;
    }
    issues.push({
      message: `No pudimos determinar qué representa "${raw}".`,
      severity: "warning",
    });
  }

  const cantidad = assignments.cantidad;
  if (cantidad) {
    const numeric = Number.parseFloat(cantidad.value);
    if (!Number.isFinite(numeric) || numeric < 0) {
      issues.push({ field: "cantidad", message: "Cantidad inválida.", severity: "error" });
    }
  }

  for (const [field, assignment] of Object.entries(assignments) as Array<
    [SmartPasteFieldKey, SmartPasteFieldAssignment]
  >) {
    if (assignment.confidence === "media") {
      issues.push({
        field,
        message: `"${assignment.raw}" — interpretado como ${field.toUpperCase()}, revisar.`,
        severity: "warning",
      });
    }
  }

  return issues;
}

function deriveStatus(
  assignments: Partial<Record<SmartPasteFieldKey, SmartPasteFieldAssignment>>,
  issues: SmartPasteRowIssue[]
): "valido" | "revisar" | "error" {
  if (issues.some((i) => i.severity === "error")) return "error";
  if (issues.some((i) => i.severity === "warning")) return "revisar";
  if (Object.keys(assignments).length === 0) return "error";
  return "valido";
}
