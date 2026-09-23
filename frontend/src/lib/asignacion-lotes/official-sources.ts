import "server-only";

import { getAsignacionLoteSourcesService } from "./asignacion-lote-sources-service";

export interface OfficialAsignacionLotesSpreadsheet {
  year: string;
  name: string;
  spreadsheetId: string;
}

/**
 * Fuentes OFICIALES de Asignación de Lotes (pedido explícito — "cambio
 * definitivo"): estos dos Google Sheets completos, TODAS sus hojas válidas,
 * son la fuente de verdad. Nadie los conecta desde la UI — spreadsheetId
 * real, confirmado contra las planillas en vivo en esta misma conversación
 * (nunca inventado). Cuando exista 2027, se agrega una entrada acá recién
 * cuando el usuario pase el link real — nunca antes.
 */
export const OFFICIAL_ASIGNACION_LOTES_SPREADSHEETS: readonly OfficialAsignacionLotesSpreadsheet[] = [
  {
    year: "2025",
    name: "Asignación de Lotes 2025",
    spreadsheetId: "1HqvRt1_1XDT1nOhnxFLr7oEhOc5uZhvYirX2GdjiFOU",
  },
  {
    year: "2026",
    name: "Asignación de Lotes 2026",
    spreadsheetId: "1MUPI0vgnXZOD2Iy5lyaGlGls-Dgwz353pbL57YlJI6o",
  },
];

/**
 * Se llama al comienzo de CADA sync (cron/manual/oportunista — un único
 * punto de entrada, ver syncAllEnabledSources). Idempotente y seguro de
 * llamar en cada corrida:
 *
 * 1. Por cada spreadsheet oficial, si todavía no existe una fuente
 *    "spreadsheet completo" (sheetTab null) para ese spreadsheetId, la
 *    crea — server-side, sin que nadie la conecte desde la UI.
 * 2. Cualquier OTRA fuente habilitada que apunte al MISMO spreadsheetId
 *    con una hoja individual (fuentes creadas durante las pruebas
 *    anteriores, sección 15 del pedido) se deshabilita — nunca se borra,
 *    nunca se borran sus datos ni los registros de asignacion_lotes que
 *    haya sincronizado. La próxima corrida de la fuente oficial
 *    re-sincroniza esos mismos registros (misma identidad lote+código) y
 *    los deja apuntando a la fuente oficial — sin duplicar nada.
 *
 * Nunca toca fuentes que no apuntan a estos dos spreadsheetId — una fuente
 * legacy de otro archivo (si existiera) queda intacta.
 */
export async function ensureOfficialSourcesAndRetireRedundant(actorAttribution: {
  email: string;
  displayName: string;
}): Promise<void> {
  const service = getAsignacionLoteSourcesService();
  const all = await service.listAllForSync();

  for (const official of OFFICIAL_ASIGNACION_LOTES_SPREADSHEETS) {
    let officialSource = all.find((s) => s.spreadsheetId === official.spreadsheetId && !s.sheetTab);

    if (!officialSource) {
      officialSource = await service.createSpreadsheetLevelSourceForSync({
        name: official.name,
        period: official.year,
        spreadsheetId: official.spreadsheetId,
        createdBy: actorAttribution.displayName || actorAttribution.email,
      });
      all.push(officialSource);
    }

    const redundant = all.filter(
      (s) =>
        s.spreadsheetId === official.spreadsheetId &&
        Boolean(s.sheetTab) && // solo fuentes de una hoja individual — nunca otra fuente "spreadsheet completo"
        s.enabled &&
        s.id !== officialSource!.id
    );
    for (const source of redundant) {
      await service.disableRedundantForSync(
        source.id,
        `Reemplazada por la fuente oficial "${official.name}" (spreadsheet completo, todas las hojas) — sección 15 del pedido: una sola arquitectura de sincronización, sin fuentes redundantes.`
      );
    }
  }
}
