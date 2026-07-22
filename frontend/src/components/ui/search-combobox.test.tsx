/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SearchCombobox } from "@/components/ui/search-combobox";

describe("SearchCombobox editable input", () => {
  it("renderiza <input type=text> editable (no disabled/readonly por defecto)", () => {
    const html = renderToStaticMarkup(
      <SearchCombobox
        label="Cliente"
        value="uni"
        onChange={() => {}}
        onSelectOption={() => {}}
        options={[{ id: "UNICA", label: "UNICA" }]}
        testId="oe-client-combobox"
      />
    );
    expect(html).toContain('type="text"');
    expect(html).toContain('data-testid="oe-client-combobox-input"');
    expect(html).not.toContain("disabled=");
    expect(html).not.toContain("readOnly");
    expect(html).toContain('value="uni"');
    expect(html).toContain("role=\"combobox\"");
  });

  it("readOnly solo cuando se pide explícitamente", () => {
    const html = renderToStaticMarkup(
      <SearchCombobox
        label="Producto"
        value=""
        readOnly
        onChange={() => {}}
        onSelectOption={() => {}}
        options={[]}
        testId="oe-product-combobox"
      />
    );
    expect(html).toContain("readOnly");
  });
});
