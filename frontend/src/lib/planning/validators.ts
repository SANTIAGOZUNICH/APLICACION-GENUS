import {
  addDaysIso,
  parseIsoDate,
  weekStartMonday,
} from "@/lib/operational/operational-calendar";
import type {
  CreateWorkItemInput,
  PatchWorkItemInput,
  PlanningSector,
} from "@/lib/planning/types";
import { PlanningValidationError } from "@/lib/planning/types";

const BRANCH_OWNERS = new Set(["Cristian", "Nicolás"]);
const MASIVO_LINES = new Set(["Línea 1", "Línea 2", "Línea 3", "Línea 4"]);
const PREMIUM_LINES = new Set(["Línea 1", "Línea 2"]);

export function assertIsoDate(value: string, field: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !parseIsoDate(value)) {
    throw new PlanningValidationError(`${field} debe ser YYYY-MM-DD.`);
  }
  return value;
}

export function assertWeekStartMonday(weekStart: string): string {
  const iso = assertIsoDate(weekStart, "weekStart");
  const monday = weekStartMonday(iso);
  if (monday !== iso) {
    throw new PlanningValidationError(
      `weekStart debe ser lunes (recibido ${iso}; lunes esperado ${monday}).`
    );
  }
  return iso;
}

export function assertPlannedDateInWeek(
  plannedDate: string,
  weekStart: string
): void {
  const date = assertIsoDate(plannedDate, "plannedDate");
  const start = assertWeekStartMonday(weekStart);
  const endExclusive = addDaysIso(start, 5); // viernes inclusive → +5 exclusive Saturday
  if (date < start || date >= endExclusive) {
    throw new PlanningValidationError(
      `plannedDate ${date} debe estar entre ${start} y ${addDaysIso(start, 4)} (lun–vie).`
    );
  }
}

export function normalizeLine(line: string | null | undefined): string | null {
  if (line == null || line.trim() === "") return null;
  const raw = line.trim();
  const short = raw.match(/^l(?:inea)?\s*(\d+)$/i);
  if (short) return `Línea ${short[1]}`;
  if (/^línea\s*\d+$/i.test(raw) || /^linea\s*\d+$/i.test(raw)) {
    const n = raw.match(/(\d+)/)?.[1];
    return n ? `Línea ${n}` : raw;
  }
  return raw;
}

export function normalizeBranchOwner(
  value: string | null | undefined
): string | null {
  if (value == null || value.trim() === "") return null;
  const key = value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (key === "cristian") return "Cristian";
  if (key === "nicolas") return "Nicolás";
  return value.trim();
}

export function assertSectorAssignment(
  sector: PlanningSector,
  line: string | null,
  branchOwner: string | null
): { line: string | null; branchOwner: string | null } {
  if (sector === "ELABORACION") {
    if (line) {
      throw new PlanningValidationError(
        "line no aplica a Elaboración (usar branchOwner Cristian/Nicolás)."
      );
    }
    if (!branchOwner || !BRANCH_OWNERS.has(branchOwner)) {
      throw new PlanningValidationError(
        "Elaboración requiere branchOwner Cristian o Nicolás."
      );
    }
    return { line: null, branchOwner };
  }

  if (sector === "ENVASADO_MASIVO") {
    if (branchOwner) {
      throw new PlanningValidationError(
        "branchOwner no aplica a Envasado Masivo (usar line)."
      );
    }
    if (!line || !MASIVO_LINES.has(line)) {
      throw new PlanningValidationError(
        "Envasado Masivo requiere line Línea 1–4."
      );
    }
    return { line, branchOwner: null };
  }

  if (sector === "ENVASADO_PREMIUM") {
    if (branchOwner) {
      throw new PlanningValidationError(
        "branchOwner no aplica a Envasado Premium (usar line)."
      );
    }
    if (!line || !PREMIUM_LINES.has(line)) {
      throw new PlanningValidationError(
        "Envasado Premium requiere line Línea 1–2."
      );
    }
    return { line, branchOwner: null };
  }

  throw new PlanningValidationError(`Sector inválido: ${sector}`);
}

export function validateCreateWorkItem(
  input: CreateWorkItemInput,
  weekStart: string
): CreateWorkItemInput & { line: string | null; branchOwner: string | null } {
  if (!input.client?.trim() || !input.product?.trim() || !input.plannedQuantity?.trim()) {
    throw new PlanningValidationError(
      "client, product y plannedQuantity son obligatorios."
    );
  }
  assertPlannedDateInWeek(input.plannedDate, weekStart);
  const line = normalizeLine(input.line);
  const branchOwner = normalizeBranchOwner(input.branchOwner);
  const assignment = assertSectorAssignment(input.sector, line, branchOwner);
  return {
    ...input,
    client: input.client.trim(),
    product: input.product.trim(),
    plannedQuantity: input.plannedQuantity.trim(),
    unit: (input.unit ?? "KG").trim() || "KG",
    notes: input.notes?.trim() || null,
    priority: input.priority ?? "NORMAL",
    ...assignment,
  };
}

export function validatePatchWorkItem(
  patch: PatchWorkItemInput,
  weekStart: string,
  current: {
    plannedDate: string;
    sector: PlanningSector;
    line: string | null;
    branchOwner: string | null;
  }
): Partial<CreateWorkItemInput> & { version: number } {
  if (!Number.isInteger(patch.version) || patch.version < 1) {
    throw new PlanningValidationError("version es obligatoria y debe ser >= 1.");
  }

  const nextDate = patch.plannedDate ?? current.plannedDate;
  const nextSector = patch.sector ?? current.sector;
  const nextLine =
    patch.line !== undefined ? normalizeLine(patch.line) : current.line;
  const nextBranch =
    patch.branchOwner !== undefined
      ? normalizeBranchOwner(patch.branchOwner)
      : current.branchOwner;

  assertPlannedDateInWeek(nextDate, weekStart);
  const assignment = assertSectorAssignment(nextSector, nextLine, nextBranch);

  return {
    version: patch.version,
    plannedDate: patch.plannedDate,
    client: patch.client?.trim(),
    product: patch.product?.trim(),
    plannedQuantity: patch.plannedQuantity?.trim(),
    unit: patch.unit?.trim(),
    sector: patch.sector,
    priority: patch.priority,
    notes: patch.notes === undefined ? undefined : patch.notes?.trim() || null,
    ...assignment,
  };
}
