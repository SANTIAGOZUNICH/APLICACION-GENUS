import type { SectorId } from "@/types/operational/sector";

/** Sectores que usan "Archivar de mi vista" (Envasado). */
export const WORK_VIEW_ARCHIVE_SECTORS = [
  "ENVASADO_MASIVO",
  "ENVASADO_PREMIUM",
] as const satisfies readonly SectorId[];

export type WorkViewArchiveSector = (typeof WORK_VIEW_ARCHIVE_SECTORS)[number];

export function isWorkViewArchiveSector(value: string): value is WorkViewArchiveSector {
  return (WORK_VIEW_ARCHIVE_SECTORS as readonly string[]).includes(value);
}

export type WorkViewArchiveRecord = {
  id: string;
  sector: WorkViewArchiveSector;
  workItemId: string;
  actorEmail: string;
  archivedAt: string;
};

export type WorkViewArchiveActor = {
  email: string;
  sector: SectorId;
};

export const VIEW_ARCHIVE_TOOLTIP =
  "Esto lo quitará de tu vista, pero conservará el registro operativo";
