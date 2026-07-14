import { describe, expect, it } from "vitest";
import {
  getRememberedSheetHash,
  rememberSheetHash,
  resetOperationalSheetsWatcherForTests,
} from "@/lib/live-sync/operational-sheets-watcher";

describe("operational-sheets-watcher hash memory", () => {
  it("recuerda hash y detecta cambio lógico local", () => {
    resetOperationalSheetsWatcherForTests();
    rememberSheetHash("semanas_2026", "abc");
    expect(getRememberedSheetHash("semanas_2026")).toBe("abc");
    rememberSheetHash("semanas_2026", "def");
    expect(getRememberedSheetHash("semanas_2026")).toBe("def");
  });
});
