import "server-only";

import { operationsDocumentRepository } from "@/lib/adapters/drive/operations-document-repository";
import { discoverSemanasFile } from "@/lib/mappers/semanas-to-work-items";

export class SemanasDiscoveryService {
  async discover(): Promise<Awaited<ReturnType<typeof discoverSemanasFile>>> {
    await operationsDocumentRepository.refresh("pcp");
    const docRef = await operationsDocumentRepository.tryGetCriticalSheetRef("semanas_2026");

    if (!docRef) {
      return {
        source: "drive",
        scannedAt: new Date().toISOString(),
        tabs: [],
        tabDiscoveries: [],
        blocksSummary: {
          ELABORACION: 0,
          ACONDICIONAMIENTO: 0,
          ENTREGAS: 0,
          DESARROLLO: 0,
          OTRO: 0,
        },
        rowsRead: 0,
        rowsMappable: 0,
        warnings: ["SEMANAS 2026 no indexado. Ejecutá /api/v1/drive/refresh."],
        message: "SEMANAS 2026 no conectado.",
      };
    }

    return discoverSemanasFile(docRef);
  }
}

export const semanasDiscoveryService = new SemanasDiscoveryService();
