import { describe, expect, it } from "vitest";
import { nodeToText } from "./node-text";

const Badge = ({ label }: { label: string }) => <span>{label}</span>;

describe("nodeToText", () => {
  it("strings, números y fragmentos", () => {
    expect(nodeToText("a")).toBe("a");
    expect(nodeToText(12)).toBe("12");
    expect(nodeToText(null)).toBe("");
    expect(nodeToText(false)).toBe("");
    expect(nodeToText(["x", 2, null, "y"])).toBe("x 2 y");
  });
  it("elementos anidados y componentes con label", () => {
    expect(
      nodeToText(
        <div>
          <p className="font-medium">Producto A</p>
          <p>Marca B</p>
        </div>
      )
    ).toBe("Producto A Marca B");
    expect(nodeToText(<Badge label="APROBADO" />)).toBe("APROBADO");
    expect(nodeToText(<span aria-hidden="true">★</span>)).toBe("");
  });
});
