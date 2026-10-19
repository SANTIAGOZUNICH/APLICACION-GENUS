import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { getDb, isDatabaseConfigured } from "@/lib/db/client";
import { genusAuthUsers } from "@/lib/auth/schema";
import type { SectorId } from "@/types/operational/sector";
import { AVISO_PARTICIPANT_SECTORS } from "./types";

export type AvisoDirectoryUser = { email: string; name: string; sector: SectorId; roleLabel: string; responsable: boolean };

/** Rol que se considera «responsable» de un sector (supervisor/a). */
export const RESPONSABLE_ROLE_ID = "ROL-SU";

/** Personas activas de los sectores que participan de Avisos (para elegir destinatarios). Sin contraseñas ni datos sensibles. */
export async function listAvisoDirectory(): Promise<AvisoDirectoryUser[]> {
  if (!isDatabaseConfigured()) return [];
  try {
    const rows = await getDb()
      .select({ email: genusAuthUsers.email, name: genusAuthUsers.displayName, sector: genusAuthUsers.sector, roleId: genusAuthUsers.roleId, roleLabel: genusAuthUsers.roleLabel })
      .from(genusAuthUsers)
      .where(and(eq(genusAuthUsers.status, "ACTIVO"), sql`${genusAuthUsers.sector} in (${sql.join(AVISO_PARTICIPANT_SECTORS.map((s) => sql`${s}`), sql`, `)})`));
    return rows
      .map((r) => ({ email: r.email, name: r.name, sector: r.sector as SectorId, roleLabel: r.roleLabel, responsable: r.roleId === RESPONSABLE_ROLE_ID }))
      .sort((a, b) => a.sector.localeCompare(b.sector) || a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}
