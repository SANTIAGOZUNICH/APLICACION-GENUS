import { describe, expect, it } from "vitest";
import { detectLineHeader } from "@/lib/parsers/planner/planner-utils";

describe("detectLineHeader", () => {
  it("detecta línea en celda aislada con columnas vacías (sheet real)", () => {
    expect(detectLineHeader(["", "", "LÍNEA 1", "", ""])).toBe("Línea 1");
    expect(detectLineHeader(["", "", "LÍNEA 2"])).toBe("Línea 2");
    expect(detectLineHeader(["", "", "LÍNEA 3"])).toBe("Línea 3");
    expect(detectLineHeader(["", "", "LÍNEA 4"])).toBe("Línea 4");
  });

  it("detecta variantes sin acento y formato corto", () => {
    expect(detectLineHeader(["LINEA 1"])).toBe("Línea 1");
    expect(detectLineHeader(["L1"])).toBe("Línea 1");
    expect(detectLineHeader(["Premium A"])).toBe("Premium A");
  });

  it("no confunde filas de trabajo con encabezado de línea", () => {
    expect(detectLineHeader(["CAV", "SHAMPOO", "6400"])).toBeNull();
  });
});
