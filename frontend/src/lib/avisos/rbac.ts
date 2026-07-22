import type { SectorId } from "@/types/operational/sector";
import { AVISO_PARTICIPANT_SECTORS } from "./types";

export function canUseAvisos(sector: SectorId | null | undefined): boolean {
  if (!sector) return false;
  return (AVISO_PARTICIPANT_SECTORS as readonly string[]).includes(sector);
}

export function assertAvisoSender(sector: SectorId): void {
  if (!canUseAvisos(sector)) {
    throw new Error("Tu sector no puede enviar avisos internos.");
  }
}
