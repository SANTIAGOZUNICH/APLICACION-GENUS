import { describe, expect, it } from "vitest";
import {
  resolveWorkspaceBreakpoint,
  workspaceColumnsForBreakpoint,
} from "./workspace-layout";

describe("Workspace layout helpers", () => {
  it("resuelve breakpoint mobile", () => {
    expect(resolveWorkspaceBreakpoint(390)).toBe("mobile");
    expect(workspaceColumnsForBreakpoint("mobile")).toBe(1);
  });

  it("resuelve breakpoint tablet", () => {
    expect(resolveWorkspaceBreakpoint(768)).toBe("tablet");
    expect(workspaceColumnsForBreakpoint("tablet")).toBe(2);
  });

  it("resuelve breakpoint desktop", () => {
    expect(resolveWorkspaceBreakpoint(1280)).toBe("desktop");
    expect(workspaceColumnsForBreakpoint("desktop")).toBe(2);
  });
});
