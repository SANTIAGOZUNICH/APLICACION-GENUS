import type { SectorId } from "@/types/operational/sector";

export function canAdminCoas(sector: SectorId): boolean {
  return sector === "MATERIA_PRIMA";
}

export function canViewCoas(sector: SectorId): boolean {
  return (
    sector === "MATERIA_PRIMA" ||
    sector === "PRODUCCION" ||
    sector === "CALIDAD" ||
    sector === "DIRECCION"
  );
}

export type CoaFolderRecord = {
  id: string;
  parentId: string | null;
  name: string;
  driveFolderId: string;
  path: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type CoaFileRecord = {
  id: string;
  folderId: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  driveFileId: string;
  currentVersion: number;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
};
