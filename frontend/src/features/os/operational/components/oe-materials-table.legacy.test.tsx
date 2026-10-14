/**
 * @vitest-environment happy-dom
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Regresión (Production, tablet Samsung): abrir una OE guardada ANTES de CÓDIGO MP / KG REAL / lotes adicionales
// mostraba «This page couldn't load», porque la tabla hacía `m.codigoMp.trim()` sobre `undefined`.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/orders/orders-client", () => ({ fetchMpCatalogApi: () => Promise.resolve([]) }));

import { hydrateOrderContent, createEmptyOeContent } from "@/lib/orders/content";
import type { OeContent } from "@/lib/orders/types";
import { OeMaterialsTable } from "./oe-materials-table";

afterEach(cleanup);

/** Material como lo guardaban las OE anteriores: sin codigoMp, kgReal, parentRowId, ajusteMotivo ni lote. */
function legacyContent(): OeContent {
  const c = createEmptyOeContent();
  c.materials = [
    { id: "m1", materiaPrima: "AGUA", codigo: "A-1", formulaPct: 100, kgAPesar: 25 },
    { id: "m2", materiaPrima: "GLICERINA", codigo: "G-1", formulaPct: 5, kgAPesar: 1.25, ajuste: 0.2 },
  ] as unknown as OeContent["materials"];
  return c;
}

describe("OE guardada antes de CÓDIGO MP / KG REAL", () => {
  it("la tabla de materias primas se muestra sin lanzar excepción", () => {
    expect(() =>
      render(
        <OeMaterialsTable content={legacyContent()} onChange={() => {}} formulaLocked={false} opsLocked={false} canEditCodigoMp session={null} onRemoveMaterial={() => {}} />
      )
    ).not.toThrow();
    expect(screen.getAllByTestId("oe-row")).toHaveLength(2);
  });

  it("hydrateOrderContent completa los campos faltantes sin tocar los valores existentes ni recalcular", () => {
    const h = hydrateOrderContent(legacyContent());
    const [a, g] = h.materials;
    expect(a).toMatchObject({ codigoMp: "", lote: "", ajusteMotivo: "", parentRowId: null, kgReal: null, kgAPesar: 25, formulaPct: 100 });
    // Un ajuste medido antes de KG REAL se conserva como kg reales (kg a pesar + ajuste), como ya hacía la migración.
    expect(g).toMatchObject({ kgAPesar: 1.25, ajuste: 0.2, kgReal: 1.45 });
  });

  it("es idempotente y no toca OA", () => {
    const once = hydrateOrderContent(legacyContent());
    expect(hydrateOrderContent(once)).toEqual(once);
  });
});
