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
  source?: "DRIVE" | "CACHE_NEON";
  driveFileId?: string;
};

type FormulaClientProductPickersProps = {
  session: OrdersClientSession;
  /** Valores de la OE (solo para hidratar). */
  client: string;
  product: string;
  /** Cambia al abrir otra OE / diálogo; dispara hidratación. */
  hydrateKey?: string;
  /** Permite editar los inputs (solo lectura del formulario). */
  readOnly?: boolean;
  /** Si false, no se consultan sugerencias (p.ej. sin red) pero se puede escribir. */
  suggestionsEnabled?: boolean;
  selectedProductId: string | null;
  onClientTextChange: (client: string) => void;
  onProductTextChange: (product: string) => void;
  onClientSelected: (client: string) => void;
  onProductSelected: (option: SelectedFormulaOption) => void;
  onCommitProductText: (client: string, product: string) => void;
  onClearClient?: () => void;
  onClearProduct?: () => void;
  statusHint?: string;
  didYouMean?: SelectedFormulaOption | null;
  onAcceptDidYouMean?: () => void;
};

export function FormulaClientProductPickers({
  session,
  client,
  product,
  hydrateKey = "",
  readOnly = false,
  suggestionsEnabled = true,
  selectedProductId,
  onClientTextChange,
  onProductTextChange,
  onClientSelected,
  onProductSelected,
  onCommitProductText,
  onClearClient,
  onClearProduct,
  statusHint,
  didYouMean,
  onAcceptDidYouMean,
}: FormulaClientProductPickersProps) {
  // Texto visible del input — independiente de la selección y de respuestas async.
  const [clientQuery, setClientQuery] = useState(client);
  const [selectedClient, setSelectedClient] = useState<string | null>(
    client.trim() ? client : null
  );
  const [productQuery, setProductQuery] = useState(product);
  const [selectedProduct, setSelectedProduct] = useState<SelectedFormulaOption | null>(null);

  const [clientOpts, setClientOpts] = useState<ComboboxOption[]>([]);
  const [productOpts, setProductOpts] = useState<FormulaProductOption[]>([]);
  const [clientLoading, setClientLoading] = useState(false);
  const [productLoading, setProductLoading] = useState(false);
  const [clientError, setClientError] = useState<string | null>(null);
  const [productError, setProductError] = useState<string | null>(null);
  const clientSeq = useRef(0);
  const productSeq = useRef(0);
  const editingClientRef = useRef(false);
  const editingProductRef = useRef(false);
  const prevHydrateKey = useRef<string | null>(null);

  // Hidratar solo al cambiar orderId / abrir, o mientras el usuario no editó.
  useEffect(() => {
    const keyChanged = prevHydrateKey.current !== hydrateKey;
    if (keyChanged) {
      prevHydrateKey.current = hydrateKey;
      editingClientRef.current = false;
      editingProductRef.current = false;
      setClientQuery(client);
      setSelectedClient(client.trim() ? client : null);
      setProductQuery(product);
      setSelectedProduct(null);
      setClientOpts([]);
      setProductOpts([]);
      return;
    }
    if (!editingClientRef.current) {
      setClientQuery(client);
      if (client.trim()) setSelectedClient(client);
    }
    if (!editingProductRef.current) {
      setProductQuery(product);
    }
  }, [hydrateKey, client, product]);

  const canSuggest = suggestionsEnabled && !readOnly;
  const productNeedsClient = !clientQuery.trim();

  const clearProductLocal = useCallback(() => {
    editingProductRef.current = true;
    setProductQuery("");
    setSelectedProduct(null);
    setProductOpts([]);
    onProductTextChange("");
    onClearProduct?.();
  }, [onClearProduct, onProductTextChange]);

  const loadClients = useCallback(
    async (q: string) => {
      if (!canSuggest) return;
      const seq = ++clientSeq.current;
      setClientLoading(true);
      setClientError(null);
      try {
        const res = await fetchFormulaClientOptionsApi(session, q);
        if (seq !== clientSeq.current) return;
        if (res.persistenceReady === false) {
          setClientError("No pudimos cargar las sugerencias — Reintentar");
          setClientOpts([]);
          return;
        }
        if (res.driveError) {
          setClientError(
            `Drive: ${res.driveError}. Mostrando respaldo. — Reintentar`
          );
        }
        // Solo suggestions — nunca el texto escrito.
        setClientOpts(
          res.clients.map((c) => ({
            id: c.client,
            label: c.client,
            secondary: c.source === "CACHE_NEON" ? "cache" : undefined,
          }))
        );
      } catch {
        if (seq !== clientSeq.current) return;
        setClientError("No pudimos cargar las sugerencias — Reintentar");
        setClientOpts([]);
      } finally {
        if (seq === clientSeq.current) setClientLoading(false);
      }
    },
    [canSuggest, session]
  );

  const loadProducts = useCallback(
    async (clientName: string, q: string) => {
      if (!canSuggest || !clientName.trim()) {
        setProductOpts([]);
        return;
      }
      const seq = ++productSeq.current;
      setProductLoading(true);
      setProductError(null);
      try {
        const res = await fetchFormulaProductOptionsApi(session, clientName, q);
        if (seq !== productSeq.current) return;
        if (res.persistenceReady === false) {
          setProductError("No pudimos cargar las sugerencias — Reintentar");
          setProductOpts([]);
          return;
        }
        if (res.driveError) {
          setProductError(
            `Drive: ${res.driveError}. Mostrando respaldo. — Reintentar`
          );
        }
        setProductOpts(res.products);
      } catch {
        if (seq !== productSeq.current) return;
        setProductError("No pudimos cargar las sugerencias — Reintentar");
        setProductOpts([]);
      } finally {
        if (seq === productSeq.current) setProductLoading(false);
      }
    },
    [canSuggest, session]
  );

  useEffect(() => {
    if (!canSuggest) return;
    const q = clientQuery.trim();
    if (!q) {
      setClientOpts([]);
      return;
    }
    const t = setTimeout(() => void loadClients(q), 180);
    return () => clearTimeout(t);
  }, [clientQuery, canSuggest, loadClients]);

  useEffect(() => {
    if (!canSuggest) return;
    const c = (selectedClient ?? clientQuery).trim();
    const q = productQuery.trim();
    if (!c || !q) {
      setProductOpts([]);
      return;
    }
    const t = setTimeout(() => void loadProducts(c, q), 180);
    return () => clearTimeout(t);
  }, [selectedClient, clientQuery, productQuery, canSuggest, loadProducts]);

  const productComboboxOpts: ComboboxOption[] = useMemo(
    () =>
      productOpts.map((p) => ({
        id: p.productId,
        label: p.productLabel,
        secondary: p.code ? `Código ${p.code}` : undefined,
      })),
    [productOpts]
  );

  const handleClientChange = (v: string) => {
    editingClientRef.current = true;
    const hadSelection = selectedClient !== null;
    setClientQuery(v);
    if (selectedClient && v !== selectedClient) {
      setSelectedClient(null);
    }
    // Limpiar producto una sola vez al invalidar una selección de cliente.
    if (hadSelection && v !== selectedClient) {
      clearProductLocal();
    }
    onClientTextChange(v);
  };

  const handleProductChange = (v: string) => {
    editingProductRef.current = true;
    setProductQuery(v);
    if (selectedProduct && v !== selectedProduct.productLabel) {
      setSelectedProduct(null);
    }
    onProductTextChange(v);
  };

  return (
    <div className="space-y-2" data-testid="formula-client-product-pickers">
      {statusHint ? (
        <p className="text-[11px] text-[var(--os-text-muted)]" role="status">
          {statusHint}
        </p>
      ) : null}
      <SearchCombobox
        label="Cliente"
        value={clientQuery}
        readOnly={readOnly}
        testId="oe-client-combobox"
        options={clientOpts}
        loading={clientLoading}
        error={clientError}
        onRetry={() => void loadClients(clientQuery)}
        onChange={handleClientChange}
        onClear={() => {
          editingClientRef.current = true;
          setClientQuery("");
          setSelectedClient(null);
          clearProductLocal();
          onClearClient?.();
          onClientTextChange("");
        }}
        onSelectOption={(opt) => {
          editingClientRef.current = true;
          const prev = selectedClient;
          setClientQuery(opt.label);
          setSelectedClient(opt.label);
          if (prev !== opt.label) {
            clearProductLocal();
          }
          onClientSelected(opt.label);
        }}
        onCommitText={(v) => {
          const exactMatches = clientOpts.filter(
            (o) => normalizeSearchKey(o.label) === normalizeSearchKey(v)
          );
          if (exactMatches.length === 1) {
            const label = exactMatches[0]!.label;
            editingClientRef.current = true;
            const prev = selectedClient;
            setClientQuery(label);
            setSelectedClient(label);
            if (prev !== label) clearProductLocal();
            onClientSelected(label);
          }
        }}
      />
      <SearchCombobox
        label="Producto"
        value={productQuery}
        readOnly={readOnly || productNeedsClient}
        placeholder={
          productNeedsClient
            ? "Primero escribí o seleccioná un cliente"
            : "Empezá a escribir para buscar"
        }
        emptyHint={
          productNeedsClient
            ? "Primero escribí o seleccioná un cliente"
            : "Empezá a escribir para buscar"
        }
        testId="oe-product-combobox"
        options={productComboboxOpts}
        loading={productLoading}
        error={productError}
        onRetry={() =>
          void loadProducts(selectedClient ?? clientQuery, productQuery)
        }
        onChange={handleProductChange}
        onClear={() => {
          editingProductRef.current = true;
          setProductQuery("");
          setSelectedProduct(null);
          onClearProduct?.();
          onProductTextChange("");
        }}
        onSelectOption={(opt) => {
          const full = productOpts.find((p) => p.productId === opt.id);
          if (!full) return;
          editingProductRef.current = true;
          const selected: SelectedFormulaOption = {
            productId: full.productId,
            versionId: full.versionId,
            client: full.client,
            productLabel: full.productLabel,
            code: full.code,
            source: full.source,
            driveFileId: full.driveFileId,
          };
          setProductQuery(full.productLabel);
          setSelectedProduct(selected);
          if (full.client) {
            setClientQuery(full.client);
            setSelectedClient(full.client);
          }
          onProductSelected(selected);
        }}
        onCommitText={(v) => {
          const clientName = (selectedClient ?? clientQuery).trim();
          if (!clientName || !v.trim()) return;
          const norm = normalizeSearchKey(v);
          const exactHits = productOpts.filter((p) => {
            const keys = [p.productLabel, p.code, ...p.aliases].map(normalizeSearchKey);
            return keys.includes(norm);
          });
          if (exactHits.length === 1) {
            const full = exactHits[0]!;
            editingProductRef.current = true;
            const selected: SelectedFormulaOption = {
              productId: full.productId,
              versionId: full.versionId,
              client: full.client,
              productLabel: full.productLabel,
              code: full.code,
              source: full.source,
              driveFileId: full.driveFileId,
            };
            setProductQuery(full.productLabel);
            setSelectedProduct(selected);
            onProductSelected(selected);
            return;
          }
          onCommitProductText(clientName, v);
        }}
      />
      {selectedProductId || selectedProduct ? (
        <p className="text-[11px] text-emerald-800" data-testid="oe-formula-bound">
          Fórmula vinculada por selección.
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
