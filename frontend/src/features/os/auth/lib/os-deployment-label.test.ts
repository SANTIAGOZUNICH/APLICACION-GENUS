import { describe, expect, it } from "vitest";
import { getOsDeploymentLabel, resolveOsDeploymentEnv } from "./os-deployment-label";

describe("os-deployment-label", () => {
  it("maps production", () => {
    expect(resolveOsDeploymentEnv("production")).toBe("production");
    expect(getOsDeploymentLabel("production")).toBe("V 1.0 · PRODUCTION");
  });

  it("maps preview", () => {
    expect(resolveOsDeploymentEnv("preview")).toBe("preview");
    expect(getOsDeploymentLabel("preview")).toBe("V 1.0 · PREVIEW");
  });

  it("maps unknown/empty to local", () => {
    expect(resolveOsDeploymentEnv("")).toBe("local");
    expect(resolveOsDeploymentEnv(null)).toBe("local");
    expect(getOsDeploymentLabel(undefined)).toBe("V 1.0 · LOCAL");
  });
});
