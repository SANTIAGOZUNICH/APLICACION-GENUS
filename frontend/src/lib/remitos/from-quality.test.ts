import { describe, expect, it } from "vitest";
import {
  hasBlockingRemitoGaps,
  isPackagingQualityItem,
  remitoGapsFromQuality,
  resolveRemitoInputFromQuality,
} from "./from-quality";
import type { QualityItem } from "@/features/os/operational/types";

const baseSalida: QualityItem = {
  id: "qc:w1",
  kind: "salida",
  status: "aprobado",
  product: "Crema",
  client: "",
  quantity: "100",
  relatedWorkItemId: "w1",
};

describe("from-quality remito gaps", () => {
  it("detecta packaging salida", () => {
    expect(isPackagingQualityItem(baseSalida)).toBe(true);
    expect(isPackagingQualityItem({ ...baseSalida, kind: "granel" })).toBe(false);
  });

  it("bloquea sin cliente ni fecha", () => {
    const gaps = remitoGapsFromQuality(baseSalida, []);
    expect(gaps.missingClient).toBe(true);
    expect(gaps.missingDeliveryDate).toBe(true);
    expect(hasBlockingRemitoGaps(gaps)).toBe(true);
  });

  it("permite generar con cliente y fecha", () => {
    const item = { ...baseSalida, client: "ACME", deliveryDate: "2026-07-01" };
    const gaps = remitoGapsFromQuality(item, []);
    expect(hasBlockingRemitoGaps(gaps)).toBe(false);
    const input = resolveRemitoInputFromQuality(item, []);
    expect(input?.clientId).toBe("ACME");
    expect(input?.deliveryDate).toBe("2026-07-01");
  });
});
