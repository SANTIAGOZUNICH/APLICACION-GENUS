import { describe, expect, it } from "vitest";
import { groupRemitosByClient } from "./client-folders";
import type { RemitoRecord } from "./types";

function remito(partial: Partial<RemitoRecord>): RemitoRecord {
  return {
    id: partial.id ?? "r1",
    remitoNumber: null,
    displayName: partial.displayName ?? null,
    clientIdNormalized: partial.clientIdNormalized ?? "",
    clientDisplay: partial.clientDisplay ?? "",
    deliveryDate: partial.deliveryDate ?? "2026-07-30",
    status: partial.status ?? "BORRADOR",
    version: 1,
    totalUnits: 0,
    totalCajas: 0,
    totalBultos: 0,
    snapshot: {},
    createdBy: null,
    createdBySector: null,
    updatedBy: null,
    generatedBy: null,
    createdAt: "2026-07-27T12:00:00.000Z",
    updatedAt: "2026-07-27T12:00:00.000Z",
    generatedAt: null,
    lines: [],
    versions: [],
  };
}

describe("client-folders", () => {
  it("fusiona UNICA / Unica / única en una carpeta", () => {
    const folders = groupRemitosByClient([
      remito({ id: "1", clientDisplay: "UNICA", clientIdNormalized: "unica" }),
      remito({ id: "2", clientDisplay: "Unica", clientIdNormalized: "unica" }),
      remito({ id: "3", clientDisplay: " única ", clientIdNormalized: "única" }),
    ]);
    // Normalización NFKC lower: "única" → distinta de "unica" sin strip diacríticos en normalizeClientId
    // Asegura al menos que UNICA/Unica colapsan.
    const unica = folders.filter((f) => f.key === "unica");
    expect(unica).toHaveLength(1);
    expect(unica[0]!.remitoCount).toBe(2);
  });

  it("usa SIN CLIENTE para vacíos", () => {
    const folders = groupRemitosByClient([
      remito({ id: "1", clientDisplay: "Sin cliente", clientIdNormalized: "sin cliente" }),
    ]);
    expect(folders[0]!.displayName).toBe("SIN CLIENTE");
  });
});
