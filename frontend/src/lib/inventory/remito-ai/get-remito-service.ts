import "server-only";

import { getFileStorage } from "@/lib/storage/file-storage";
import { getInventoryService, memoryInventoryRepo } from "../get-inventory-service";
import { MeRemitoIngresoService } from "./remito-ingreso-service";
import { createDefaultRemitoReader } from "./reader";

export function getMeRemitoIngresoService(): MeRemitoIngresoService {
  return new MeRemitoIngresoService(getInventoryService(), memoryInventoryRepo, {
    reader: createDefaultRemitoReader,
    storage: getFileStorage,
  });
}
