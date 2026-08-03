import { describe, expect, it } from "vitest";
import {
  deterministicApprovalNotificationId,
  filterApprovalEnvasadoMatches,
} from "@/lib/notifications/approval-envasado-notify";

const base = { client: "Cliente Á", product: "Producto Uno", plannedDate: "2026-08-05" };
const row = (overrides: Partial<{ id: string; sector: "ENVASADO_MASIVO" | "ENVASADO_PREMIUM"; client: string; product: string; plannedDate: string; plannedDateTo: string | null; status: string }> = {}) => ({
  id: "w1", sector: "ENVASADO_MASIVO" as const, client: base.client, product: base.product,
  plannedDate: "2026-08-03", plannedDateTo: null, status: "PLANIFICADO", ...overrides,
});

describe("approval → Envasado matching", () => {
  it("matches Masivo, Premium and both by exact normalized client/product", () => {
    expect(filterApprovalEnvasadoMatches(base, [row()]).map((x) => x.sector)).toEqual(["ENVASADO_MASIVO"]);
    expect(filterApprovalEnvasadoMatches(base, [row({ sector: "ENVASADO_PREMIUM" })]).map((x) => x.sector)).toEqual(["ENVASADO_PREMIUM"]);
    expect(filterApprovalEnvasadoMatches(base, [row(), row({ id: "w2", sector: "ENVASADO_PREMIUM" })])).toHaveLength(2);
  });
  it("rejects wrong client, wrong product and cancelled work", () => {
    expect(filterApprovalEnvasadoMatches(base, [row({ client: "Otro" })])).toHaveLength(0);
    expect(filterApprovalEnvasadoMatches(base, [row({ product: "Otro" })])).toHaveLength(0);
    expect(filterApprovalEnvasadoMatches(base, [row({ status: "CANCELADO" })])).toHaveLength(0);
  });
  it("includes planned ranges that overlap the approval week", () => {
    expect(filterApprovalEnvasadoMatches(base, [row({ plannedDate: "2026-07-31", plannedDateTo: "2026-08-04" })])).toHaveLength(1);
    expect(filterApprovalEnvasadoMatches(base, [row({ plannedDate: "2026-08-10" })])).toHaveLength(0);
  });
  it("generates stable UUID primary keys for idempotent inserts", () => {
    const key = "approval:item:ENVASADO_MASIVO:CALIDAD";
    expect(deterministicApprovalNotificationId(key)).toBe(deterministicApprovalNotificationId(key));
    expect(deterministicApprovalNotificationId(key)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
