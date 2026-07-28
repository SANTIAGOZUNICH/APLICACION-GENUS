// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OperationalTable } from "@/features/os/operational/components/operational-ui";

describe("no horizontal scroll — layout contracts", () => {
  it("os-preview-tokens.css defines density + overflow utilities", () => {
    const cssPath = join(process.cwd(), "src/design-system/os-preview-tokens.css");
    const css = readFileSync(cssPath, "utf8");

    expect(css).toContain("--os-table-font: 13px");
    expect(css).toContain("--os-table-font-secondary: 12px");
    expect(css).toContain("--os-density-pad-x: 0.5rem");
    expect(css).toContain(".os-no-x-scroll");
    expect(css).toContain(".os-table-wrap");
    expect(css).toContain(".os-table");
    expect(css).toContain(".os-break");
    expect(css).toMatch(/html,\s*\nbody[\s\S]*max-width:\s*100vw/);
    expect(css).toMatch(/\.design-preview-root[\s\S]*max-width:\s*100%/);
  });

  it("OperationalTable uses os-table-wrap + os-table (no overflow-x-auto / min-w)", () => {
    const sourcePath = join(
      process.cwd(),
      "src/features/os/operational/components/operational-ui.tsx"
    );
    const source = readFileSync(sourcePath, "utf8");

    expect(source).toContain("os-table-wrap");
    expect(source).toContain("os-table");
    expect(source).toContain("table-fixed");
    expect(source).not.toMatch(/OperationalTable[\s\S]*overflow-x-auto/);
    expect(source).not.toMatch(/OperationalTable[\s\S]*min-w-\[/);
  });
});

describe("no horizontal scroll — minimal shell mount", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.defineProperty(window, "innerWidth", { value: 390, configurable: true });
    document.documentElement.style.width = "390px";

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("OperationalTable renders anti-scroll classes inside design-preview-root", () => {
    act(() => {
      root.render(
        <div className="design-preview-root os-no-x-scroll" style={{ width: "390px" }}>
          <OperationalTable
            columns={[
              { key: "a", header: "Producto", render: () => "Crema hidratante de prueba larga" },
              {
                key: "b",
                header: "Cliente",
                hideOnMobile: true,
                render: () => "Cliente demo",
              },
            ]}
            rows={[{ id: "1" }]}
            rowKey={(row) => row.id}
          />
        </div>
      );
    });

    const wrap = container.querySelector(".os-table-wrap");
    const table = container.querySelector(".os-table");

    expect(wrap).not.toBeNull();
    expect(wrap?.className).toContain("overflow-x-clip");
    expect(table).not.toBeNull();
    expect(table?.className).toContain("table-fixed");

    const doc = document.documentElement;
    expect(doc.scrollWidth).toBeLessThanOrEqual(doc.clientWidth + 1);
  });

  it("TwinShell main keeps overflow-x-hidden + min-w-0", () => {
    const sourcePath = join(process.cwd(), "src/features/os/shell/twin-shell.tsx");
    const source = readFileSync(sourcePath, "utf8");

    expect(source).toContain("overflow-x-hidden");
    expect(source).toContain("min-w-0");
  });
});
