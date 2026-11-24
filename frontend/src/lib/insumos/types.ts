/** Módulo INSUMOS — tipos compartidos (cliente y servidor). Sin dependencias de servidor. */
import type { SectorId } from "@/types/operational/sector";

export type RetiroStatus = "ACTIVO" | "ANULADO";
export type RetiroEventAction = "CREADO" | "CORREGIDO" | "ANULADO";

export type InsumoItem = { id: string; name: string; active: boolean; sortOrder: number };
export type InsumoResponsable = { id: string; sector: SectorId; name: string; active: boolean; sortOrder: number };

export type RetiroLine = { insumoId: string; insumoName: string; cantidad: number };

export type Retiro = {
  id: string;
  sector: SectorId;
  responsableId: string;
  responsableName: string;
  registradoPorEmail: string;
  registradoPorName: string;
  registradoPorSector: string;
  status: RetiroStatus;
  anuladoAt: string | null;
  anuladoBy: string | null;
  anuladoMotivo: string | null;
  createdAt: string;
  updatedAt: string;
  lines: RetiroLine[];
};

export type RetiroSnapshot = { responsableId: string; responsableName: string; status: RetiroStatus; lines: RetiroLine[] };

export type RetiroEvent = {
  id: string;
  retiroId: string;
  action: RetiroEventAction;
  actorEmail: string;
  actorName: string;
  actorSector: string;
  motivo: string | null;
  before: RetiroSnapshot | null;
  after: RetiroSnapshot | null;
  createdAt: string;
};

export type InsumoActor = { email: string; sector: SectorId; displayName: string };

export type InsumoFilters = { from?: string; to?: string; sector?: string; responsableId?: string; insumoId?: string };

export type CreateRetiroInput = {
  clientRequestId: string;
  responsableId: string;
  lines: Array<{ insumoId: string; cantidad: number }>;
};

export type CreateRetiroResult = { retiro: Retiro; created: boolean };

export type CatalogResponse = {
  items: InsumoItem[];
  responsables: InsumoResponsable[];
  /** Sector con el que se registraría el retiro (null si el actor no registra). */
  registrationSector: SectorId | null;
  canRegister: boolean;
  canAdmin: boolean;
};
