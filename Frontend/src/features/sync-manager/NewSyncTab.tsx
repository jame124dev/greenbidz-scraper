import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, UploadCloud, ChevronLeft, ChevronRight, Package, ImageIcon } from 'lucide-react';
import { Card, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/Table';
import { ErrorState, TableSkeleton, EmptyState } from '@/components/ui/states';
import { useProfiles, useMappedCategories, useSyncCandidates } from '@/hooks/useApi';
import { api } from '@/lib/api';
import type { Product, SyncCandidatesQuery } from '@/types/api';
import { productImageUrl } from '@/lib/productImage';
import { formatPrice, timeAgo } from '@/lib/format';

const PAGE_SIZE = 50;
type LimitChoice = '10' | '20' | '50' | '100' | 'all' | 'custom';

export function NewSyncTab() {
  const navigate = useNavigate();
  const profilesQ = useProfiles();
  const [profile, setProfile] = useState('');
  const [mainCategory, setMainCategory] = useState<number | ''>('');
  // Mapped categories are scoped to the selected profile (only the ones that
  // profile's scraped products map to); all mapped categories when "All".
  const mappedQ = useMappedCategories(profile || undefined);
  const [priceMin, setPriceMin] = useState<number | ''>('');
  const [priceMax, setPriceMax] = useState<number | ''>('');
  const [titleInput, setTitleInput] = useState('');
  const [title, setTitle] = useState(''); // debounced
  const [onlyUnsynced, setOnlyUnsynced] = useState(true);
  const [latestOnly, setLatestOnly] = useState(false);
  const [limitChoice, setLimitChoice] = useState<LimitChoice>('50');
  const [customLimit, setCustomLimit] = useState(50);
  const [page, setPage] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [selectingAll, setSelectingAll] = useState(false);

  // Debounce the title filter.
  useEffect(() => {
    const t = setTimeout(() => setTitle(titleInput.trim()), 300);
    return () => clearTimeout(t);
  }, [titleInput]);

  // Positive-only price inputs.
  const onPrice = (set: (v: number | '') => void) => (raw: string) => {
    if (raw === '') return set('');
    const n = Math.max(0, Number(raw));
    set(Number.isNaN(n) ? '' : n);
  };

  const limit: number | 'all' = limitChoice === 'all' ? 'all' : limitChoice === 'custom' ? customLimit : Number(limitChoice);

  // Reset to page 1 whenever a filter changes.
  useEffect(() => {
    setPage(0);
  }, [profile, mainCategory, priceMin, priceMax, title, onlyUnsynced, latestOnly, limit]);

  const query: SyncCandidatesQuery = useMemo(
    () => ({
      profile: profile || undefined,
      mainCategory: mainCategory === '' ? undefined : mainCategory,
      priceMin,
      priceMax,
      titleContains: title || undefined,
      onlyUnsynced,
      latestOnly,
      limit,
      offset: page * PAGE_SIZE,
    }),
    [profile, mainCategory, priceMin, priceMax, title, onlyUnsynced, latestOnly, limit, page],
  );

  // Auto-fetches on any filter change — no button.
  const { data, isLoading, isError, error, refetch, isFetching } = useSyncCandidates(query);

  const rows = data?.products ?? [];
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const profiles = profilesQ.data?.profiles ?? [];
  const mappedCats = mappedQ.data?.categories ?? [];

  const toggleId = (id: number) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  // Synced products are selectable too — resyncing one UPDATES the existing
  // main-site listing (it carries a stored main_product_id) rather than
  // creating a duplicate.
  const selectablePage = rows;
  const allPageSelected = selectablePage.length > 0 && selectablePage.every((p) => selectedIds.has(p.id));
  const toggleAllPage = () =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allPageSelected) selectablePage.forEach((p) => next.delete(p.id));
      else selectablePage.forEach((p) => next.add(p.id));
      return next;
    });

  // Select EVERY matching product (across all pages), not just the loaded page.
  const selectAllMatches = async () => {
    setSelectingAll(true);
    try {
      const { ids } = await api.getSyncCandidateIds({ ...query, offset: undefined });
      setSelectedIds(new Set(ids));
    } finally {
      setSelectingAll(false);
    }
  };
  const clearSelection = () => setSelectedIds(new Set());

  const goSync = () => {
    if (!selectedIds.size) return;
    navigate(`/sync?ids=${[...selectedIds].join(',')}`);
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <Card>
        <CardBody className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Labeled label="Profile">
            <select
              className="input"
              value={profile}
              onChange={(e) => {
                setProfile(e.target.value);
                setMainCategory(''); // category list is profile-scoped; reset the pick
              }}
            >
              <option value="">All profiles</option>
              {profiles.map((p) => (
                <option key={p.fileName} value={p.fileName}>
                  {p.profileName || p.fileName}
                </option>
              ))}
            </select>
          </Labeled>
          <Labeled label="Main category (mapped)">
            <select className="input" value={mainCategory} onChange={(e) => setMainCategory(e.target.value ? Number(e.target.value) : '')}>
              <option value="">Any category</option>
              {mappedCats.map((c) => (
                <option key={c.main_term_id} value={c.main_term_id}>
                  {c.main_term_name || `#${c.main_term_id}`}
                </option>
              ))}
            </select>
          </Labeled>
          <Labeled label="Price min">
            <input type="number" min={0} className="input" value={priceMin} onChange={(e) => onPrice(setPriceMin)(e.target.value)} placeholder="e.g. 100" />
          </Labeled>
          <Labeled label="Price max">
            <input type="number" min={0} className="input" value={priceMax} onChange={(e) => onPrice(setPriceMax)(e.target.value)} placeholder="e.g. 5000" />
          </Labeled>
          <Labeled label="Title contains">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <input className="input pl-9" value={titleInput} onChange={(e) => setTitleInput(e.target.value)} placeholder="keyword in title" />
            </div>
          </Labeled>
          <Labeled label="Per-run limit">
            <div className="flex gap-2">
              <select className="input" value={limitChoice} onChange={(e) => setLimitChoice(e.target.value as LimitChoice)}>
                <option value="10">10</option>
                <option value="20">20</option>
                <option value="50">50</option>
                <option value="100">100</option>
                <option value="all">All</option>
                <option value="custom">Custom…</option>
              </select>
              {limitChoice === 'custom' && (
                <input type="number" min={1} className="input w-24" value={customLimit} onChange={(e) => setCustomLimit(Math.max(1, Number(e.target.value) || 1))} />
              )}
            </div>
          </Labeled>
          <div className="flex items-end gap-4 lg:col-span-2">
            <label className="flex cursor-pointer items-center gap-2 text-xs text-muted">
              <input type="checkbox" className="h-4 w-4 accent-accent" checked={onlyUnsynced} onChange={(e) => setOnlyUnsynced(e.target.checked)} />
              Only not-yet-synced
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-xs text-muted">
              <input type="checkbox" className="h-4 w-4 accent-accent" checked={latestOnly} onChange={(e) => setLatestOnly(e.target.checked)} />
              Latest-scraped first
            </label>
          </div>
        </CardBody>
      </Card>

      {/* Product list */}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-4">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <span>
              {total} match{total === 1 ? '' : 'es'}
              {selectedIds.size ? ` · ${selectedIds.size} selected` : ''}
            </span>
            {total > 0 && (
              <Button size="sm" variant="secondary" loading={selectingAll} disabled={selectingAll || total === 0} onClick={selectAllMatches}>
                Select all {total}
              </Button>
            )}
            {selectedIds.size > 0 && (
              <Button size="sm" variant="ghost" onClick={clearSelection}>
                Clear
              </Button>
            )}
          </div>
          <Button
            icon={<UploadCloud className="h-4 w-4" />}
            disabled={selectedIds.size === 0}
            onClick={goSync}
          >
            Sync to main{selectedIds.size ? ` (${selectedIds.size})` : ''}
          </Button>
        </div>

        <CardBody className="p-0">
          {isLoading || isFetching ? (
            <TableSkeleton rows={8} cols={6} />
          ) : isError ? (
            <ErrorState message={(error as Error).message} onRetry={() => refetch()} />
          ) : !rows.length ? (
            <EmptyState title="No products match" hint="Adjust the filters above." icon={<Package className="h-5 w-5" />} />
          ) : (
            <>
              <Table>
                <THead>
                  <TH className="w-10">
                    <input type="checkbox" className="h-4 w-4 cursor-pointer accent-accent" checked={allPageSelected} onChange={toggleAllPage} />
                  </TH>
                  <TH className="w-12" />
                  <TH>Product</TH>
                  <TH>Price</TH>
                  <TH>Profile</TH>
                  <TH>Status</TH>
                </THead>
                <TBody>
                  {rows.map((p) => (
                    <TR key={p.id}>
                      <TD>
                        <input
                          type="checkbox"
                          className="h-4 w-4 cursor-pointer accent-accent disabled:opacity-40"
                          checked={selectedIds.has(p.id)}
                          title={p.synced ? 'Already synced — resync will update the main-site listing' : undefined}
                          onChange={() => toggleId(p.id)}
                        />
                      </TD>
                      <TD>
                        <Thumb product={p} />
                      </TD>
                      <TD className="max-w-[340px]">
                        <div className="truncate font-medium text-ink">{p.title || <span className="text-muted">Untitled</span>}</div>
                        <div className="truncate text-xs text-muted">{p.product_url}</div>
                      </TD>
                      <TD className="whitespace-nowrap">{formatPrice(p.price, p.price_currency)}</TD>
                      <TD className="max-w-[140px] truncate text-xs text-muted">{p.profile_file_name || '—'}</TD>
                      <TD>
                        {p.synced ? (
                          <Badge tone="info">synced</Badge>
                        ) : (
                          <Badge tone={p.scraped ? 'yes' : 'neutral'}>{p.scraped ? 'scraped' : 'pending'}</Badge>
                        )}
                        <div className="mt-0.5 text-[11px] text-muted">{timeAgo(p.last_seen_at)}</div>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>

              {/* Pagination */}
              <div className="flex items-center justify-between border-t border-line p-3 text-xs text-muted">
                <span>
                  Page {page + 1} of {pageCount}
                </span>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
                    <ChevronLeft className="h-3.5 w-3.5" /> Prev
                  </Button>
                  <Button size="sm" variant="secondary" disabled={page + 1 >= pageCount} onClick={() => setPage((p) => p + 1)}>
                    Next <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-muted">{label}</label>
      {children}
    </div>
  );
}

function Thumb({ product }: { product: Product }) {
  const src = productImageUrl(product);
  if (!src) {
    return (
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-panel2 text-muted">
        <ImageIcon className="h-4 w-4" />
      </div>
    );
  }
  return (
    <div className="h-10 w-10 shrink-0 overflow-hidden rounded-md border border-line bg-panel2">
      <img src={src} alt="" loading="lazy" className="h-full w-full object-cover" />
    </div>
  );
}
