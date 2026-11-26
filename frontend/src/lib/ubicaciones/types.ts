import type { SectorId } from "@/types/operational/sector";
import type { ShapeKind, UbicacionItem } from "./rules";

export type UbicacionItemView = UbicacionItem;

export type UbActor = { email: string; sector: SectorId; displayName?: string | null };

export type MapConfigView = { width: number; height: number; title: string };

export type ShapeView = { id: string; kind: ShapeKind; label: string; sublabel: string; x: number; y: number; w: number; h: number; points: Array<[number, number]> | null; rotation: number; sortOrder: number; active: boolean };

export type UbicacionView = {
  id: string;
  code: string;
  zone: string;
  x: number;
  y: number;
  w: number;
  h: number;
  sortOrder: number;
  active: boolean;
  version: number;
  observations: string;
  lastModifiedAt: string | null;
  lastModifiedBy: string | null;
  items: UbicacionItem[];
};

export type MapView = {
  config: MapConfigView;
  shapes: ShapeView[];
  locations: UbicacionView[];
  indicators: { total: number; ocupadas: number; libres: number };
  capabilities: { read: boolean; write: boolean; config: boolean };
  serverTime: string;
};

export type MovementLine = { clientName: string; clientKey: string; material: string; codigo: string | null; meMaterialId: string | null; unit: string; quantity: number | null; remaining?: number | null; verified?: boolean; verifiedBefore?: boolean };

export type MovementView = {
  id: string;
  seq: number;
  kind: string;
  fromLocationId: string | null;
  fromCode: string | null;
  toLocationId: string | null;
  toCode: string | null;
  lines: MovementLine[];
  note: string | null;
  detail: Record<string, unknown>;
  actorEmail: string;
  actorName: string | null;
  actorSector: string;
  createdAt: string;
};

export type MaterialOption = { id: string; codigo: string; descripcion: string; cliente: string; unit: string; stock: number; distributed: number };

export type OpResultView = { replayed: boolean; movementId: string; locations: UbicacionView[]; placedIn?: string };

export type IngresoPendiente = { ingresoId: string; fecha: string; ingresoNro: string; codigo: string; material: string; cliente: string; total: number; unit: string };
export type IngresoReview = { ingresoId: string; locationId: string; locationCode: string; reason: "ANULADO" | "MODIFICADO"; applied: number; current: number; diff: number; ingresoNro: string; material: string; cliente: string; unit: string };
