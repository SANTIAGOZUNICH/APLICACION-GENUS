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
  "ADMINISTRACION",
] as const satisfies readonly SectorId[];

export type AvisoParticipantSector = (typeof AVISO_PARTICIPANT_SECTORS)[number];

export type AvisoTab = "recibidos" | "enviados" | "archivados";

export type AvisoRecipientState = {
  sector: SectorId;
  readAt: string | null;
  archivedAt: string | null;
};

/** Destinatario individual de un aviso, con su propio estado leído/archivado. */
export type AvisoUserRecipient = {
  email: string;
  name: string;
  sector: SectorId;
  /** USUARIO = elegido por nombre; RESPONSABLE = resuelto como responsable de un sector. */
  via: "USUARIO" | "RESPONSABLE";
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
  /** Destinatarios individuales (vacío si el aviso es solo por sector). */
  userRecipients: AvisoUserRecipient[];
  /** Nombre de quien lo envió. */
  fromName?: string;
  /** Estado del aviso para QUIEN LO CONSULTA (su fila individual o, si no la tiene, la de su sector). */
  mine?: { readAt: string | null; archivedAt: string | null } | null;
  createdAt: string;
};

export type CreateAvisoInput = {
  title: string;
  body: string;
  priority: AvisoPriority;
  toSectors: SectorId[];
  /** Si true, equivale a todos los participantes. */
  toAll?: boolean;
  /** Emails de personas concretas. */
  toUsers?: string[];
  /** true = los sectores elegidos (o todos) se interpretan como «solo sus responsables», no todo el sector. */
  onlyResponsables?: boolean;
};
