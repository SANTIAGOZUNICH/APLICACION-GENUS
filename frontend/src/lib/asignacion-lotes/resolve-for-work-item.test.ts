import { describe, expect, it } from "vitest";
import {
  computeLoteVtoWarning,
  findAsignacionLoteByIdForWorkItem,
  resolveAsignacionLoteForWorkItem,
} from "./resolve-for-work-item";
import type { AsignacionLote } from "./types";

function lote(overrides: Partial<AsignacionLote> & Pick<AsignacionLote, "id">): AsignacionLote {
  return {
    lote: "G26043",
    fecha: "2026-09-10",
    producto: "SERUM NIACINAMIDA",
    codigo: "",
    marca: "NIZA",
    cantidades: 1200,
    vto: "2028-10",
    muestras: "",
    cjMuestra: "",
    fechaAnalisis: null,
    observaciones: "",
    createdAt: "2026-09-10T00:00:00.000Z",
    createdBy: "calidad@test.com",
    updatedAt: "2026-09-10T00:00:00.000Z",
    updatedBy: "calidad@test.com",
    archived: false,
    ...overrides,
  };
}

describe("resolveAsignacionLoteForWorkItem — Test 6: matching por cliente/producto", () => {
  it("una única coincidencia activa -> found", () => {
    const candidates = [lote({ id: "al-1" })];
    const result = resolveAsignacionLoteForWorkItem(candidates, {
      cliente: "NIZA",
      producto: "SERUM NIACINAMIDA",
    });
    expect(result).toEqual({
      status: "found",
      candidate: {
        id: "al-1",
        lote: "G26043",
        vto: "2028-10",
        producto: "SERUM NIACINAMIDA",
        marca: "NIZA",
        codigo: "",
        cantidades: 1200,
        fecha: "2026-09-10",
      },
    });
  });

  it("normaliza tildes/mayúsculas/espacios sin fuzzy matching", () => {
    const candidates = [lote({ id: "al-1", marca: "Niza", producto: "  Sérum  Niacinamida " })];
    const result = resolveAsignacionLoteForWorkItem(candidates, {
      cliente: "niza",
      producto: "serum niacinamida",
    });
    expect(result.status).toBe("found");
  });

  it("Test 7: mismo nombre de producto para clientes distintos nunca cruza lotes", () => {
    const candidates = [
      lote({ id: "al-niza", marca: "NIZA", producto: "CREMA" }),
      lote({ id: "al-cosmec", marca: "COSMECEUTICALS", producto: "CREMA", lote: "E25114" }),
    ];
    const forNiza = resolveAsignacionLoteForWorkItem(candidates, { cliente: "NIZA", producto: "CREMA" });
    expect(forNiza).toMatchObject({ status: "found", candidate: { id: "al-niza" } });

    const forCosmec = resolveAsignacionLoteForWorkItem(candidates, {
      cliente: "COSMECEUTICALS",
      producto: "CREMA",
    });
    expect(forCosmec).toMatchObject({ status: "found", candidate: { id: "al-cosmec" } });
  });
});

describe("resolveAsignacionLoteForWorkItem — Test 2: sin asignación", () => {
  it("sin coincidencias -> none", () => {
    const result = resolveAsignacionLoteForWorkItem([], { cliente: "NIZA", producto: "SERUM" });
    expect(result).toEqual({ status: "none" });
  });

  it("solo hay coincidencias archivadas -> none (nunca resuelve contra lo archivado)", () => {
    const candidates = [lote({ id: "al-1", archived: true })];
    const result = resolveAsignacionLoteForWorkItem(candidates, {
      cliente: "NIZA",
      producto: "SERUM NIACINAMIDA",
    });
    expect(result).toEqual({ status: "none" });
  });

  it("cliente o producto vacíos -> none, nunca intenta adivinar", () => {
    expect(resolveAsignacionLoteForWorkItem([lote({ id: "al-1" })], { cliente: "", producto: "SERUM" })).toEqual({
      status: "none",
    });
    expect(resolveAsignacionLoteForWorkItem([lote({ id: "al-1" })], { cliente: "NIZA", producto: "" })).toEqual({
      status: "none",
    });
  });
});

describe("resolveAsignacionLoteForWorkItem — Test 5: más de una coincidencia -> ambiguous", () => {
  it("dos lotes activos para el mismo cliente+producto nunca se eligen automáticamente", () => {
    const candidates = [
      lote({ id: "al-1", lote: "G26043", vto: "2028-10" }),
      lote({ id: "al-2", lote: "G26044", vto: "2028-11" }),
    ];
    const result = resolveAsignacionLoteForWorkItem(candidates, {
      cliente: "NIZA",
      producto: "SERUM NIACINAMIDA",
    });
    expect(result.status).toBe("ambiguous");
    if (result.status === "ambiguous") {
      expect(result.candidates.map((c) => c.id).sort()).toEqual(["al-1", "al-2"]);
    }
  });
});

describe("computeLoteVtoWarning — warnings no bloqueantes (Test 3/4)", () => {
  it("found con lote y vto completos -> NONE", () => {
    expect(computeLoteVtoWarning({ status: "found", candidate: { ...lote({ id: "x" }) } })).toBe("NONE");
  });

  it("Test 3: found sin vto -> MISSING_VTO", () => {
    const candidate = { ...lote({ id: "x" }), vto: null };
    expect(computeLoteVtoWarning({ status: "found", candidate })).toBe("MISSING_VTO");
  });

  it("Test 4: found sin lote -> MISSING_LOTE", () => {
    const candidate = { ...lote({ id: "x" }), lote: "" };
    expect(computeLoteVtoWarning({ status: "found", candidate })).toBe("MISSING_LOTE");
  });

  it("none -> MISSING_LOTE_AND_VTO", () => {
    expect(computeLoteVtoWarning({ status: "none" })).toBe("MISSING_LOTE_AND_VTO");
  });

  it("ambiguous -> AMBIGUOUS", () => {
    expect(computeLoteVtoWarning({ status: "ambiguous", candidates: [] })).toBe("AMBIGUOUS");
  });
});

describe("findAsignacionLoteByIdForWorkItem — releer antes de persistir (Test 8)", () => {
  it("encuentra la fila elegida y devuelve su valor ACTUAL, no un snapshot viejo", () => {
    const candidates = [lote({ id: "al-1", lote: "G26043", vto: "2028-10" })];
    const found = findAsignacionLoteByIdForWorkItem(candidates, "al-1", {
      cliente: "NIZA",
      producto: "SERUM NIACINAMIDA",
    });
    expect(found).toMatchObject({ id: "al-1", lote: "G26043", vto: "2028-10" });
  });

  it("si la fila fue archivada mientras el diálogo estaba abierto, ya no se resuelve", () => {
    const candidates = [lote({ id: "al-1", archived: true })];
    const found = findAsignacionLoteByIdForWorkItem(candidates, "al-1", {
      cliente: "NIZA",
      producto: "SERUM NIACINAMIDA",
    });
    expect(found).toBeNull();
  });

  it("si cliente/producto ya no coinciden (se editó la fila a otro producto), no se resuelve", () => {
    const candidates = [lote({ id: "al-1", producto: "OTRO PRODUCTO" })];
    const found = findAsignacionLoteByIdForWorkItem(candidates, "al-1", {
      cliente: "NIZA",
      producto: "SERUM NIACINAMIDA",
    });
    expect(found).toBeNull();
  });
});
