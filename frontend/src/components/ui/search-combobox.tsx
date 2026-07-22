"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";

export type ComboboxOption = {
  id: string;
  label: string;
  secondary?: string;
};

type SearchComboboxProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Selección explícita de una opción (mouse / Enter sobre highlight). */
  onSelectOption: (option: ComboboxOption) => void;
  /** Enter/blur con texto: el padre decide si hay exacto único. */
  onCommitText?: (value: string) => void;
  options: ComboboxOption[];
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  disabled?: boolean;
  placeholder?: string;
  emptyHint?: string;
  noResultsHint?: string;
  testId?: string;
};

type ListPos = { top: number; left: number; width: number };

export function SearchCombobox({
  label,
  value,
  onChange,
  onSelectOption,
  onCommitText,
  options,
  loading = false,
  error = null,
  onRetry,
  disabled = false,
  placeholder = "Empezá a escribir para buscar",
  emptyHint = "Empezá a escribir para buscar",
  noResultsHint = "No encontramos resultados. Podés continuar manualmente",
  testId,
}: SearchComboboxProps) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [pos, setPos] = useState<ListPos | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    setHighlight(0);
  }, [options]);

  const updatePos = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      top: r.bottom + 4,
      left: r.left,
      width: Math.max(r.width, 200),
    });
  }, []);

  useLayoutEffect(() => {
    if (!open || disabled) {
      setPos(null);
      return;
    }
    updatePos();
    const onScroll = () => updatePos();
    window.addEventListener("resize", onScroll);
    // capture scroll en contenedores (modales)
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open, disabled, updatePos, options, loading]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t)) return;
      const listEl = document.getElementById(listId);
      if (listEl?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [listId]);

  const showList = open && !disabled && mounted;
  const hasQuery = value.trim().length > 0;

  const pick = useCallback(
    (opt: ComboboxOption) => {
      onSelectOption(opt);
      setOpen(false);
    },
    [onSelectOption]
  );

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return;
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      if (options.length) {
        setHighlight((h) => (h + 1) % options.length);
      }
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      if (options.length) {
        setHighlight((h) => (h - 1 + options.length) % options.length);
      }
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (open && options[highlight]) {
        pick(options[highlight]!);
        return;
      }
      onCommitText?.(value);
      setOpen(false);
    }
  };

  const listbox =
    showList && pos ? (
      <ul
        id={listId}
        role="listbox"
        data-testid={testId ? `${testId}-list` : undefined}
        className="fixed z-[200] max-h-56 overflow-y-auto overscroll-contain rounded border border-[var(--os-border)] bg-[var(--os-surface,#fff)] shadow-lg"
        style={{
          top: pos.top,
          left: pos.left,
          width: pos.width,
        }}
      >
        {loading ? (
          <li className="px-3 py-2.5 text-sm text-[var(--os-text-muted)]" role="presentation">
            Buscando…
          </li>
        ) : !hasQuery ? (
          <li className="px-3 py-2.5 text-sm text-[var(--os-text-muted)]" role="presentation">
            {emptyHint}
          </li>
        ) : options.length === 0 ? (
          <li className="px-3 py-2.5 text-sm text-[var(--os-text-muted)]" role="presentation">
            {noResultsHint}
          </li>
        ) : (
          options.map((opt, i) => (
            <li
              key={opt.id}
              id={`${listId}-opt-${i}`}
              role="option"
              aria-selected={i === highlight}
              className={`cursor-pointer px-3 py-2.5 text-sm ${
                i === highlight
                  ? "bg-[var(--os-bg-muted,#eef1f4)]"
                  : "hover:bg-[var(--os-bg-muted,#f5f7fa)]"
              }`}
              onMouseEnter={() => setHighlight(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(opt);
              }}
            >
              <span className="font-medium">{opt.label}</span>
              {opt.secondary ? (
                <span className="ml-2 text-[11px] text-[var(--os-text-muted)]">
                  {opt.secondary}
                </span>
              ) : null}
            </li>
          ))
        )}
      </ul>
    ) : null;

  return (
    <div ref={rootRef} className="relative flex flex-col gap-1 text-xs" data-testid={testId}>
      <span className="text-[var(--os-text-muted)]">{label}</span>
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={
          showList && options[highlight] ? `${listId}-opt-${highlight}` : undefined
        }
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          setOpen(true);
          updatePos();
        }}
        onBlur={() => {
          window.setTimeout(() => {
            if (!rootRef.current?.contains(document.activeElement)) {
              const listEl = document.getElementById(listId);
              if (listEl?.contains(document.activeElement)) return;
              onCommitText?.(value);
            }
          }, 150);
        }}
        onKeyDown={onKeyDown}
        className="min-h-11 rounded border border-[var(--os-border)] bg-[var(--os-surface)] px-2 py-2 text-sm disabled:opacity-70 sm:min-h-0 sm:py-1.5"
        data-testid={testId ? `${testId}-input` : undefined}
      />
      {error ? (
        <div
          className="rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-950"
          role="alert"
          data-testid={testId ? `${testId}-error` : undefined}
        >
          <p>{error}</p>
          {onRetry ? (
            <button
              type="button"
              className="mt-1 font-medium underline"
              onClick={() => {
                onRetry();
                setOpen(true);
              }}
              data-testid={testId ? `${testId}-retry` : undefined}
            >
              Reintentar
            </button>
          ) : null}
        </div>
      ) : null}
      {mounted && listbox ? createPortal(listbox, document.body) : null}
    </div>
  );
}
