import { describe, expect, it } from "vitest";
import {
  resolveWorkItemStatusDisplay,
  workItemStatusDisplay,
} from "@/design-system/work-item-status";
import { WORK_ITEM_STATUSES } from "@/types/operational/work-item";

describe("work-item-status display", () => {
  it("define etiqueta para cada WorkItemStatus canónico", () => {
    for (const status of WORK_ITEM_STATUSES) {
      const display = resolveWorkItemStatusDisplay(status);
      expect(display.label.length).toBeGreaterThan(0);
      expect(display.dotClassName).toContain("--genus-");
    }
  });

  it("expone mapa completo sin estados huérfanos", () => {
    expect(Object.keys(workItemStatusDisplay).sort()).toEqual([...WORK_ITEM_STATUSES].sort());
  });
});
