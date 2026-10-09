import { describe, expect, it } from "vitest";
import { isBuildSkew, shortBuild } from "@/lib/pwa/build-version";

describe("versión de la pestaña vs. servidor", () => {
  it("avisa solo si ambos commits se conocen y difieren", () => {
    expect(isBuildSkew("bbbbbbb", "aaaaaaa")).toBe(true);
    expect(isBuildSkew("aaaaaaa", "aaaaaaa")).toBe(false);
    // Desarrollo local / servidor sin commit: nunca molesta con un aviso falso.
    expect(isBuildSkew("", "aaaaaaa")).toBe(false);
    expect(isBuildSkew("bbbbbbb", "")).toBe(false);
    expect(isBuildSkew(null, "aaaaaaa")).toBe(false);
  });
  it("muestra el commit corto", () => {
    expect(shortBuild("a6b9b236be245a47")).toBe("a6b9b23");
    expect(shortBuild("")).toBe("dev");
  });
});
