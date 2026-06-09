import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Package, ImageIcon, UploadCloud, ChevronLeft, ChevronRight, CheckCircle2, Trash2, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/Table';
import { ErrorState, TableSkeleton, EmptyState } from '@/components/ui/states';
import { useProducts, useDeleteProducts, useProfiles, useRescrape } from '@/hooks/useApi';
import type { Product } from '@/types/api';
import { formatPrice, timeAgo } from '@/lib/format';
import { productImageUrl } from '@/lib/productImage';
import { cn } from '@/lib/cn';
import { ProductDetailDrawer } from './ProductDetailDrawer';

type Filter = 'all' | 'scraped' | 'unscraped' | 'incomplete';
const PAGE_SIZE = 50;

export function ProductsPage() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>('all');
  const [profileFilter, setProfileFilter] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState(''); // debounced
  const [selected, setSelected] = useState<Product | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [showDelete, setShowDelete] = useState(false);
  const [page, setPage] = useState(0);

  // Debounce the search box → server query.
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Reset to page 1 when any filter changes.
  useEffect(() => setPage(0), [filter, profileFilter, search]);

  const { data, isLoading, isError, error, refetch, isFetching } = useProducts({
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
    status: filter,
    profile: profileFilter || undefined,
    search: search || undefined,
  });
  const del = useDeleteProducts();
  const rescrape = useRescrape();

  const onRescrapeSelected = () => {
    const ids = [...selectedIds];
    rescrape.mutate(ids, {
      onSuccess: (r) => {
        toast.success(`Rescraping ${r.count} product(s) — see Crawl History.`);
        setSelectedIds(new Set());
      },
      onError: (e) => toast.error((e as Error).message),
    });
  };

  // Profiles for the filter dropdown (all profiles, not just the current page).
  const profileNames = (useProfiles().data?.profiles ?? []).map((p) => p.fileName);

  const rows = data?.products ?? [];
  const total = data?.total ?? rows.length;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const selectablePageRows = rows.filter((p) => !p.synced);

  const onDeleteSelected = () => {
    del.mutate([...selectedIds], {
      onSuccess: () => {
        setSelectedIds(new Set());
        setShowDelete(false);
      },
    });
  };

  const toggleId = (id: number) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <>
      <PageHeader
        title="Products"
        description="Every product discovered by the scraper. Select products to sync to the main site, or click a row for detail."
        actions={
          <div className="flex items-center gap-2">
            {selectedIds.size > 0 && (
              <>
                <Button
                  variant="danger"
                  icon={<Trash2 className="h-4 w-4" />}
                  onClick={() => setShowDelete(true)}
                >
                  Delete ({selectedIds.size})
                </Button>
                <Button
                  variant="secondary"
                  icon={<RefreshCw className="h-4 w-4" />}
                  loading={rescrape.isPending}
                  onClick={onRescrapeSelected}
                  title="Re-fetch and overwrite the selected products"
                >
                  Rescrape ({selectedIds.size})
                </Button>
              </>
            )}
            <Button
              icon={<UploadCloud className="h-4 w-4" />}
              disabled={selectedIds.size === 0}
              onClick={() => navigate(`/sync?ids=${[...selectedIds].join(',')}`)}
            >
              Sync to main site{selectedIds.size ? ` (${selectedIds.size})` : ''}
            </Button>
          </div>
        }
      />

      <Card>
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-3 border-b border-line p-4">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              className="input pl-9"
              placeholder="Search title, URL, or ID…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </div>
          <select
            value={profileFilter}
            onChange={(e) => setProfileFilter(e.target.value)}
            className="h-9 max-w-[220px] rounded-lg border border-line bg-panel2 px-3 text-xs text-ink"
            title="Filter by profile"
          >
            <option value="">All profiles</option>
            {profileNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-1 rounded-lg border border-line bg-panel2 p-1">
            {(['all', 'scraped', 'unscraped', 'incomplete'] as Filter[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  'rounded-md px-3 py-1.5 text-xs font-semibold capitalize transition-colors',
                  filter === f ? 'bg-accent text-accent-ink' : 'text-muted hover:text-ink',
                )}
              >
                {f}
              </button>
            ))}
          </div>
          <span className="text-xs text-muted">
            {total} total{selectedIds.size ? ` · ${selectedIds.size} selected` : ''}
          </span>
        </div>

        <CardBody className="p-0">
          {isLoading || isFetching ? (
            <TableSkeleton rows={8} cols={7} />
          ) : isError ? (
            <ErrorState message={(error as Error).message} onRetry={() => refetch()} />
          ) : !rows.length ? (
            <EmptyState
              title="No products match"
              hint={search ? 'Try a different search.' : 'Run a crawl to discover products.'}
              icon={<Package className="h-5 w-5" />}
            />
          ) : (
            <>
            <Table>
              <THead>
                <TH className="w-10">
                  <input
                    type="checkbox"
                    className="h-4 w-4 cursor-pointer accent-accent"
                    title="Select all (unsynced) on this page"
                    checked={
                      selectablePageRows.length > 0 &&
                      selectablePageRows.every((p) => selectedIds.has(p.id))
                    }
                    onChange={(e) =>
                      setSelectedIds((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) selectablePageRows.forEach((p) => next.add(p.id));
                        else selectablePageRows.forEach((p) => next.delete(p.id));
                        return next;
                      })
                    }
                  />
                </TH>
                <TH className="w-12" />
                <TH>Title</TH>
                <TH>Price</TH>
                <TH>Profile</TH>
                <TH>Status</TH>
                <TH>Last seen</TH>
              </THead>
              <TBody>
                {rows.map((p) => (
                  <TR key={p.id} onClick={() => setSelected(p)}>
                    <TD>
                      <input
                        type="checkbox"
                        className="h-4 w-4 cursor-pointer accent-accent disabled:cursor-not-allowed disabled:opacity-40"
                        checked={selectedIds.has(p.id)}
                        disabled={!!p.synced}
                        title={p.synced ? 'Already synced to main site' : undefined}
                        onClick={(e) => e.stopPropagation()}
                        onChange={() => toggleId(p.id)}
                      />
                    </TD>
                    <TD>
                      <Thumb product={p} />
                    </TD>
                    <TD className="max-w-[320px]">
                      <div className="truncate font-medium text-ink">
                        {p.title || <span className="text-muted">Untitled</span>}
                      </div>
                      <div className="truncate text-xs text-muted">{p.product_url}</div>
                    </TD>
                    <TD className="whitespace-nowrap">{formatPrice(p.price, p.price_currency)}</TD>
                    <TD className="max-w-[140px] truncate text-xs text-muted">
                      {p.profile_file_name || '—'}
                    </TD>
                    <TD>
                      <div className="flex items-center gap-1.5">
                        {p.last_error ? (
                          <Badge tone="no">error</Badge>
                        ) : (
                          <Badge tone={p.scraped ? 'yes' : 'neutral'}>
                            {p.scraped ? 'scraped' : 'pending'}
                          </Badge>
                        )}
                        {p.synced && (
                          <Badge tone="info">
                            <CheckCircle2 className="mr-1 inline h-3 w-3" />
                            synced
                          </Badge>
                        )}
                      </div>
                    </TD>
                    <TD className="whitespace-nowrap text-xs text-muted">{timeAgo(p.last_seen_at)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            {pageCount > 1 && (
              <div className="flex items-center justify-between border-t border-line px-4 py-3 text-xs text-muted">
                <span>
                  Showing {page * PAGE_SIZE + 1}–{page * PAGE_SIZE + rows.length} of {total}
                  {isFetching && <span className="ml-2 opacity-60">updating…</span>}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    className="inline-flex items-center gap-1 rounded-lg border border-line bg-panel2 px-2.5 py-1.5 font-medium text-ink disabled:cursor-not-allowed disabled:opacity-40"
                    disabled={page === 0}
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                  >
                    <ChevronLeft className="h-3.5 w-3.5" /> Prev
                  </button>
                  <span>
                    Page {page + 1} / {pageCount}
                  </span>
                  <button
                    className="inline-flex items-center gap-1 rounded-lg border border-line bg-panel2 px-2.5 py-1.5 font-medium text-ink disabled:cursor-not-allowed disabled:opacity-40"
                    disabled={page >= pageCount - 1}
                    onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                  >
                    Next <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )}
            </>
          )}
        </CardBody>
      </Card>

      <ProductDetailDrawer product={selected} onClose={() => setSelected(null)} />

      <Modal
        open={showDelete}
        onClose={() => setShowDelete(false)}
        title="Delete products?"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setShowDelete(false)}>
              Cancel
            </Button>
            <Button variant="danger" size="sm" loading={del.isPending} onClick={onDeleteSelected}>
              Delete {selectedIds.size}
            </Button>
          </>
        }
      >
        This permanently removes <b className="text-ink">{selectedIds.size}</b> product listing
        {selectedIds.size === 1 ? '' : 's'} from the scraper database. This can’t be undone.
      </Modal>
    </>
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
      <img
        src={src}
        alt=""
        loading="lazy"
        className="h-full w-full object-cover"
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).src =
            'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg"/%3E';
        }}
      />
    </div>
  );
}
