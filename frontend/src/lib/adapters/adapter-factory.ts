import "server-only";

import type { OperationsAdapter } from "@/lib/adapters/operations-adapter";
import { mockAdapter } from "@/lib/adapters/mock-adapter";
import { driveAdapter } from "@/lib/adapters/drive/drive-adapter";
import { canUseDriveAdapter } from "@/lib/api/bff-helpers";
import { getServerDataMode } from "@/lib/config/data-mode";

export function createServerAdapter(): OperationsAdapter {
  if (getServerDataMode() === "real" && canUseDriveAdapter()) {
    return driveAdapter;
  }
  return mockAdapter;
}

export { mockAdapter, driveAdapter };
