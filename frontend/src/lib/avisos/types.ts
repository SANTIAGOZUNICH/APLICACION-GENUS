import type { SectorId } from "@/types/operational/sector";

export const AVISO_PRIORITY = ["NORMAL", "IMPORTANTE", "URGENTE"] as const;
export type AvisoPriority = (typeof AVISO_PRIORITY)[number];

/** Sectores que pueden enviar/recibir avisos internos. */
export const AVISO_PARTICIPANT_SECTORS = [
  "ELABORACION",
  "PRODUCCION",
  "ENVASADO_MASIVO",
  "ENVASADO_PREMIUM",
  "CALIDAD",
  "MATERIA_PRIMA",
  "CODIFICADO",
  "DEPOSITO",
] as const satisfies readonly SectorId[];

export type AvisoParticipantSector = (typeof AVISO_PARTICIPANT_SECTORS)[number];

export type AvisoTab = "recibidos" | "enviados" | "archivados";

export type AvisoRecipientState = {
  sector: SectorId;
  readAt: string | null;
  archivedAt: string | null;
};

export type AvisoRecord = {
  id: string;
  title: string;
  body: string;
  priority: AvisoPriority;
  fromSector: SectorId;
  fromEmail: string;
  toSectors: SectorId[];
  recipients: AvisoRecipientState[];
  createdAt: string;
};

export type CreateAvisoInput = {
  title: string;
  body: string;
  priority: AvisoPriority;
  toSectors: SectorId[];
  /** Si true, equivale a todos los participantes. */
  toAll?: boolean;
};
