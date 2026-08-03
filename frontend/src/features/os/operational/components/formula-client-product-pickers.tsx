"use client";

/**
 * Cliente/Producto OE: precarga + caché compartido + filtro inmediato con ranking.
 * Drive via índice server (TTL 10 min); AbortController; debounce 100ms.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SearchCombobox, type ComboboxOption } from "@/components/ui/search-combobox";
import { Button } from "@/components/ui/button";
import {
  syncFormulaDriveIndexApi,
  type FormulaProductOption,
  type OrdersClientSession,
} from "@/lib/orders/orders-client";
import {
  getCachedClients,
  getCachedDataSource,
  getCachedProducts,
  invalidateFormulaCatalogCache,
  loadClientsCatalog,
  loadProductsCatalog,
} from "@/lib/formulas/formula-catalog-cache";
import { filterClientsRanked, filterAndRankByScore } from "@/lib/formulas/formula-search-rank";
import { timeLocalFilter } from "@/lib/formulas/formula-search-perf";
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
  client: string;
  product: string;
  hydrateKey?: string;
  readOnly?: boolean;
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

const DEBOUNCE_MS = 100;
const SUGGEST_LIMIT = 10;

function filterClientsLocal(
  all: Array<{ client: string; source?: string }>,
  q: string
): ComboboxOption[] {
  const cache: "hot" | "cold" = all.length > 0 ? "hot" : "cold";
  const ranked = timeLocalFilter("clients_filter", q, all.length, cache, () =>
    filterClientsRanked(all, q, SUGGEST_LIMIT)
  );
  const byClient = new Map(all.map((c) => [c.client, c]));
  return ranked.map((r) => {
    const row = byClient.get(r.client);
    return {
      id: r.client,
      label: r.client,
      secondary: row?.source === "CACHE_NEON" ? "CACHE_NEON" : "DRIVE",
    };
  });
}

function filterProductsLocal(
  all: FormulaProductOption[],
  q: string
): FormulaProductOption[] {
  const cache: "hot" | "cold" = all.length > 0 ? "hot" : "cold";
  return timeLocalFilter("products_filter", q, all.length, cache, () =>
    filterAndRankByScore(
      all,
      q,
      (p) => [p.productLabel, p.code, ...p.aliases],
      SUGGEST_LIMIT
    )
  );
}

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
  const [clientQuery, setClientQuery] = useState(client);
  const [selectedClient, setSelectedClient] = useState<string | null>(
    client.trim() ? client : null
  );
  const [productQuery, setProductQuery] = useState(product);
  const [selectedProduct, setSelectedProduct] = useState<SelectedFormulaOption | null>(null);

  const [clientsCache, setClientsCache] = useState<
    Array<{ client: string; source?: string }>
  >(() => getCachedClients() ?? []);

  const [clientOpts, setClientOpts] = useState<ComboboxOption[]>([]);
  const [productOpts, setProductOpts] = useState<FormulaProductOption[]>([]);
  const [clientLoading, setClientLoading] = useState(false);
  const [productLoading, setProductLoading] = useState(false);
  const [clientError, setClientError] = useState<string | null>(null);
  const [productError, setProductError] = useState<string | null>(null);
  const [dataSource, setDataSource] = useState<"DRIVE" | "CACHE_NEON" | null>(
    getCachedDataSource()
  );
  const [refreshing, setRefreshing] = useState(false);

  const clientAbort = useRef<AbortController | null>(null);
  const productAbort = useRef<AbortController | null>(null);
  const editingClientRef = useRef(false);
  const editingProductRef = useRef(false);
  const prevHydrateKey = useRef<string | null>(null);

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

  const clearProductLocal = useCallback(() => {
    editingProductRef.current = true;
    setProductQuery("");
    setSelectedProduct(null);
    setProductOpts([]);
    onProductTextChange("");
    onClearProduct?.();
  }, [onClearProduct, onProductTextChange]);

  const preloadClients = useCallback(
    async (forceNetwork = false) => {
      if (!canSuggest) return;
      const cached = getCachedClients();
      if (!forceNetwork && cached && cached.length > 0) {
        setClientsCache(cached);
        setClientOpts(filterClientsLocal(cached, clientQuery));
        setDataSource(getCachedDataSource());
        return;
      }
      clientAbort.current?.abort();
      const ac = new AbortController();
      clientAbort.current = ac;
      setClientLoading(true);
      setClientError(null);
      try {
        const entry = await loadClientsCatalog(session, {
          force: forceNetwork,
          signal: ac.signal,
        });
        if (ac.signal.aborted) return;
        setDataSource(entry.source);
        setClientsCache(entry.rows);
        setClientOpts(filterClientsLocal(entry.rows, clientQuery));
      } catch (err) {
        if (ac.signal.aborted || (err as Error)?.name === "AbortError") return;
        setClientError("No pudimos cargar las sugerencias — Reintentar");
        setClientsCache([]);
        setClientOpts([]);
      } finally {
        if (!ac.signal.aborted) setClientLoading(false);
      }
    },
    [canSuggest, session, clientQuery]
  );

  const preloadProductsForClient = useCallback(
    async (clientName: string, forceNetwork = false) => {
      if (!canSuggest || !clientName.trim()) {
        setProductOpts([]);
        return;
      }
      const cached = getCachedProducts(clientName);
      if (!forceNetwork && cached && cached.length > 0) {
        setProductOpts(filterProductsLocal(cached, productQuery));
        return;
      }
      productAbort.current?.abort();
      const ac = new AbortController();
      productAbort.current = ac;
      setProductLoading(true);
      setProductError(null);
      try {
        const entry = await loadProductsCatalog(session, clientName, {
          force: forceNetwork,
          signal: ac.signal,
        });
        if (ac.signal.aborted) return;
        setDataSource(entry.source);
        setProductOpts(filterProductsLocal(entry.products, productQuery));
      } catch (err) {
        if (ac.signal.aborted || (err as Error)?.name === "AbortError") return;
        setProductError("No pudimos cargar las sugerencias — Reintentar");
        setProductOpts([]);
      } finally {
        if (!ac.signal.aborted) setProductLoading(false);
      }
    },
    [canSuggest, session, productQuery]
  );

  useEffect(() => {
    if (!canSuggest) return;
    void preloadClients(false);
    return () => clientAbort.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount/canSuggest only
  }, [canSuggest]);

  useEffect(() => {
    if (!canSuggest) return;
    if (clientsCache.length > 0) {
      setClientOpts(filterClientsLocal(clientsCache, clientQuery));
      return;
    }
    const t = setTimeout(() => void preloadClients(false), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [clientQuery, canSuggest, clientsCache, preloadClients]);

  useEffect(() => {
    if (!canSuggest) return;
    const c = (selectedClient ?? clientQuery).trim();
    if (!c) {
      setProductOpts([]);
      return;
    }
    const cached = getCachedProducts(c);
    if (cached && cached.length > 0) {
      setProductOpts(filterProductsLocal(cached, productQuery));
      return;
    }
    const t = setTimeout(() => void preloadProductsForClient(c, false), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [
    selectedClient,
    clientQuery,
    productQuery,
    canSuggest,
    preloadProductsForClient,
  ]);

  const productComboboxOpts: ComboboxOption[] = useMemo(
    () =>
      productOpts.map((p) => ({
        id: p.productId,
        label: p.productLabel,
        secondary: [
          p.code ? `Código ${p.code}` : null,
          p.source === "CACHE_NEON" ? "CACHE_NEON" : "DRIVE",
        ]
          .filter(Boolean)
          .join(" · "),
      })),
    [productOpts]
  );

  async function refreshFromDrive() {
    setRefreshing(true);
    setClientError(null);
    setProductError(null);
    try {
      await syncFormulaDriveIndexApi(session);
      invalidateFormulaCatalogCache();
      setClientsCache([]);
      await preloadClients(true);
      const c = (selectedClient ?? clientQuery).trim();
      if (c) await preloadProductsForClient(c, true);
    } catch (e) {
      setClientError(e instanceof Error ? e.message : "No se pudo actualizar Drive");
    } finally {
      setRefreshing(false);
    }
  }

  const handleClientChange = (v: string) => {
    editingClientRef.current = true;
    const hadSelection = selectedClient !== null;
    setClientQuery(v);
    if (selectedClient && v !== selectedClient) {
      setSelectedClient(null);
    }
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

  const handleClientFocus = () => {
    if (!canSuggest) return;
    if (getCachedClients()?.length || clientsCache.length > 0) return;
    void preloadClients(false);
  };

  return (
    <div className="space-y-2" data-testid="formula-client-product-pickers">
      {statusHint ? (
        <p className="text-[11px] text-[var(--os-text-muted)]" role="status">
          {statusHint}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {dataSource ? (
          <span
            className="text-[11px] text-[var(--os-text-muted)]"
            data-testid="formula-search-source"
          >
            Fuente: {dataSource}
          </span>
        ) : null}
        {canSuggest ? (
          <Button
            type="button"
            variant="secondary"
            className="h-7 px-2 text-xs"
            disabled={refreshing || clientLoading}
            data-testid="formula-refresh-drive"
            onClick={() => void refreshFromDrive()}
          >
            {refreshing ? "Actualizando…" : "Actualizar desde Drive"}
          </Button>
        ) : null}
      </div>
      <div onFocusCapture={handleClientFocus}>
        <SearchCombobox
          label="Cliente"
          value={clientQuery}
          readOnly={readOnly}
          testId="oe-client-combobox"
          options={clientOpts}
          loading={clientLoading}
          error={clientError}
          onRetry={() => void preloadClients(true)}
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
            void preloadProductsForClient(opt.label, false);
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
      </div>
      <SearchCombobox
        label="Producto"
          value={productQuery}
          readOnly={readOnly}
          placeholder={
            !clientQuery.trim()
              ? "Primero escribí o seleccioná un cliente"
              : "Empezá a escribir para buscar"
          }
          emptyHint={
            !clientQuery.trim()
              ? "Primero escribí o seleccioná un cliente"
              : "Empezá a escribir para buscar"
          }
          testId="oe-product-combobox"
          options={productComboboxOpts}
          loading={productLoading}
          error={productError}
          onRetry={() =>
            void preloadProductsForClient(selectedClient ?? clientQuery, true)
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
