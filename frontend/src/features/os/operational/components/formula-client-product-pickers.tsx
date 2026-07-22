"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SearchCombobox, type ComboboxOption } from "@/components/ui/search-combobox";
import {
  fetchFormulaClientOptionsApi,
  fetchFormulaProductOptionsApi,
  type FormulaProductOption,
  type OrdersClientSession,
} from "@/lib/orders/orders-client";
import { normalizeSearchKey } from "@/lib/formulas/types";

export type SelectedFormulaOption = {
  productId: string;
  versionId: string;
  client: string;
  productLabel: string;
  code: string;
};

type FormulaClientProductPickersProps = {
  session: OrdersClientSession;
  client: string;
  product: string;
  enabled: boolean;
  selectedProductId: string | null;
  onClientTextChange: (client: string) => void;
  onProductTextChange: (product: string) => void;
  /** Cliente elegido (limpia producto/fórmula en el padre). */
  onClientSelected: (client: string) => void;
  /** Producto elegido inequívocamente → cargar por id. */
  onProductSelected: (option: SelectedFormulaOption) => void;
  /** Enter/blur: intentar exacto único (el padre resuelve). */
  onCommitProductText: (client: string, product: string) => void;
  statusHint?: string;
  didYouMean?: SelectedFormulaOption | null;
  onAcceptDidYouMean?: () => void;
};

export function FormulaClientProductPickers({
  session,
  client,
  product,
  enabled,
  selectedProductId,
  onClientTextChange,
  onProductTextChange,
  onClientSelected,
  onProductSelected,
  onCommitProductText,
  statusHint,
  didYouMean,
  onAcceptDidYouMean,
}: FormulaClientProductPickersProps) {
  const [clientOpts, setClientOpts] = useState<ComboboxOption[]>([]);
  const [productOpts, setProductOpts] = useState<FormulaProductOption[]>([]);
  const [clientLoading, setClientLoading] = useState(false);
  const [productLoading, setProductLoading] = useState(false);
  const [clientError, setClientError] = useState<string | null>(null);
  const [productError, setProductError] = useState<string | null>(null);
  const clientSeq = useRef(0);
  const productSeq = useRef(0);

  const loadClients = useCallback(
    async (q: string) => {
      if (!enabled) return;
      const seq = ++clientSeq.current;
      setClientLoading(true);
      setClientError(null);
      try {
        const res = await fetchFormulaClientOptionsApi(session, q);
        if (seq !== clientSeq.current) return;
        setClientOpts(
          res.clients.map((c) => ({
            id: c.client,
            label: c.client,
          }))
        );
      } catch {
        if (seq !== clientSeq.current) return;
        setClientError("No pudimos consultar el banco de fórmulas");
        setClientOpts([]);
      } finally {
        if (seq === clientSeq.current) setClientLoading(false);
      }
    },
    [enabled, session]
  );

  const loadProducts = useCallback(
    async (clientName: string, q: string) => {
      if (!enabled || !clientName.trim()) {
        setProductOpts([]);
        return;
      }
      const seq = ++productSeq.current;
      setProductLoading(true);
      setProductError(null);
      try {
        const res = await fetchFormulaProductOptionsApi(session, clientName, q);
        if (seq !== productSeq.current) return;
        setProductOpts(res.products);
      } catch {
        if (seq !== productSeq.current) return;
        setProductError("No pudimos consultar el banco de fórmulas");
        setProductOpts([]);
      } finally {
        if (seq === productSeq.current) setProductLoading(false);
      }
    },
    [enabled, session]
  );

  useEffect(() => {
    if (!enabled) return;
    const q = client.trim();
    if (!q) {
      setClientOpts([]);
      return;
    }
    const t = setTimeout(() => void loadClients(q), 180);
    return () => clearTimeout(t);
  }, [client, enabled, loadClients]);

  useEffect(() => {
    if (!enabled) return;
    const c = client.trim();
    const q = product.trim();
    if (!c || !q) {
      setProductOpts([]);
      return;
    }
    const t = setTimeout(() => void loadProducts(c, q), 180);
    return () => clearTimeout(t);
  }, [client, product, enabled, loadProducts]);

  const productComboboxOpts: ComboboxOption[] = useMemo(
    () =>
      productOpts.map((p) => ({
        id: p.productId,
        label: p.productLabel,
        secondary: p.code ? `Código ${p.code}` : undefined,
      })),
    [productOpts]
  );

  const productDisabled = !enabled || !client.trim();

  return (
    <div className="space-y-2" data-testid="formula-client-product-pickers">
      {statusHint ? (
        <p className="text-[11px] text-[var(--os-text-muted)]" role="status">
          {statusHint}
        </p>
      ) : null}
      <SearchCombobox
        label="Cliente"
        value={client}
        disabled={!enabled}
        testId="oe-client-combobox"
        options={clientOpts}
        loading={clientLoading}
        error={clientError}
        onRetry={() => void loadClients(client)}
        onChange={(v) => {
          onClientTextChange(v);
        }}
        onSelectOption={(opt) => {
          onClientSelected(opt.label);
        }}
        onCommitText={(v) => {
          const exact = clientOpts.find(
            (o) => normalizeSearchKey(o.label) === normalizeSearchKey(v)
          );
          if (exact && clientOpts.filter((o) => normalizeSearchKey(o.label) === normalizeSearchKey(v)).length === 1) {
            onClientSelected(exact.label);
          }
        }}
      />
      <SearchCombobox
        label="Producto"
        value={product}
        disabled={productDisabled}
        placeholder={
          productDisabled
            ? "Primero seleccioná un cliente"
            : "Empezá a escribir para buscar"
        }
        emptyHint={
          productDisabled
            ? "Primero seleccioná un cliente"
            : "Empezá a escribir para buscar"
        }
        testId="oe-product-combobox"
        options={productComboboxOpts}
        loading={productLoading}
        error={productError}
        onRetry={() => void loadProducts(client, product)}
        onChange={(v) => onProductTextChange(v)}
        onSelectOption={(opt) => {
          const full = productOpts.find((p) => p.productId === opt.id);
          if (!full) return;
          onProductSelected({
            productId: full.productId,
            versionId: full.versionId,
            client: full.client,
            productLabel: full.productLabel,
            code: full.code,
          });
        }}
        onCommitText={(v) => {
          if (!client.trim() || !v.trim()) return;
          // Solo exacto único vía padre (nunca fuzzy).
          const norm = normalizeSearchKey(v);
          const exactHits = productOpts.filter((p) => {
            const keys = [p.productLabel, p.code, ...p.aliases].map(normalizeSearchKey);
            return keys.includes(norm);
          });
          if (exactHits.length === 1) {
            const full = exactHits[0]!;
            onProductSelected({
              productId: full.productId,
              versionId: full.versionId,
              client: full.client,
              productLabel: full.productLabel,
              code: full.code,
            });
            return;
          }
          onCommitProductText(client, v);
        }}
      />
      {selectedProductId ? (
        <p className="text-[11px] text-emerald-800" data-testid="oe-formula-bound">
          Fórmula vinculada por selección (id seguro).
        </p>
      ) : null}
      {didYouMean && onAcceptDidYouMean ? (
        <button
          type="button"
          className="rounded border border-[var(--os-border)] bg-[var(--os-bg-muted,#f5f7fa)] px-2 py-1.5 text-left text-xs hover:bg-[var(--os-bg-muted,#eef1f4)]"
          data-testid="oe-did-you-mean"
          onClick={onAcceptDidYouMean}
        >
          ¿Quisiste decir {didYouMean.productLabel}?
        </button>
      ) : null}
    </div>
  );
}
