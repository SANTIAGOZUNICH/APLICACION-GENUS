import type { RemitoRecord } from "./types";
import { normalizeClientId } from "./grouping";

export type RemitoClientFolder = {
  key: string;
  displayName: string;
  remitoCount: number;
  lastUpdatedAt: string | null;
  remitos: RemitoRecord[];
};

const SIN_CLIENTE = "SIN CLIENTE";

export function remitoClientFolderKey(remito: Pick<RemitoRecord, "clientIdNormalized" | "clientDisplay">): string {
  const n = normalizeClientId(remito.clientIdNormalized || remito.clientDisplay);
  if (!n || n === "sin cliente") return "__sin_cliente__";
  return n;
}

export function remitoClientFolderDisplay(
  remito: Pick<RemitoRecord, "clientIdNormalized" | "clientDisplay">
): string {
  const raw = remito.clientDisplay?.trim();
  if (!raw || raw.toLowerCase() === "sin cliente") return SIN_CLIENTE;
  return raw;
}

/** Agrupa remitos en carpetas virtuales por cliente normalizado. */
export function groupRemitosByClient(remitos: RemitoRecord[]): RemitoClientFolder[] {
  const map = new Map<string, RemitoClientFolder>();
  for (const r of remitos) {
    const key = remitoClientFolderKey(r);
    const existing = map.get(key);
    if (!existing) {
      map.set(key, {
        key,
        displayName: remitoClientFolderDisplay(r),
        remitoCount: 1,
        lastUpdatedAt: r.updatedAt || r.createdAt || null,
        remitos: [r],
      });
      continue;
    }
    existing.remitos.push(r);
    existing.remitoCount += 1;
    const t = r.updatedAt || r.createdAt;
    if (t && (!existing.lastUpdatedAt || t > existing.lastUpdatedAt)) {
      existing.lastUpdatedAt = t;
    }
    // Preferir display name más largo / con mayúsculas “correctas”
    const candidate = remitoClientFolderDisplay(r);
    if (candidate !== SIN_CLIENTE && candidate.length >= existing.displayName.length) {
      existing.displayName = candidate;
    }
  }
  return [...map.values()].sort((a, b) =>
    a.displayName.localeCompare(b.displayName, "es", { sensitivity: "base" })
  );
}
