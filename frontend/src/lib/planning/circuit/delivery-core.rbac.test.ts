import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/client", () => ({ getDb: () => ({}) }));

import { canActorDeliverItem } from "./delivery-core";

describe("canActorDeliverItem", () => {
  it("matriz de permisos por sector", () => {
    expect(canActorDeliverItem("PRODUCCION", "ELABORACION")).toBe(true);
    expect(canActorDeliverItem("DIRECCION", "CODIFICADO")).toBe(true);
    expect(canActorDeliverItem("ENVASADO_MASIVO", "ENVASADO_MASIVO")).toBe(true);
    expect(canActorDeliverItem("ENVASADO_MASIVO", "ENVASADO_PREMIUM")).toBe(false);
    expect(canActorDeliverItem("ENVASADO_PREMIUM", "CODIFICADO")).toBe(false);
    expect(canActorDeliverItem("CODIFICADO", "CODIFICADO")).toBe(true);
    expect(canActorDeliverItem("CODIFICADO", "ENVASADO_MASIVO")).toBe(false);
    expect(canActorDeliverItem("ELABORACION", "ELABORACION")).toBe(false);
    expect(canActorDeliverItem("CALIDAD", "ENVASADO_MASIVO")).toBe(false);
  });
});
