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
  onSelectOption: (option: ComboboxOption) => void;
  onCommitText?: (value: string) => void;
  onClear?: () => void;
  options: ComboboxOption[];
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  /** Solo bloquea escritura cuando el formulario está en solo lectura. */
  readOnly?: boolean;
  placeholder?: string;
  emptyHint?: string;
  noResultsHint?: string;
  testId?: string;
};

type ListPos = { top: number; left: number; width: number };

/**
 * Input de texto real + lista de sugerencias (portal).
 * Nunca usa <select>/botón. El dropdown no debe robar el foco.
 */
export function SearchCombobox({
  label,
  value,
  onChange,
  onSelectOption,
  onCommitText,
  onClear,
  options,
  loading = false,
  error = null,
  onRetry,
  readOnly = false,
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
      width: Math.max(r.width, 220),
    });
  }, []);

  useLayoutEffect(() => {
    if (!open || readOnly) {
      setPos(null);
      return;
    }
    updatePos();
    const onScroll = () => updatePos();
    window.addEventListener("resize", onScroll);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open, readOnly, updatePos, options, loading, value]);

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

  const showList = open && !readOnly && mounted;
  const hasQuery = value.trim().length > 0;

  const pick = useCallback(
    (opt: ComboboxOption) => {
      onSelectOption(opt);
      setOpen(false);
      window.requestAnimationFrame(() => inputRef.current?.focus());
    },
    [onSelectOption]
  );

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (readOnly) return;
    // Solo interceptar navegación de lista. Nunca preventDefault en letras,
    // números, espacio, Backspace, Delete, Ctrl+V / Ctrl+A.
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      if (options.length) setHighlight((h) => (h + 1) % options.length);
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
    if (e.key === "Enter" && open && options[highlight]) {
      e.preventDefault();
      pick(options[highlight]!);
    }
  };

  const listbox =
    showList && pos ? (
      <ul
        id={listId}
        role="listbox"
        data-testid={testId ? `${testId}-list` : undefined}
        className="fixed z-[200] max-h-56 overflow-y-auto overscroll-contain rounded border border-[var(--os-border)] bg-[var(--os-surface,#fff)] shadow-lg"
        style={{ top: pos.top, left: pos.left, width: pos.width }}
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
                // Conservar foco en el input; no aplicar al wrapper/input.
                e.preventDefault();
              }}
              onClick={() => pick(opt)}
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
      <div className="relative flex items-center gap-1">
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
          readOnly={readOnly}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => {
            if (!readOnly) {
              setOpen(true);
              updatePos();
            }
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
          className="min-h-11 w-full rounded border border-[var(--os-border)] bg-[var(--os-surface)] px-2 py-2 pr-8 text-sm text-[var(--os-text)] caret-[var(--os-text)] outline-none focus:border-[var(--os-teal,#0d9488)] focus:ring-1 focus:ring-[var(--os-teal,#0d9488)] read-only:cursor-default read-only:opacity-70 sm:min-h-0 sm:py-1.5"
          data-testid={testId ? `${testId}-input` : undefined}
        />
        {!readOnly && value ? (
          <button
            type="button"
            tabIndex={-1}
            aria-label="Limpiar"
            className="absolute right-1 top-1/2 -translate-y-1/2 rounded px-1.5 py-0.5 text-[11px] text-[var(--os-text-muted)] hover:bg-[var(--os-bg-muted,#eef1f4)]"
            data-testid={testId ? `${testId}-clear` : undefined}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              onClear?.();
              onChange("");
              setOpen(true);
              inputRef.current?.focus();
            }}
          >
            ×
          </button>
        ) : null}
      </div>
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
                inputRef.current?.focus();
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
