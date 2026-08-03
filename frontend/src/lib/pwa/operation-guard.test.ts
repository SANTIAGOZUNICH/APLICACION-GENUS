import { describe, expect, it } from "vitest";
import {
  beginOperationGuard,
  endOperationGuard,
  getOperationGuardSnapshot,
  hasBlockingOperations,
} from "@/lib/pwa/operation-guard";

describe("operation-guard", () => {
  it("tracks dirty operations and clears them", () => {
    expect(hasBlockingOperations()).toBe(false);
    const id = beginOperationGuard("form-dirty", "OE");
    expect(hasBlockingOperations()).toBe(true);
    expect(getOperationGuardSnapshot().items[0]?.label).toBe("OE");
    endOperationGuard(id);
    expect(hasBlockingOperations()).toBe(false);
  });
});
