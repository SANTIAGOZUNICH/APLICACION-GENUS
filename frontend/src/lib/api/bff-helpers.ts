import "server-only";

import { mockAdapter } from "@/lib/adapters/mock-adapter";
import { isDriveRepositoryConfigured } from "@/lib/adapters/drive/drive-folder-config";
import { hasGoogleCredentials } from "@/lib/adapters/google/google-auth";
import {
  getServerDataMode,
  shouldFallbackToDemo,
} from "@/lib/config/data-mode";

export type ApiDataSource = "drive" | "drive-partial" | "demo";

export function getApiDataSource(): ApiDataSource {
  return getServerDataMode() === "real" ? "drive" : "demo";
}

export function canUseDriveAdapter(): boolean {
  return (
    getServerDataMode() === "real" &&
    hasGoogleCredentials() &&
    isDriveRepositoryConfigured()
  );
}

export function shouldUseDemoFallback(): boolean {
  if (getServerDataMode() !== "real") return true;
  if (!canUseDriveAdapter()) return shouldFallbackToDemo();
  return false;
}

export function demoFallbackResponse<T>(
  buildDemo: () => T,
  error: unknown,
  errorCode = "DRIVE_READ_FAILED"
) {
  if (!shouldFallbackToDemo()) {
    return {
      ok: false as const,
      response: Response.json(
        {
          error:
            error instanceof Error ? error.message : "Error al leer Drive.",
          code: errorCode,
        },
        { status: 502 }
      ),
    };
  }

  console.error("[Genus] Drive fallback to demo:", error);
  return {
    ok: true as const,
    data: buildDemo(),
    source: "demo" as const,
  };
}

export function getMockLoteBundles() {
  return Object.values(mockAdapter.getInitialState().entityPages)
    .filter((page) => page.kind === "lote")
    .map((page) => ({
      loteId: page.entityId,
      entityPage: page,
    }));
}
