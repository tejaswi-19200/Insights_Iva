import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Plus, X } from "lucide-react";

import { SearchBar } from "./SearchFilter";

/**
 * Lightweight searchable dropdown — no extra packages.
 * options: string[] | { value, label }[]
 */
function OptionButton({ opt, active, onPick }) {
  const isAdd =
    String(opt.label || "").startsWith("+") ||
    /add new|create new|add customer|add product/i.test(String(opt.label || "")) ||
    String(opt.value || "").startsWith("__add") ||
    String(opt.value || "").startsWith("__new");

  return (
    <li key={opt.value}>
      <button
        type="button"
        role="option"
        aria-selected={active}
        onClick={() => onPick(opt)}
        aria-label={opt.ariaLabel || undefined}
        className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm ${
          active
            ? "bg-[var(--color-success-soft)] font-semibold text-[var(--color-success)] dark:bg-teal-900/30 dark:text-teal-200"
            : isAdd
              ? "font-semibold text-[var(--color-primary)] hover:bg-[var(--color-primary-soft)] dark:text-[#2dd4bf] dark:hover:bg-teal-950/30"
              : "text-[var(--color-text)] hover:bg-[var(--color-surface-muted)] dark:hover:bg-slate-700/50"
        }`}
      >
        <span className="truncate">{opt.label}</span>
        {active ? <Check className="h-4 w-4 shrink-0" aria-hidden /> : null}
      </button>
    </li>
  );
}

function FooterActionButton({ opt, onPick }) {
  const isAdd =
    String(opt.label || "").startsWith("+") ||
    /add new|create new/i.test(String(opt.label || "")) ||
    String(opt.value || "").startsWith("__add") ||
    String(opt.value || "").startsWith("__new");

  return (
    <button
      type="button"
      onClick={() => onPick(opt)}
      aria-label={opt.ariaLabel || opt.label}
      className={`flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]/30 ${
        isAdd
          ? "text-[var(--color-primary)] hover:bg-[var(--color-primary-soft)] dark:text-[#2dd4bf] dark:hover:bg-teal-950/30"
          : "text-[var(--color-text)] hover:bg-[var(--color-surface-muted)]"
      }`}
    >
      {isAdd ? <Plus className="h-4 w-4 shrink-0" aria-hidden /> : null}
      <span className="truncate">{opt.label}</span>
    </button>
  );
}

export default function SearchableSelect({
  value = "",
  onChange,
  options = [],
  footerOptions = [],
  onFooterPick,
  stickyFooter = true,
  placeholder = "Select…",
  searchPlaceholder = "Search",
  searchable = true,
  disabled = false,
  error = false,
  allowCustom = false,
  className = "",
  menuClassName = "",
  placement = "bottom",
  id,
  onQueryChange,
  onOpenChange,
  loading = false,
  emptyListMessage = null,
  clearable = false,
  onClear,
  clearAriaLabel = "Clear selection",
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef(null);
  const inputRef = useRef(null);

  const normalizeOptions = (list) =>
    list.map((o) =>
      typeof o === "string"
        ? { value: o, label: o }
        : { value: o.value, label: o.label, ariaLabel: o.ariaLabel }
    );

  const normalized = useMemo(() => normalizeOptions(options), [options]);
  const normalizedFooter = useMemo(() => normalizeOptions(footerOptions), [footerOptions]);

  const selectedLabel =
    normalized.find((o) => o.value === value)?.label || (allowCustom ? value : "") || "";

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return normalized;
    return normalized.filter(
      (o) => o.label.toLowerCase().includes(q) || String(o.value).toLowerCase().includes(q)
    );
  }, [normalized, query]);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  useEffect(() => {
    if (open) {
      setQuery("");
      onOpenChange?.(true);
      setTimeout(() => inputRef.current?.focus(), 0);
    } else {
      onOpenChange?.(false);
    }
  }, [open, onOpenChange]);

  useEffect(() => {
    onQueryChange?.(query);
  }, [query, onQueryChange]);

  const baseClass = `flex w-full items-center justify-between gap-2 rounded-xl border bg-[var(--color-surface)] px-3.5 py-2.5 text-left text-sm shadow-sm transition focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:bg-[var(--color-surface-muted)] disabled:text-[var(--color-text-muted)] ${
    error
      ? "border-red-400 focus:ring-red-400/30"
      : "border-[var(--color-border-soft)] focus:border-[var(--color-primary)] focus:ring-[var(--color-primary)]/20"
  } ${className}`;

  const pick = (opt) => {
    onChange?.(opt.value);
    setOpen(false);
  };

  const pickFooter = (opt) => {
    if (onFooterPick) {
      onFooterPick(opt);
    } else {
      onChange?.(opt.value);
    }
    setOpen(false);
  };

  const showStickyFooter = stickyFooter && normalizedFooter.length > 0;

  const showClear = clearable && Boolean(value) && !disabled;

  const handleClearClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    onChange?.("");
    onClear?.();
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        id={id}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => !disabled && setOpen((v) => !v)}
        className={baseClass}
      >
        <span className={selectedLabel ? "truncate text-[var(--color-text)]" : "truncate text-[var(--color-text-placeholder)]"}>
          {selectedLabel || placeholder}
        </span>
        <span className="flex shrink-0 items-center gap-0.5">
          {showClear ? (
            <span
              role="button"
              tabIndex={0}
              onClick={handleClearClick}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleClearClick(e);
                }
              }}
              className="rounded-md p-0.5 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-text)]"
              aria-label={clearAriaLabel}
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </span>
          ) : null}
          <ChevronDown className={`h-4 w-4 text-[var(--color-text-icon)] transition ${open ? "rotate-180" : ""}`} aria-hidden />
        </span>
      </button>

      {open ? (
        <div
          className={`absolute left-0 right-0 z-40 flex max-h-[min(20rem,70vh)] flex-col overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg ${
            placement === "top" ? "bottom-full mb-1" : "top-full mt-1"
          } ${menuClassName}`.trim()}
        >
          {searchable ? (
            <div className="shrink-0 border-b border-[var(--color-border-muted)] p-2">
              <SearchBar
                size="compact"
                value={query}
                onChange={setQuery}
                placeholder={searchPlaceholder}
                inputRef={inputRef}
                clearable={false}
                type="text"
                className="w-full"
                onKeyDown={(e) => {
                  if (e.key === "Escape") setOpen(false);
                  if (e.key === "Enter" && allowCustom && query.trim()) {
                    onChange?.(query.trim());
                    setOpen(false);
                  }
                }}
              />
            </div>
          ) : null}
          <div className="min-h-0 flex-1 overflow-y-auto py-1">
            <ul role="listbox" aria-label={searchPlaceholder}>
              {filtered.length === 0 ? (
                <li className="px-3 py-3 text-center text-xs text-[var(--color-text-muted)]">
                  {allowCustom && query.trim() ? (
                    <button
                      type="button"
                      className="font-medium text-[var(--color-success)] hover:underline"
                      onClick={() => {
                        onChange?.(query.trim());
                        setOpen(false);
                      }}
                    >
                      Use “{query.trim()}”
                    </button>
                  ) : loading ? (
                    "Loading…"
                  ) : !query.trim() && normalized.length === 0 ? (
                    emptyListMessage || "No options available"
                  ) : query.trim() ? (
                    "No matches found"
                  ) : (
                    "Type to search"
                  )}
                </li>
              ) : (
                filtered.map((opt) => (
                  <OptionButton key={opt.value} opt={opt} active={opt.value === value} onPick={pick} />
                ))
              )}
              {!showStickyFooter && normalizedFooter.length > 0 ? (
                <>
                  <li role="separator" className="my-1 border-t border-[var(--color-border-muted)]" />
                  {normalizedFooter.map((opt) => (
                    <OptionButton key={opt.value} opt={opt} active={false} onPick={pickFooter} />
                  ))}
                </>
              ) : null}
            </ul>
          </div>
          {showStickyFooter ? (
            <div
              className="shrink-0 border-t border-[var(--color-border-muted)] bg-[var(--color-surface)]"
              role="group"
              aria-label="Dropdown actions"
            >
              {normalizedFooter.map((opt) => (
                <FooterActionButton key={opt.value} opt={opt} onPick={pickFooter} />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
