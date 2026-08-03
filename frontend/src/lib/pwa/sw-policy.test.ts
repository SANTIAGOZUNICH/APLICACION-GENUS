import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Genus OS service worker policy", () => {
  const sw = readFileSync(resolve(process.cwd(), "public/sw.js"), "utf8");

  it("never caches /api routes", () => {
    expect(sw).toMatch(/isApiRequest/);
    expect(sw).toMatch(/pathname\.startsWith\("\/api\/"\)/);
    expect(sw).toMatch(/if \(isApiRequest\(url\)\) return;/);
  });

  it("falls back to /offline for failed navigations", () => {
    expect(sw).toMatch(/caches\.match\("\/offline"\)/);
    expect(sw).toMatch(/request\.mode === "navigate"/);
  });

  it("versions static caches by build", () => {
    expect(sw).toMatch(/genus-os-static-/);
    expect(sw).toMatch(/searchParams\.get\("build"\)/);
  });
});
