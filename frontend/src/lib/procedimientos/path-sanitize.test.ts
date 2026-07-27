import { describe, expect, it } from "vitest";
import {
  isPathSafe,
  joinRelativePath,
  sanitizePathSegment,
  sanitizeRelativePath,
} from "./path-sanitize";

describe("path-sanitize", () => {
  it("rechaza traversal", () => {
    expect(() => sanitizeRelativePath("../secret")).toThrow(/traversal/);
    expect(() => sanitizePathSegment("..")).toThrow();
    expect(isPathSafe("ok/file")).toBe(true);
    expect(isPathSafe("../bad")).toBe(false);
  });

  it("normaliza segmentos", () => {
    expect(sanitizePathSegment("  Manual QA  ")).toBe("Manual QA");
    expect(joinRelativePath("docs", "v1")).toBe("docs/v1");
  });

  it("rechaza caracteres inválidos", () => {
    expect(() => sanitizePathSegment("file<bad>.txt")).toThrow(/inválid/);
  });
});
