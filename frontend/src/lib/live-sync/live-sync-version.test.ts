import { describe, expect, it } from "vitest";
import { shouldAcceptLiveSyncUpdate } from "@/lib/live-sync/live-sync-version";

describe("shouldAcceptLiveSyncUpdate", () => {
  it("acepta la primera actualización", () => {
    expect(
      shouldAcceptLiveSyncUpdate({
        appliedRevision: null,
        appliedVersion: null,
        incomingRevision: 1,
        incomingVersion: "v-new",
      })
    ).toBe(true);
  });

  it("rechaza revision anterior (anti-retroceso 161→160)", () => {
    expect(
      shouldAcceptLiveSyncUpdate({
        appliedRevision: 5,
        appliedVersion: "hash-161",
        incomingRevision: 4,
        incomingVersion: "hash-160",
      })
    ).toBe(false);
  });

  it("acepta revision mayor", () => {
    expect(
      shouldAcceptLiveSyncUpdate({
        appliedRevision: 5,
        appliedVersion: "hash-160",
        incomingRevision: 6,
        incomingVersion: "hash-161",
      })
    ).toBe(true);
  });

  it("misma revision solo si version coincide", () => {
    expect(
      shouldAcceptLiveSyncUpdate({
        appliedRevision: 5,
        appliedVersion: "hash-161",
        incomingRevision: 5,
        incomingVersion: "hash-160",
      })
    ).toBe(false);
    expect(
      shouldAcceptLiveSyncUpdate({
        appliedRevision: 5,
        appliedVersion: "hash-161",
        incomingRevision: 5,
        incomingVersion: "hash-161",
      })
    ).toBe(true);
  });
});
