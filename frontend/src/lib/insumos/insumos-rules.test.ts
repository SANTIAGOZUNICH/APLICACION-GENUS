import { describe, expect, it } from "vitest";
import {
  MAX_CANTIDAD,
  canAdminInsumos,
  canRegisterInsumos,
  hasAnyQuantity,
  isValidClientRequestId,
  newClientRequestId,
  normalizeLines,
  normalizeName,
  parseCantidad,
  responsableAllowedForSector,
  responsablesForSector,
  slugify,
  validateMotivo,
} from "./insumos-rules";
import type { InsumoResponsable } from "./types";

const R = (id: string, sector: InsumoResponsable["sector"], name: string, sortOrder = 0, active = true): InsumoResponsable => ({ id, sector, name, sortOrder, active });
const SEED = [
  R("envasado-masivo-gabo", "ENVASADO_MASIVO", "GABO", 1),
  R("envasado-masivo-nico-y", "ENVASADO_MASIVO", "NICO Y", 2),
  R("envasado-premium-joaquin", "ENVASADO_PREMIUM", "JOAQUIN", 1),
  R("codificado-gabo", "CODIFICADO", "GABO", 2),
  R("codificado-julian", "CODIFICADO", "JULIAN", 1),
  R("materia-prima-valentin", "MATERIA_PRIMA", "VALENTIN", 1),
];

describe("permisos por sector", () => {
  it("solo los 5 sectores operativos registran; Administración/Dirección no registran pero administran", () => {
    for (const s of ["ENVASADO_MASIVO", "ENVASADO_PREMIUM", "CODIFICADO", "ELABORACION", "MATERIA_PRIMA"] as const) {
      expect(canRegisterInsumos(s)).toBe(true);
      expect(canAdminInsumos(s)).toBe(false);
    }
    for (const s of ["ADMINISTRACION", "DIRECCION"] as const) {
      expect(canRegisterInsumos(s)).toBe(false);
      expect(canAdminInsumos(s)).toBe(true);
    }
    for (const s of ["DEPOSITO", "PRODUCCION", "CALIDAD", "COMERCIAL"] as const) {
      expect(canRegisterInsumos(s)).toBe(false);
      expect(canAdminInsumos(s)).toBe(false);
    }
    expect(canRegisterInsumos(null)).toBe(false);
  });
});

describe("cantidades", () => {
  it("acepta enteros >= 0 (número o texto)", () => {
    expect(parseCantidad(0)).toEqual({ ok: true, value: 0 });
    expect(parseCantidad("12")).toEqual({ ok: true, value: 12 });
    expect(parseCantidad(MAX_CANTIDAD)).toEqual({ ok: true, value: MAX_CANTIDAD });
  });
  it("rechaza negativos, decimales, vacíos, texto y tope", () => {
    for (const bad of [-1, 1.5, "", "abc", NaN, null, undefined, MAX_CANTIDAD + 1, "1.2"]) expect(parseCantidad(bad).ok).toBe(false);
  });
  it("SIGUIENTE solo con al menos una cantidad > 0", () => {
    expect(hasAnyQuantity({})).toBe(false);
    expect(hasAnyQuantity({ guantes: 0, cinta: 0 })).toBe(false);
    expect(hasAnyQuantity({ guantes: 0, cinta: 2 })).toBe(true);
  });
});

describe("normalizeLines", () => {
  it("descarta los renglones en 0 y conserva los > 0", () => {
    const r = normalizeLines([{ insumoId: "guantes", cantidad: 2 }, { insumoId: "cinta", cantidad: 0 }, { insumoId: "film", cantidad: "3" }]);
    expect(r).toEqual({ ok: true, value: [{ insumoId: "guantes", cantidad: 2 }, { insumoId: "film", cantidad: 3 }] });
  });
  it("exige al menos un renglón > 0", () => {
    expect(normalizeLines([{ insumoId: "guantes", cantidad: 0 }]).ok).toBe(false);
    expect(normalizeLines([]).ok).toBe(false);
    expect(normalizeLines("x").ok).toBe(false);
  });
  it("rechaza repetidos, sin id, negativos y decimales", () => {
    expect(normalizeLines([{ insumoId: "a", cantidad: 1 }, { insumoId: "a", cantidad: 2 }]).ok).toBe(false);
    expect(normalizeLines([{ insumoId: "", cantidad: 1 }]).ok).toBe(false);
    expect(normalizeLines([{ insumoId: "a", cantidad: -1 }]).ok).toBe(false);
    expect(normalizeLines([{ insumoId: "a", cantidad: 1.5 }]).ok).toBe(false);
  });
});

describe("responsables por sector (ids estables, un responsable pertenece a un sector)", () => {
  it("cada sector ve SOLO los suyos, con el orden configurado", () => {
    expect(responsablesForSector(SEED, "ENVASADO_MASIVO").map((r) => r.name)).toEqual(["GABO", "NICO Y"]);
    expect(responsablesForSector(SEED, "CODIFICADO").map((r) => r.name)).toEqual(["JULIAN", "GABO"]);
    expect(responsablesForSector(SEED, "ENVASADO_PREMIUM").map((r) => r.name)).toEqual(["JOAQUIN"]);
    expect(responsablesForSector(SEED, "ELABORACION")).toEqual([]);
    expect(responsablesForSector(SEED, null)).toEqual([]);
  });
  it("«GABO» de Masivo y «GABO» de Codificado son registros distintos y solo valen en su sector", () => {
    const gm = SEED.find((r) => r.id === "envasado-masivo-gabo")!;
    const gc = SEED.find((r) => r.id === "codificado-gabo")!;
    expect(gm.id).not.toBe(gc.id);
    expect(responsableAllowedForSector(gm, "ENVASADO_MASIVO")).toBe(true);
    expect(responsableAllowedForSector(gm, "CODIFICADO")).toBe(false);
    expect(responsableAllowedForSector(gc, "CODIFICADO")).toBe(true);
    expect(responsableAllowedForSector(gc, "ENVASADO_MASIVO")).toBe(false);
  });
  it("un responsable dado de baja no se puede elegir", () => {
    expect(responsableAllowedForSector(R("x", "CODIFICADO", "X", 1, false), "CODIFICADO")).toBe(false);
    expect(responsablesForSector([R("x", "CODIFICADO", "X", 1, false)], "CODIFICADO")).toEqual([]);
  });
});

describe("clave de idempotencia", () => {
  it("se genera una clave válida y distinta por intento", () => {
    const a = newClientRequestId();
    const b = newClientRequestId();
    expect(isValidClientRequestId(a)).toBe(true);
    expect(a).not.toBe(b);
  });
  it("rechaza claves vacías, cortas, largas o con caracteres raros", () => {
    for (const bad of ["", "abc", "x".repeat(101), "con espacios en la clave larga", 5, null, "ins-ñandú-ñandú-ñandú"]) expect(isValidClientRequestId(bad)).toBe(false);
  });
});

describe("motivo, nombres y slugs", () => {
  it("motivo obligatorio (mínimo 3, máximo 500)", () => {
    expect(validateMotivo("  ").ok).toBe(false);
    expect(validateMotivo("ok").ok).toBe(false);
    expect(validateMotivo("Error de carga")).toEqual({ ok: true, value: "Error de carga" });
    expect(validateMotivo("x".repeat(501)).ok).toBe(false);
  });
  it("nombres en MAYÚSCULAS sin espacios dobles", () => {
    expect(normalizeName("  stretch   film ")).toEqual({ ok: true, value: "STRETCH FILM" });
    expect(normalizeName("   ").ok).toBe(false);
  });
  it("slug estable sin acentos", () => {
    expect(slugify("PAPEL HIGIÉNICO")).toBe("papel-higienico");
    expect(slugify("MATERIA_PRIMA")).toBe("materia-prima");
    expect(slugify("NICO Y")).toBe("nico-y");
  });
});
