import { describe, expect, it } from "vitest";
import {
  clienteRelation,
  computeLoteVtoWarning,
  detectLoteVtoInconsistency,
  findAsignacionLoteByIdForWorkItem,
  productoRelation,
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
      matchTier: "EXACTO",
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
    expect(
      computeLoteVtoWarning({ status: "found", matchTier: "EXACTO", candidate: { ...lote({ id: "x" }) } })
    ).toBe("NONE");
  });

  it("Test 3: found sin vto -> MISSING_VTO", () => {
    const candidate = { ...lote({ id: "x" }), vto: null };
    expect(computeLoteVtoWarning({ status: "found", matchTier: "EXACTO", candidate })).toBe("MISSING_VTO");
  });

  it("Test 4: found sin lote -> MISSING_LOTE", () => {
    const candidate = { ...lote({ id: "x" }), lote: "" };
    expect(computeLoteVtoWarning({ status: "found", matchTier: "EXACTO", candidate })).toBe("MISSING_LOTE");
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

// Caso real reproducido en Production (ver auditoría de solo lectura):
//   Asignación de Lotes: marca="ROSEHIP-ECODERM", producto="SERUM", codigo="VITAMINA C"
//   Pedido de Producción: cliente="ECODERM", producto="SERUM VITAMINA C ROSEHIP"
// El match exacto normalizado por cliente+producto no encontraba nada:
// "ECODERM" !== "ROSEHIP-ECODERM" y "SERUM" !== "SERUM VITAMINA C ROSEHIP".
describe("resolveAsignacionLoteForWorkItem — Test 12 real: caso ECODERM / ROSEHIP", () => {
  it("SERUM VITAMINA C ROSEHIP -> encuentra la asignación marca=ROSEHIP-ECODERM producto=SERUM codigo=VITAMINA C", () => {
    const candidates = [
      lote({
        id: "al-serum",
        marca: "ROSEHIP-ECODERM",
        producto: "SERUM",
        codigo: "VITAMINA C",
        lote: "S26018",
        vto: null,
      }),
    ];
    const result = resolveAsignacionLoteForWorkItem(candidates, {
      cliente: "ECODERM",
      producto: "SERUM VITAMINA C ROSEHIP",
    });
    expect(result).toMatchObject({ status: "found", matchTier: "COMPATIBLE", candidate: { id: "al-serum", lote: "S26018" } });
  });

  it("CREMA FACIAL HIALURONICO ROSEHIP -> encuentra la asignación marca=ROSEHIP-ECODERM producto=CREMA FACIAL CON ACIDO HIALURONICO", () => {
    const candidates = [
      lote({
        id: "al-crema",
        marca: "ROSEHIP-ECODERM",
        producto: "CREMA FACIAL CON ACIDO HIALURONICO",
        codigo: "",
        lote: "S26017",
        vto: null,
      }),
    ];
    const result = resolveAsignacionLoteForWorkItem(candidates, {
      cliente: "ECODERM",
      producto: "CREMA FACIAL HIALURONICO ROSEHIP",
    });
    expect(result).toMatchObject({ status: "found", matchTier: "COMPATIBLE", candidate: { id: "al-crema" } });
  });

  it("no confunde el resto de la familia ECODERM (DESODORANTE/ACONDICIONADOR/etc.) con el pedido ROSEHIP", () => {
    const candidates = [
      lote({ id: "al-serum", marca: "ROSEHIP-ECODERM", producto: "SERUM", codigo: "VITAMINA C" }),
      lote({ id: "al-desodorante", marca: "ECODERM", producto: "DESODORANTE", codigo: "" }),
      lote({ id: "al-acond", marca: "ECODERM - DUGA", producto: "ACONDICIONADOR", codigo: "INFANTIL" }),
    ];
    const result = resolveAsignacionLoteForWorkItem(candidates, {
      cliente: "ECODERM",
      producto: "SERUM VITAMINA C ROSEHIP",
    });
    expect(result).toMatchObject({ status: "found", candidate: { id: "al-serum" } });
  });
});

describe("clienteRelation — tolerancia de submarca compuesta (no fuzzy)", () => {
  it("cliente exacto -> EXACT", () => {
    expect(clienteRelation("ECODERM", "ECODERM")).toBe("EXACT");
  });
  it("submarca compuesta con el cliente como token -> TOKEN_SUBSET", () => {
    expect(clienteRelation("ECODERM", "ROSEHIP-ECODERM")).toBe("TOKEN_SUBSET");
    expect(clienteRelation("ECODERM", "ECODERM - DUGA")).toBe("TOKEN_SUBSET");
    expect(clienteRelation("ECODERM", "ECODERM/WENEAR")).toBe("TOKEN_SUBSET");
  });
  it("clientes sin ningún token en común -> NONE (nunca fuzzy global)", () => {
    expect(clienteRelation("ECODERM", "NIZA")).toBe("NONE");
  });
});

describe("productoRelation — matriz de tolerancia de nombre de producto", () => {
  const base = { producto: "", codigo: "", marca: "NIZA" };

  it("producto idéntico -> EXACT", () => {
    expect(productoRelation({ ...base, producto: "CREMA ROSEHIP" }, "CREMA ROSEHIP")).toBe("EXACT");
  });
  it("mayúsculas/minúsculas -> EXACT", () => {
    expect(productoRelation({ ...base, producto: "crema rosehip" }, "CREMA ROSEHIP")).toBe("EXACT");
  });
  it("tildes -> EXACT", () => {
    expect(productoRelation({ ...base, producto: "SÉRUM" }, "SERUM")).toBe("EXACT");
  });
  it("guiones -> EXACT (\"CREMA - ROSEHIP\" vs \"CREMA ROSEHIP\")", () => {
    expect(productoRelation({ ...base, producto: "CREMA - ROSEHIP" }, "CREMA ROSEHIP")).toBe("EXACT");
  });
  it("espacios dobles -> EXACT", () => {
    expect(productoRelation({ ...base, producto: "CREMA   ROSEHIP" }, "CREMA ROSEHIP")).toBe("EXACT");
  });
  it("ROSE HIP vs ROSEHIP (junto/separado) -> EXACT", () => {
    expect(productoRelation({ ...base, producto: "CREMA ROSE HIP" }, "CREMA ROSEHIP")).toBe("EXACT");
  });
  it("diferencia menor no ambigua (ACIDO HIALURONICO vs HIALURONICO) -> CONTAINED", () => {
    expect(
      productoRelation({ ...base, producto: "CREMA FACIAL CON ACIDO HIALURONICO" }, "CREMA FACIAL HIALURONICO")
    ).toBe("CONTAINED");
  });
  it("mismo producto, otro cliente -> productoRelation no filtra cliente (eso lo hace resolveAsignacionLoteForWorkItem)", () => {
    expect(productoRelation({ ...base, producto: "CREMA" }, "CREMA")).toBe("EXACT");
  });
  it("productos parecidos, mismo cliente, NO deben confundirse (CREMA ROSEHIP vs SERUM ROSEHIP)", () => {
    expect(productoRelation({ ...base, producto: "CREMA ROSEHIP" }, "SERUM ROSEHIP")).toBe("NONE");
  });
  it("dos presentaciones distintas (50G vs 100G) no se distinguen por texto -> ambas CONTAINED (la unicidad la exige el resolver, no esta función)", () => {
    expect(productoRelation({ ...base, producto: "CREMA ROSEHIP 50G" }, "CREMA ROSEHIP")).toBe("CONTAINED");
  });
  it("talle/cantidad no cambia el resultado (ALISADO KERATIN 1KG vs ALISADO KERATIN)", () => {
    expect(productoRelation({ ...base, producto: "ALISADO KERATIN" }, "ALISADO KERATIN 1KG")).toBe("CONTAINED");
  });
  it("una palabra extra NO explicada por marca/talle se trata como variante real y NO matchea (AFTER SHAVE vs AFTER SHAVE VIOLETA)", () => {
    expect(productoRelation({ ...base, producto: "AFTER SHAVE" }, "AFTER SHAVE VIOLETA")).toBe("NONE");
  });
  it("sin candidato (bolsas vacías) -> NONE", () => {
    expect(productoRelation({ ...base, producto: "" }, "CREMA")).toBe("NONE");
  });
  it("candidato de una sola palabra genérica sin código -> NONE (evita match por una palabra suelta)", () => {
    expect(productoRelation({ ...base, producto: "SERUM", codigo: "" }, "SERUM ROSEHIP")).toBe("NONE");
  });
});

describe("resolveAsignacionLoteForWorkItem — matriz completa (sección 13 del pedido)", () => {
  it("dos lotes candidatos con presentaciones distintas -> ambiguous, nunca se elige solo", () => {
    const candidates = [
      lote({ id: "al-50g", producto: "CREMA ROSEHIP 50G" }),
      lote({ id: "al-100g", producto: "CREMA ROSEHIP 100G" }),
    ];
    const result = resolveAsignacionLoteForWorkItem(candidates, { cliente: "NIZA", producto: "CREMA ROSEHIP" });
    expect(result.status).toBe("ambiguous");
  });

  it("candidato claramente superior (EXACTO) gana aunque exista otro COMPATIBLE", () => {
    const candidates = [
      lote({ id: "al-exacto", producto: "CREMA ROSEHIP" }),
      lote({ id: "al-compatible", producto: "CREMA ROSEHIP 50G" }),
    ];
    const result = resolveAsignacionLoteForWorkItem(candidates, { cliente: "NIZA", producto: "CREMA ROSEHIP" });
    expect(result).toMatchObject({ status: "found", matchTier: "EXACTO", candidate: { id: "al-exacto" } });
  });

  it("lote sin VTO -> found con warning MISSING_VTO (no bloquea)", () => {
    const candidates = [lote({ id: "al-1", vto: null })];
    const result = resolveAsignacionLoteForWorkItem(candidates, { cliente: "NIZA", producto: "SERUM NIACINAMIDA" });
    expect(result).toMatchObject({ status: "found" });
    expect(computeLoteVtoWarning(result)).toBe("MISSING_VTO");
  });

  it("VTO sin lote -> found con warning MISSING_LOTE (no bloquea)", () => {
    const candidates = [lote({ id: "al-1", lote: "" })];
    const result = resolveAsignacionLoteForWorkItem(candidates, { cliente: "NIZA", producto: "SERUM NIACINAMIDA" });
    expect(result).toMatchObject({ status: "found" });
    expect(computeLoteVtoWarning(result)).toBe("MISSING_LOTE");
  });
});

describe("detectLoteVtoInconsistency — sección 11: nunca sobreescribe, solo señala", () => {
  it("WorkItem sin lote/vto propio -> null (ese caso lo resuelve el sync retroactivo, no esto)", () => {
    const result = resolveAsignacionLoteForWorkItem([lote({ id: "al-1" })], {
      cliente: "NIZA",
      producto: "SERUM NIACINAMIDA",
    });
    expect(detectLoteVtoInconsistency({ packagingLote: null, packagingVto: null }, result)).toBeNull();
  });

  it("WorkItem con el mismo lote/vto encontrado -> null (no hay inconsistencia)", () => {
    const result = resolveAsignacionLoteForWorkItem([lote({ id: "al-1", lote: "G26043", vto: "2028-10" })], {
      cliente: "NIZA",
      producto: "SERUM NIACINAMIDA",
    });
    expect(
      detectLoteVtoInconsistency({ packagingLote: "G26043", packagingVto: "2028-10" }, result)
    ).toBeNull();
  });

  it("WorkItem con un lote DISTINTO al encontrado -> reporta inconsistencia sin sugerir sobreescritura", () => {
    const result = resolveAsignacionLoteForWorkItem([lote({ id: "al-1", lote: "G26043", vto: "2028-10" })], {
      cliente: "NIZA",
      producto: "SERUM NIACINAMIDA",
    });
    const inconsistency = detectLoteVtoInconsistency(
      { packagingLote: "G26050", packagingVto: "2028-11" },
      result
    );
    expect(inconsistency).toEqual({
      currentLote: "G26050",
      currentVto: "2028-11",
      foundLote: "G26043",
      foundVto: "2028-10",
      asignacionLoteId: "al-1",
    });
  });

  it("resolución ambigua o sin match -> null (no hay un único candidato con el que comparar)", () => {
    const ambiguous = resolveAsignacionLoteForWorkItem(
      [lote({ id: "al-1" }), lote({ id: "al-2", lote: "G26044" })],
      { cliente: "NIZA", producto: "SERUM NIACINAMIDA" }
    );
    expect(detectLoteVtoInconsistency({ packagingLote: "G26050", packagingVto: "2028-11" }, ambiguous)).toBeNull();
    const none = resolveAsignacionLoteForWorkItem([], { cliente: "NIZA", producto: "SERUM NIACINAMIDA" });
    expect(detectLoteVtoInconsistency({ packagingLote: "G26050", packagingVto: "2028-11" }, none)).toBeNull();
  });
});
