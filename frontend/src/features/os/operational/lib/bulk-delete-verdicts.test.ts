import { describe, expect, it } from "vitest";
import { classifyBulkDelete, summarizeVerdicts, BULK_DELETE_VERDICT_REASON } from "./bulk-delete-verdicts";

const base = { deletedAt: null, operationalStatus: "revision", version: 3, activeDeliveries: 0, remitoLinks: 0 };

describe("classifyBulkDelete", () => {
  it("elegible: sin entregas, sin remito, no entregado", () => {
    expect(classifyBulkDelete(base)).toBe("ELIGIBLE");
  });
  it("ya eliminado → idempotente", () => {
    expect(classifyBulkDelete({ ...base, deletedAt: new Date() })).toBe("ALREADY_DELETED");
  });
  it("protege el historial: entregado, con entregas o en remito", () => {
    expect(classifyBulkDelete({ ...base, operationalStatus: "entregado" })).toBe("BLOCKED_DELIVERED");
    expect(classifyBulkDelete({ ...base, activeDeliveries: 1 })).toBe("BLOCKED_HAS_DELIVERIES");
    expect(classifyBulkDelete({ ...base, remitoLinks: 2 })).toBe("BLOCKED_IN_REMITO");
  });
  it("control optimista por versión", () => {
    expect(classifyBulkDelete(base, 2)).toBe("VERSION_CONFLICT");
    expect(classifyBulkDelete(base, 3)).toBe("ELIGIBLE");
  });
  it("resume veredictos", () => {
    const v = (code: never) => ({ id: "x", code, reason: "" });
    expect(summarizeVerdicts([v("ELIGIBLE" as never), v("ALREADY_DELETED" as never), v("BLOCKED_IN_REMITO" as never)])).toEqual({
      eligible: 1,
      alreadyDeleted: 1,
      blocked: 1,
    });
    expect(BULK_DELETE_VERDICT_REASON.BLOCKED_IN_REMITO).toMatch(/remito/);
  });
});
