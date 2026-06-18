import { useEffect, useId, useRef, useState } from 'react';
import { Search, Loader2, Check, X, ChevronDown } from 'lucide-react';
import type { SyncSeller } from '@/types/api';

/**
 * Searchable seller picker: a single combobox that filters the main-site seller
 * list as you type and lets you pick from an inline dropdown (name, email, id,
 * listings). Debounces its own search, shows a loading spinner, supports
 * keyboard nav (↑/↓/Enter/Esc), and closes on outside-click.
 */
export function SellerCombobox({
  value,
  selectedLabel,
  sellers,
  loading,
  total,
  onSearch,
  onSelect,
}: {
  value: number | null;
  selectedLabel: string;
  sellers: SyncSeller[];
  loading: boolean;
  total?: number;
  onSearch: (q: string) => void;
  onSelect: (seller: SyncSeller) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  // Debounce the typed text → upstream search.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => onSearch(text.trim()), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, open]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Keep the highlighted row in range as results change.
  useEffect(() => setActive(0), [sellers]);

  const openWith = () => {
    setOpen(true);
    setText('');
    onSearch('');
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const choose = (s: SyncSeller) => {
    onSelect(s);
    setOpen(false);
    setText('');
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) {
      openWith();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, sellers.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (sellers[active]) choose(sellers[active]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div ref={wrapRef} className="relative">
      {/* Trigger / search input */}
      {open ? (
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            ref={inputRef}
            className="input pl-9 pr-8"
            placeholder="Search sellers by name / email…"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              if (!open) setOpen(true);
            }}
            onKeyDown={onKeyDown}
            autoComplete="off"
            role="combobox"
            aria-expanded
            aria-controls={listId}
          />
          {loading ? (
            <Loader2 className="absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted" />
          ) : text ? (
            <button
              type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-ink"
              onClick={() => { setText(''); onSearch(''); inputRef.current?.focus(); }}
              title="Clear"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      ) : (
        <button
          type="button"
          className="input flex w-full items-center justify-between text-left"
          onClick={openWith}
          onKeyDown={onKeyDown}
        >
          <span className={value != null ? 'truncate text-ink' : 'text-muted'}>
            {value != null ? selectedLabel || `Seller #${value}` : 'Select a seller…'}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted" />
        </button>
      )}

      {/* Dropdown */}
      {open && (
        <div
          id={listId}
          role="listbox"
          className="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-line bg-panel shadow-card"
        >
          {loading && !sellers.length ? (
            <div className="flex items-center gap-2 px-3 py-3 text-xs text-muted">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading sellers…
            </div>
          ) : !sellers.length ? (
            <div className="px-3 py-3 text-xs text-muted">No sellers match — try a different name or email.</div>
          ) : (
            <>
              {sellers.map((s, i) => (
                <button
                  key={s.id}
                  type="button"
                  role="option"
                  aria-selected={s.id === value}
                  className={[
                    'flex w-full items-center gap-2 px-3 py-2 text-left text-sm',
                    i === active ? 'bg-panel2' : 'hover:bg-panel2',
                  ].join(' ')}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(s)}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-ink">
                      {s.displayName} <span className="text-muted">#{s.id}</span>
                    </div>
                    <div className="truncate text-xs text-muted">
                      {s.email || '—'}
                      {s.totalListings != null ? ` · ${s.totalListings} listings` : ''}
                      {s.currency ? ` · ${s.currency}` : ''}
                    </div>
                  </div>
                  {s.id === value && <Check className="h-4 w-4 shrink-0 text-accent" />}
                </button>
              ))}
              <div className="border-t border-line px-3 py-1.5 text-[11px] text-muted">
                {sellers.length}
                {total != null && total > sellers.length ? ` of ${total}` : ''} shown
                {total != null && total > sellers.length ? ' · refine your search to narrow' : ''}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
