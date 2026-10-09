/**
 * Bug de Production (Etapas 2 y 3): la preferencia «Ver como lista» era UNA para todas las tablas; quien la había
 * elegido alguna vez veía todas las planillas editables como lista (sin edición en la celda).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readTableMode } from "./operational-ui";

describe("preferencia planilla/lista por tabla", () => {
  let store: Record<string, string>;
  beforeEach(() => {
    store = {};
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (k: string) => store[k] ?? null,
        setItem: (k: string, v: string) => void (store[k] = v),
      },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("una tabla EDITABLE abre como planilla aunque haya quedado guardada la preferencia global «lista»", () => {
    store.genus_os_table_mode = "list";
    expect(readTableMode("mp-ingresos", true)).toBe("excel");
  });
  it("las tablas de solo lectura conservan la preferencia global de antes", () => {
    store.genus_os_table_mode = "list";
    expect(readTableMode("historial", false)).toBe("list");
  });
  it("la elección explícita de una tabla vale solo para esa tabla", () => {
    store["genus_os_table_mode:mp-compras"] = "list";
    expect(readTableMode("mp-compras", true)).toBe("list");
    expect(readTableMode("mp-ingresos", true)).toBe("excel");
  });
  it("sin preferencias: planilla", () => {
    expect(readTableMode("me-salidas", true)).toBe("excel");
    expect(readTableMode(undefined, false)).toBe("excel");
  });
});
