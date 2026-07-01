import "server-only";

import type { OperationsAdapter } from "@/lib/adapters/operations-adapter";
import { mockAdapter } from "@/lib/adapters/mock-adapter";
import { sheetsAdapter } from "@/lib/adapters/sheets/sheets-adapter";
import {
  getServerDataMode,
  shouldFallbackToDemo,
} from "@/lib/config/data-mode";

export function createServerAdapter(): OperationsAdapter {
  return getServerDataMode() === "real" ? sheetsAdapter : mockAdapter;
}

export async function withSheetsFallback<T>(
  operation: () => Promise<T>
): Promise<{ data: T; source: "sheets" | "demo" }> {
  if (getServerDataMode() !== "real") {
    throw new Error("Operación de Sheets invocada en modo demo.");
  }

  try {
    const data = await operation();
    return { data, source: "sheets" };
  } catch (error) {
    if (!shouldFallbackToDemo()) {
      throw error;
    }

    console.error("[Genus] SheetsAdapter fallback to demo:", error);
    throw error;
  }
}

export { mockAdapter, sheetsAdapter };
