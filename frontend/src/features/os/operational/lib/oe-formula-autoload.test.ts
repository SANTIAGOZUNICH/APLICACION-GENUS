import { describe, expect, it } from "vitest";
import {
  applyFormulaResolveToOe,
  formulaIdentityKey,
  needsReplaceConfirmation,
  oeHasFormulaContent,
  statusMessage,
} from "./oe-formula-autoload";
import { createEmptyOeContent, recomputeOeDerived } from "@/lib/orders/content";

describe("oe-formula-autoload", () => {
  it("normaliza acentos/mayúsculas en la identidad", () => {
    expect(formulaIdentityKey("Única", "Shampoo Sólido")).toBe(
      formulaIdentityKey("unica", "SHAMPOO SOLIDO")
    );
  });

  it("carga automática exacta aplica materias y procedimiento; kg queda null sin cantidad", () => {
    const empty = createEmptyOeContent({
      productName: "SHAMPOO SOLIDO",
      client: "UNICA",
    });
    const applied = applyFormulaResolveToOe(empty, {
      found: true,
      snapshot: {
        formulaProductId: "fp",
        formulaVersionId: "fv",
        versionHash: "hash",
      },
      materials: [
        { materiaPrima: "A", codigo: "1", formulaPct: 40 },
        { materiaPrima: "B", codigo: "2", formulaPct: 60 },
      ],
      procedureSteps: [{ id: "s1", text: "Mezclar" }],
    });
    expect(applied).not.toBeNull();
    expect(applied!.content.materials).toHaveLength(2);
    expect(applied!.content.materials.every((m) => m.kgAPesar == null)).toBe(true);
    expect(applied!.content.header.quantityKg).toBeNull();
    expect(applied!.content.procedureSteps[0]?.text).toBe("Mezclar");
    expect(applied!.formulaVersionId).toBe("fv");
  });

  it("fórmula no encontrada / conflicto / error tienen mensajes claros", () => {
    expect(statusMessage("not_found")).toMatch(/completar manualmente/i);
    expect(statusMessage("conflict")).toMatch(/no se eligió/i);
    expect(statusMessage("error")).toMatch(/No se pudo consultar/i);
    expect(statusMessage("searching")).toMatch(/Buscando/i);
    expect(statusMessage("found")).toMatch(/cargada/i);
  });

  it("no sobrescribe sin confirmación si ya hay edición manual", () => {
    const withEdit = createEmptyOeContent();
    withEdit.materials = [
      {
        ...withEdit.materials[0]!,
        materiaPrima: "Editado a mano",
        formulaPct: 10,
      },
    ];
    expect(oeHasFormulaContent(withEdit)).toBe(true);
    expect(
      needsReplaceConfirmation({
        previousIdentity: formulaIdentityKey("A", "P1"),
        nextIdentity: formulaIdentityKey("B", "P2"),
        hasContent: true,
      })
    ).toBe(true);
    expect(
      needsReplaceConfirmation({
        previousIdentity: null,
        nextIdentity: formulaIdentityKey("A", "P"),
        hasContent: false,
      })
    ).toBe(false);
  });

  it("snapshot estable: ids de versión se conservan al aplicar", () => {
    const empty = createEmptyOeContent();
    const a = applyFormulaResolveToOe(empty, {
      found: true,
      snapshot: {
        formulaProductId: "p1",
        formulaVersionId: "v1",
        versionHash: "h1",
      },
      materials: [{ materiaPrima: "A", codigo: "", formulaPct: 100 }],
      procedureSteps: [],
    });
    const b = applyFormulaResolveToOe(a!.content, {
      found: true,
      snapshot: {
        formulaProductId: "p1",
        formulaVersionId: "v1",
        versionHash: "h1",
      },
      materials: [{ materiaPrima: "A", codigo: "", formulaPct: 100 }],
      procedureSteps: [],
    });
    expect(a!.formulaVersionHash).toBe("h1");
    expect(b!.formulaVersionHash).toBe("h1");
    expect(b!.formulaVersionId).toBe(a!.formulaVersionId);
  });

  it("cálculo 100 y 250 kg desde % (nunca kg fijos del Excel)", () => {
    const empty = createEmptyOeContent();
    const applied = applyFormulaResolveToOe(empty, {
      found: true,
      snapshot: {
        formulaProductId: "p",
        formulaVersionId: "v",
        versionHash: "h",
      },
      materials: [
        { materiaPrima: "A", codigo: "", formulaPct: 40 },
        { materiaPrima: "B", codigo: "", formulaPct: 60 },
      ],
      procedureSteps: [],
    })!;
    const at100 = recomputeOeDerived({
      ...applied.content,
      header: { ...applied.content.header, quantityKg: 100 },
    });
    const at250 = recomputeOeDerived({
      ...applied.content,
      header: { ...applied.content.header, quantityKg: 250 },
    });
    expect(at100.materials[0]?.kgAPesar).toBe(40);
    expect(at100.materials[1]?.kgAPesar).toBe(60);
    expect(at250.materials[0]?.kgAPesar).toBe(100);
    expect(at250.materials[1]?.kgAPesar).toBe(150);
  });

  it("error de DB se modela como status error (no silencioso)", () => {
    expect(statusMessage("error").length).toBeGreaterThan(10);
    const failedPayload = {
      found: false,
      error: "DATABASE_URL no configurada",
      persistenceReady: false,
    };
    expect(applyFormulaResolveToOe(createEmptyOeContent(), failedPayload)).toBeNull();
  });
});
