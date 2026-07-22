/**
 * @vitest-environment happy-dom
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import React, { useState } from "react";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SearchCombobox } from "@/components/ui/search-combobox";
import { FormulaClientProductPickers } from "@/features/os/operational/components/formula-client-product-pickers";

const fetchClients = vi.fn();
const fetchProducts = vi.fn();

vi.mock("@/lib/orders/orders-client", () => ({
  fetchFormulaClientOptionsApi: (...args: unknown[]) => fetchClients(...args),
  fetchFormulaProductOptionsApi: (...args: unknown[]) => fetchProducts(...args),
}));

describe("SearchCombobox escritura real", () => {
  afterEach(() => {
    cleanup();
  });

  it("conserva caracteres con userEvent.type y no los pisa un rerender del padre", async () => {
    const user = userEvent.setup();
    let external = "";
    const onChange = vi.fn((v: string) => {
      external = v;
    });

    function Harness({ options }: { options: { id: string; label: string }[] }) {
      const [value, setValue] = useState("");
      return (
        <SearchCombobox
          label="Cliente"
          value={value}
          onChange={(v) => {
            onChange(v);
            setValue(v);
          }}
          onSelectOption={(opt) => setValue(opt.label)}
          options={options}
          testId="oe-client-combobox"
        />
      );
    }

    const { rerender } = render(<Harness options={[]} />);
    const input = screen.getByTestId("oe-client-combobox-input") as HTMLInputElement;

    await user.click(input);
    expect(document.activeElement).toBe(input);

    await user.type(input, "u");
    expect(input.value).toBe("u");
    expect(external).toBe("u");

    rerender(<Harness options={[{ id: "UNICA", label: "UNICA" }]} />);
    expect((screen.getByTestId("oe-client-combobox-input") as HTMLInputElement).value).toBe(
      "u"
    );

    await user.type(screen.getByTestId("oe-client-combobox-input"), "ni");
    expect((screen.getByTestId("oe-client-combobox-input") as HTMLInputElement).value).toBe(
      "uni"
    );

    const list = await screen.findByTestId("oe-client-combobox-list");
    await user.click(within(list).getByText("UNICA"));
    expect((screen.getByTestId("oe-client-combobox-input") as HTMLInputElement).value).toBe(
      "UNICA"
    );
  });

  it("permite pegar, borrar y Ctrl+A sin preventDefault de letras", async () => {
    const user = userEvent.setup();
    function Harness() {
      const [value, setValue] = useState("");
      return (
        <SearchCombobox
          label="Cliente"
          value={value}
          onChange={setValue}
          onSelectOption={(o) => setValue(o.label)}
          options={[]}
          testId="oe-client-combobox"
        />
      );
    }
    render(<Harness />);
    const input = screen.getByTestId("oe-client-combobox-input") as HTMLInputElement;
    await user.click(input);
    await user.paste("UNICA");
    expect(input.value).toBe("UNICA");
    await user.keyboard("{Control>}a{/Control}{Backspace}");
    expect(input.value).toBe("");
    await user.type(input, "ab");
    expect(input.value).toBe("ab");
    await user.keyboard("{Backspace}");
    expect(input.value).toBe("a");
  });
});

describe("FormulaClientProductPickers query vs selected", () => {
  const session = { email: "produccion@test", sector: "PRODUCCION" as const };

  beforeEach(() => {
    fetchClients.mockReset();
    fetchProducts.mockReset();
    fetchClients.mockResolvedValue({
      scope: "clients",
      query: "uni",
      source: "DRIVE",
      clients: [{ client: "UNICA", rank: "exact_prefix", source: "DRIVE" }],
      persistenceReady: true,
    });
    fetchProducts.mockResolvedValue({
      scope: "products",
      query: "sham",
      client: "UNICA",
      source: "DRIVE",
      products: [
        {
          productId: "drive:1",
          versionId: "drive:1",
          driveFileId: "1",
          productLabel: "SHAMPOO SOLIDO",
          client: "UNICA",
          code: "",
          aliases: ["SHAMPOO SOLIDO"],
          rank: "exact_prefix",
          source: "DRIVE",
        },
      ],
      persistenceReady: true,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("escribe uni carácter a carácter, sobrevive respuesta async y selecciona UNICA; luego sham → SHAMPOO SOLIDO", async () => {
    const user = userEvent.setup();
    const onClientSelected = vi.fn();
    const onProductSelected = vi.fn();

    let resolveClients!: (v: unknown) => void;
    fetchClients.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveClients = resolve;
        })
    );

    render(
      <FormulaClientProductPickers
        session={session}
        client=""
        product=""
        hydrateKey="order-1"
        selectedProductId={null}
        onClientTextChange={vi.fn()}
        onProductTextChange={vi.fn()}
        onClientSelected={onClientSelected}
        onProductSelected={onProductSelected}
        onCommitProductText={vi.fn()}
      />
    );

    const clientInput = screen.getByTestId("oe-client-combobox-input") as HTMLInputElement;
    await user.click(clientInput);
    await user.type(clientInput, "u");
    expect(clientInput.value).toBe("u");
    await user.type(clientInput, "ni");
    expect(clientInput.value).toBe("uni");

    // Esperar debounce (180ms) + que el fetch pendiente registre resolveClients.
    await waitFor(() => {
      expect(typeof resolveClients).toBe("function");
    });
    expect(clientInput.value).toBe("uni");

    await act(async () => {
      resolveClients({
        scope: "clients",
        query: "uni",
        source: "DRIVE",
        clients: [{ client: "UNICA", rank: "exact_prefix", source: "DRIVE" }],
        persistenceReady: true,
      });
    });
    await waitFor(() => {
      expect(screen.getByText("UNICA")).toBeTruthy();
    });
    expect(clientInput.value).toBe("uni");

    await user.click(screen.getByText("UNICA"));
    expect(clientInput.value).toBe("UNICA");
    expect(onClientSelected).toHaveBeenCalledWith("UNICA");

    const productInput = screen.getByTestId("oe-product-combobox-input") as HTMLInputElement;
    expect(productInput.readOnly).toBe(false);
    await user.click(productInput);
    await user.type(productInput, "sham");
    expect(productInput.value).toBe("sham");

    await waitFor(() => {
      expect(screen.getByText("SHAMPOO SOLIDO")).toBeTruthy();
    });
    expect(productInput.value).toBe("sham");

    await user.click(screen.getByText("SHAMPOO SOLIDO"));
    expect(productInput.value).toBe("SHAMPOO SOLIDO");
    expect(onProductSelected).toHaveBeenCalledWith(
      expect.objectContaining({ productLabel: "SHAMPOO SOLIDO", client: "UNICA" })
    );
  });

  it("no sobrescribe edición manual cuando el padre re-renderiza client/product de la OE", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <FormulaClientProductPickers
        session={session}
        client=""
        product=""
        hydrateKey="order-1"
        selectedProductId={null}
        onClientTextChange={vi.fn()}
        onProductTextChange={vi.fn()}
        onClientSelected={vi.fn()}
        onProductSelected={vi.fn()}
        onCommitProductText={vi.fn()}
      />
    );
    const input = screen.getByTestId("oe-client-combobox-input") as HTMLInputElement;
    await user.type(input, "uni");
    expect(input.value).toBe("uni");

    rerender(
      <FormulaClientProductPickers
        session={session}
        client=""
        product=""
        hydrateKey="order-1"
        selectedProductId={null}
        onClientTextChange={vi.fn()}
        onProductTextChange={vi.fn()}
        onClientSelected={vi.fn()}
        onProductSelected={vi.fn()}
        onCommitProductText={vi.fn()}
      />
    );
    expect((screen.getByTestId("oe-client-combobox-input") as HTMLInputElement).value).toBe(
      "uni"
    );
  });

  it("cambiar cliente seleccionado limpia producto una vez", async () => {
    const user = userEvent.setup();
    fetchClients.mockResolvedValue({
      scope: "clients",
      query: "a",
      source: "DRIVE",
      clients: [
        { client: "UNICA", rank: "exact_prefix", source: "DRIVE" },
        { client: "ACME", rank: "contains", source: "DRIVE" },
      ],
      persistenceReady: true,
    });

    render(
      <FormulaClientProductPickers
        session={session}
        client="UNICA"
        product="SHAMPOO SOLIDO"
        hydrateKey="order-2"
        selectedProductId="drive:1"
        onClientTextChange={vi.fn()}
        onProductTextChange={vi.fn()}
        onClientSelected={vi.fn()}
        onProductSelected={vi.fn()}
        onCommitProductText={vi.fn()}
      />
    );

    expect((screen.getByTestId("oe-client-combobox-input") as HTMLInputElement).value).toBe(
      "UNICA"
    );
    expect((screen.getByTestId("oe-product-combobox-input") as HTMLInputElement).value).toBe(
      "SHAMPOO SOLIDO"
    );

    const clientInput = screen.getByTestId("oe-client-combobox-input");
    await user.clear(clientInput);
    await user.type(clientInput, "a");
    await waitFor(() => expect(screen.getByText("ACME")).toBeTruthy());
    await user.click(screen.getByText("ACME"));

    expect((screen.getByTestId("oe-client-combobox-input") as HTMLInputElement).value).toBe(
      "ACME"
    );
    expect((screen.getByTestId("oe-product-combobox-input") as HTMLInputElement).value).toBe("");
  });

  it("muestra error de Drive y Reintentar sin borrar el texto", async () => {
    const user = userEvent.setup();
    fetchClients.mockRejectedValue(new Error("Drive down"));
    render(
      <FormulaClientProductPickers
        session={session}
        client=""
        product=""
        hydrateKey="order-err"
        selectedProductId={null}
        onClientTextChange={vi.fn()}
        onProductTextChange={vi.fn()}
        onClientSelected={vi.fn()}
        onProductSelected={vi.fn()}
        onCommitProductText={vi.fn()}
      />
    );
    const input = screen.getByTestId("oe-client-combobox-input") as HTMLInputElement;
    await user.type(input, "uni");
    await waitFor(() => {
      expect(screen.getByTestId("oe-client-combobox-error")).toBeTruthy();
    });
    expect(input.value).toBe("uni");
    expect(screen.getByTestId("oe-client-combobox-retry")).toBeTruthy();
  });
});

// silence unused React default import if tree-shaken oddly
void React;
