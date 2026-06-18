import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search, Package, ImageIcon, ExternalLink, ChevronLeft, ChevronRight, UploadCloud, CheckCircle2,
} from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/Table';
import { ErrorState, TableSkeleton, EmptyState } from '@/components/ui/states';
import { useProducts, useProfiles } from '@/hooks/useApi';
import type { Product } from '@/types/api';
import { formatPrice } from '@/lib/format';
import { RelTime } from '@/components/ui/RelTime';
import { productImageUrl } from '@/lib/productImage';
import { ProductDetailDrawer } from './ProductDetailDrawer';

const PAGE_SIZE = 50;

/** Products already synced to the main site — filterable by profile, with the
 *  main-site id + public link, and the same detail drawer as the Products page. */
export function SyncProductsPage() {
  const navigate = useNavigate();
  const [profileFilter, setProfileFilter] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Product | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [page, setPage] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => setPage(0), [profileFilter, search]);

  const { data, isLoading, isError, error, refetch, isFetching } = useProducts({
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
    status: 'synced',
    profile: profileFilter || undefined,
    search: search || undefined,
  });

  const profileNames = (useProfiles().data?.profiles ?? []).map((p) => p.fileName);

  const rows = data?.products ?? [];
  const total = data?.total ?? rows.length;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const toggleId = (id: number) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allPageSelected = rows.length > 0 && rows.every((p) => selectedIds.has(p.id));

  // Build the re-sync link; if all selected products share one stored seller,
  // pass it so the Sync page prefills that seller for the update.
  const selectedRows = rows.filter((p) => selectedIds.has(p.id));
  const sellerIds = [...new Set(selectedRows.map((p) => p.main_seller_id).filter((v) => v != null))];
  let resyncHref = `/sync?ids=${[...selectedIds].join(',')}`;
  if (sellerIds.length === 1) {
    const s = selectedRows.find((p) => p.main_seller_id === sellerIds[0]);
    resyncHref += `&sellerId=${sellerIds[0]}`;
    if (s?.main_seller_name) resyncHref += `&sellerName=${encodeURIComponent(s.main_seller_name)}`;
  }

  return (
    <>
      <PageHeader
        title="Sync Products"
        description="Products already pushed to the main site. Click a row for detail, or re-sync to update the main listing."
        actions={
          <Button
            icon={<UploadCloud className="h-4 w-4" />}
            disabled={selectedIds.size === 0}
            onClick={() => navigate(resyncHref)}
            title="Re-sync the selected products (updates the existing main-site listing)"
          >
            Re-sync to main{selectedIds.size ? ` (${selectedIds.size})` : ''}
          </Button>
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
          <span className="text-xs text-muted">
            {total} synced{selectedIds.size ? ` · ${selectedIds.size} selected` : ''}
          </span>
        </div>

        <CardBody className="p-0">
          {isLoading || isFetching ? (
            <TableSkeleton rows={8} cols={7} />
          ) : isError ? (
            <ErrorState message={(error as Error).message} onRetry={() => refetch()} />
          ) : !rows.length ? (
            <EmptyState
              title="No synced products"
              hint={
                search || profileFilter
                  ? 'Try a different search or profile.'
                  : 'Sync some products to the main site and they’ll appear here.'
              }
              icon={<Package className="h-5 w-5" />}
              action={
                search || profileFilter ? undefined : (
                  <Button icon={<UploadCloud className="h-4 w-4" />} onClick={() => navigate('/products')}>
                    Go to Products
                  </Button>
                )
              }
            />
          ) : (
            <>
              <Table>
                <THead>
                  <TH className="w-10">
                    <input
                      type="checkbox"
                      className="h-4 w-4 cursor-pointer accent-accent"
                      title="Select all on this page"
                      checked={allPageSelected}
                      onChange={(e) =>
                        setSelectedIds((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) rows.forEach((p) => next.add(p.id));
                          else rows.forEach((p) => next.delete(p.id));
                          return next;
                        })
                      }
                    />
                  </TH>
                  <TH className="w-12" />
                  <TH>Title</TH>
                  <TH>Price</TH>
                  <TH>Profile</TH>
                  <TH>Main site</TH>
                  <TH>Synced</TH>
                </THead>
                <TBody>
                  {rows.map((p) => (
                    <TR key={p.id} onClick={() => setSelected(p)}>
                      <TD>
                        <input
                          type="checkbox"
                          className="h-4 w-4 cursor-pointer accent-accent"
                          checked={selectedIds.has(p.id)}
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
                      <TD className="whitespace-nowrap text-xs">
                        <div className="flex items-center gap-2">
                          <Badge tone="info">
                            <CheckCircle2 className="mr-1 inline h-3 w-3" />#{p.main_product_id ?? '—'}
                          </Badge>
                          {p.main_product_url && (
                            <a
                              href={p.main_product_url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-sky2 hover:underline"
                              onClick={(e) => e.stopPropagation()}
                              title="Open the listing on the main site"
                            >
                              open <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                        </div>
                      </TD>
                      <TD className="whitespace-nowrap text-xs text-muted">
                        <RelTime iso={p.synced_at ?? p.last_seen_at} />
                      </TD>
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
      <img src={src} alt="" loading="lazy" className="h-full w-full object-cover" />
    </div>
  );
}
