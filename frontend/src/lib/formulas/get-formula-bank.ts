import "server-only";

import { isDatabaseConfigured } from "@/lib/db/client";
import {
  formulaBankService,
  memoryFormulaBank,
  FormulaBankService,
} from "./formula-bank-service";
import {
  hydrateFormulaBankFromNeon,
  persistFormulaBankSnapshot,
  resetFormulaHydrationFlag,
} from "./neon-persist";

/** Hidrata desde Neon (si hay DATABASE_URL) y devuelve el servicio en memoria. */
export async function readyFormulaBank(): Promise<FormulaBankService> {
  if (isDatabaseConfigured()) {
    await hydrateFormulaBankFromNeon(memoryFormulaBank);
  }
  return formulaBankService;
}

export async function persistFormulaBankIfConfigured(): Promise<void> {
  if (!isDatabaseConfigured()) return;
  await persistFormulaBankSnapshot(memoryFormulaBank);
}

export function resetFormulaBankRuntimeForTests() {
  resetFormulaHydrationFlag();
  memoryFormulaBank.reset();
}

export { formulaBankService, memoryFormulaBank };
