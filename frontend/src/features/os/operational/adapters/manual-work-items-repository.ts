/**
 * @mock-temp Trabajos asignados manualmente desde Producción — localStorage.
 * Se fusionan con los WorkItems reales (Sheets/native) al listar por sector;
 * no escribe a Sheets/Drive — capa de adapter aislada, lista para reemplazo por
 * escritura real cuando exista Action Pipeline con RBAC server-side.
 */

import type { SectorId } from "@/types/operational/sector";
import type { OriginStage, WorkItem, WorkItemPriority } from "@/types/operational/work-item";

const ORIGIN_STAGE_BY_SECTOR: Record<
  "ELABORACION" | "ENVASADO_MASIVO" | "ENVASADO_PREMIUM",
  OriginStage
> = {
  ELABORACION: "ELABORACION",
  ENVASADO_MASIVO: "ACONDICIONAMIENTO",
  ENVASADO_PREMIUM: "ACONDICIONAMIENTO",
};

const STORAGE_KEY = "genus_os_manual_work_items";

export interface CreateManualWorkItemInput {
  sector: Extract<SectorId, "ELABORACION" | "ENVASADO_MASIVO" | "ENVASADO_PREMIUM">;
  ownerPerson: string | null;
  line: string | null;
  client: string;
  product: string;
  plannedDate: string;
  /** Fecha de entrega operativa (ISO). Independiente de plannedDate. */
  deliveryDate: string;
  quantity: string;
  unit: string;
  /** Conservado por compatibilidad; la UI de asignación ya no lo expone. */
  priority?: WorkItemPriority | null;
  oeRef: string | null;
  oaRef: string | null;
  notes: string | null;
  assignedBy: string;
}

export interface ManualWorkItemMeta {
  assignedBy: string;
  assignedAt: string;
  reassignedBy?: string;
  reassignedAt?: string;
}

function readAll(): WorkItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as WorkItem[]) : [];
  } catch {
    return [];
  }
}

function writeAll(items: WorkItem[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

function readMeta(): Record<string, ManualWorkItemMeta> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(`${STORAGE_KEY}_meta`);
    return raw ? (JSON.parse(raw) as Record<string, ManualWorkItemMeta>) : {};
  } catch {
    return {};
  }
}

function writeMeta(meta: Record<string, ManualWorkItemMeta>): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(`${STORAGE_KEY}_meta`, JSON.stringify(meta));
}

export function listManualWorkItems(sector: SectorId): WorkItem[] {
  return readAll().filter((item) => item.sector === sector);
}

/**
 * Punto único de fusión: todo consumidor de WorkItems por sector (vistas operativas,
 * Control de MP, Panel de Producción, listados de OE/OA) debe pasar por acá para que
 * los trabajos creados en Asignar Trabajos aparezcan de forma consistente en todas
 * las pantallas — evita reimplementar el merge en cada vista.
 */
export function mergeManualWorkItems(sector: SectorId, items: WorkItem[]): WorkItem[] {
  return [...items, ...listManualWorkItems(sector)];
}

export function listAllManualWorkItems(): WorkItem[] {
  return [...readAll()];
}

export function getManualWorkItemMeta(id: string): ManualWorkItemMeta | null {
  return readMeta()[id] ?? null;
}

export function createManualWorkItem(input: CreateManualWorkItemInput): WorkItem {
  const id = `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const item: WorkItem = {
    id,
    sector: input.sector,
    ownerSector: input.sector,
    ownerPerson: input.ownerPerson,
    source: "semanas_2026",
    sourceFileId: "manual",
    sourceSheet: null,
    sourceRange: null,
    productSourceRange: null,
    quantitySourceRange: null,
    originStage: ORIGIN_STAGE_BY_SECTOR[input.sector],
    date: input.plannedDate,
    plannedDate: input.plannedDate,
    dayLabel: null,
    dayOfWeek: null,
    weekLabel: null,
    weekStart: null,
    weekId: null,
    client: input.client,
    product: input.product,
    quantity: input.quantity,
    unit: input.unit,
    line: input.line,
    deliveryDate: input.deliveryDate,
    status: "pendiente",
    priority: input.priority ?? "NORMAL",
    pedidoRef: null,
    oeRef: input.oeRef,
    oaRef: input.oaRef,
    loteRef: null,
    notes: input.notes,
    actionLabel: null,
    href: null,
    confidence: "high",
    createdFrom: "manual_assignment",
    generatedEntities: [],
    dependsOn: null,
    blockedBy: null,
    unblocks: null,
  };

  const items = [...readAll(), item];
  writeAll(items);

  const meta = readMeta();
  meta[id] = { assignedBy: input.assignedBy, assignedAt: new Date().toISOString() };
  writeMeta(meta);

  return item;
}

export function reassignManualWorkItem(
  id: string,
  patch: {
    plannedDate?: string;
    deliveryDate?: string;
    ownerPerson?: string | null;
    line?: string | null;
  },
  reassignedBy: string
): void {
  const items = readAll().map((item) =>
    item.id === id
      ? {
          ...item,
          plannedDate: patch.plannedDate ?? item.plannedDate,
          deliveryDate: patch.deliveryDate ?? item.deliveryDate,
          ownerPerson: patch.ownerPerson !== undefined ? patch.ownerPerson : item.ownerPerson,
          line: patch.line !== undefined ? patch.line : item.line,
        }
      : item
  );
  writeAll(items);

  const meta = readMeta();
  if (meta[id]) {
    meta[id] = { ...meta[id], reassignedBy, reassignedAt: new Date().toISOString() };
    writeMeta(meta);
  }
}

/** Migración suave: si hay plannedDate pero no deliveryDate, copiar plannedDate. */
export function ensureDeliveryDatesMigrated(): void {
  const items = readAll();
  let changed = false;
  const next = items.map((item) => {
    if (!item.deliveryDate && item.plannedDate) {
      changed = true;
      return { ...item, deliveryDate: item.plannedDate };
    }
    return item;
  });
  if (changed) writeAll(next);
}
