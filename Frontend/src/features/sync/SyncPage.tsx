import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { UploadCloud, ArrowLeft, CheckCircle2, AlertTriangle, ImageIcon, Loader2 } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/states';
import { Modal } from '@/components/ui/Modal';
import { useSyncMeta, useSyncSellers, useSyncCategories, usePreviewSync, useSubmitSync } from '@/hooks/useApi';
import { htmlToText } from '@/lib/html';
import type { SyncCategory } from '@/types/api';
import { CategoryMappingModal } from './CategoryMappingModal';

/** Friendly labels for the condition codes the main API expects. */
const CONDITION_LABELS: Record<string, string> = {
  new: 'New',
  usedFunctional: 'Used',
};

interface Form {
  product_title: string;
  product_content: string;
  price_per_unit: string;
  categoryId: number | '';
  subcategoryId: number | '';
  item_condition: string;
  item_grade: string;
  operation_status: string;
  location: string;
  quantity: string;
  product_type: string;
  price_format: string;
  price_currency: string;
}

/**
 * Resolve the WP term id to send: the subcategory id if one is chosen, else the
 * category id. Category is required; subcategory is OPTIONAL — a category with
 * no chosen subcategory maps to the category itself.
 */
function effectiveTermId(f: Form): number | '' {
  if (f.categoryId === '') return '';
  return f.subcategoryId !== '' ? f.subcategoryId : f.categoryId;
}

/** Name of the effective (leaf) category, for sending to the main API. */
function effectiveCategoryName(f: Form, categories: SyncCategory[]): string {
  const cat = categories.find((c) => c.id === f.categoryId);
  if (!cat) return '';
  if (cat.subcategories.length && f.subcategoryId !== '') {
    return cat.subcategories.find((s) => s.id === f.subcategoryId)?.name || cat.name;
  }
  return cat.name;
}

export function SyncPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const productIds = useMemo(
    () =>
      (params.get('ids') || '')
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isInteger(n) && n > 0),
    [params],
  );

  const meta = useSyncMeta();
  const preview = usePreviewSync();
  const submit = useSubmitSync();

  const [marketplace, setMarketplace] = useState('');
  const [sellerId, setSellerId] = useState<number | null>(null);
  const [sellerName, setSellerName] = useState('');
  const [sellerSearchInput, setSellerSearchInput] = useState('');
  const [sellerSearch, setSellerSearch] = useState('');
  const [country, setCountry] = useState('Taiwan');
  const [forms, setForms] = useState<Record<number, Form>>({});

  // Sellers are loaded from the main site (searchable, server-side).
  useEffect(() => {
    const t = setTimeout(() => setSellerSearch(sellerSearchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [sellerSearchInput]);
  const sellersQ = useSyncSellers(sellerSearch);
  const sellers = sellersQ.data?.sellers ?? [];

  // Default marketplace once meta loads; default seller to the first loaded one.
  useEffect(() => {
    if (meta.data) setMarketplace((m) => m || meta.data.marketplaces[0]?.name || '');
  }, [meta.data]);
  useEffect(() => {
    if (sellerId == null && sellers.length) {
      setSellerId(sellers[0].id);
      setSellerName(sellers[0].displayName);
    }
  }, [sellers, sellerId]);

  // (Re)run preview when the batch or marketplace/seller changes.
  const previewMutate = preview.mutate;
  useEffect(() => {
    if (!productIds.length || !marketplace || sellerId == null) return;
    previewMutate({ productIds, marketplace, sellerId, sellerName, country, overrides: {} });
    // country/sellerName intentionally excluded from deps — they don't change mapping
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marketplace, sellerId, productIds.join(',')]);

  // Seed editable forms from the preview mapping (resets on marketplace change).
  const previewData = preview.data;
  useEffect(() => {
    if (!previewData) return;
    const next: Record<number, Form> = {};
    for (const r of previewData.results) {
      if (r.error) continue;
      const m = r.mapped as Record<string, unknown>;
      const arr0 = (v: unknown) => (Array.isArray(v) && v.length ? String(v[0]) : '');
      // Split the matched term into category + subcategory dropdown values.
      let categoryId: number | '' = '';
      let subcategoryId: number | '' = '';
      if (r.category) {
        if (r.category.isSub) {
          categoryId = r.category.parent ?? '';
          subcategoryId = r.category.term_id;
        } else {
          categoryId = r.category.term_id;
        }
      }
      next[r.productId] = {
        product_title: String(m.product_title ?? ''),
        product_content: htmlToText(m.product_content ?? ''),
        price_per_unit: String(m.price_per_unit ?? ''),
        categoryId,
        subcategoryId,
        item_condition: arr0(m.item_condition),
        item_grade: String(m.item_grade ?? ''),
        operation_status: arr0(m.operation_status) || 'deinstalled',
        location: arr0(m.location) || country,
        quantity: String(m.quantity ?? '1'),
        product_type: String(m.product_type ?? 'simple'),
        price_format: String(m.price_format ?? 'buyNow'),
        price_currency: String(m.price_currency ?? 'USD'),
      };
    }
    setForms(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewData]);

  // Categories load from the live API by site_type (config fallback handled
  // server-side). Re-fetches when the marketplace changes.
  const catsQ = useSyncCategories(marketplace);
  const categories: SyncCategory[] = catsQ.data?.categories ?? [];
  const enums = meta.data?.enums ?? {};
  const [addCatFor, setAddCatFor] = useState<number | null>(null);
  const [showCatMap, setShowCatMap] = useState(false);

  // Re-run the mapping preview (e.g. after saving category mappings).
  const rerunPreview = () => {
    if (productIds.length && marketplace && sellerId != null) {
      previewMutate({ productIds, marketplace, sellerId, sellerName, country, overrides: {} });
    }
  };

  const setField = (id: number, key: keyof Form, val: string | number) =>
    setForms((prev) => ({ ...prev, [id]: { ...prev[id], [key]: val } }));

  // Changing the category clears any previously-picked subcategory.
  const setCategory = (id: number, catId: number | '') =>
    setForms((prev) => ({ ...prev, [id]: { ...prev[id], categoryId: catId, subcategoryId: '' } }));

  const isReady = (f?: Form) =>
    !!f && effectiveTermId(f) !== '' && String(f.price_per_unit).trim() !== '';

  const readyIds = productIds.filter((id) => isReady(forms[id]));

  const onSubmit = () => {
    const overrides: Record<string, Record<string, unknown>> = {};
    for (const id of readyIds) {
      const f = forms[id];
      overrides[id] = {
        product_title: f.product_title,
        product_content: f.product_content,
        price_per_unit: f.price_per_unit,
        categoryId: effectiveTermId(f),
        categoryName: effectiveCategoryName(f, categories),
        item_condition: f.item_condition || undefined,
        item_grade: f.item_grade || undefined,
        operation_status: f.operation_status || undefined,
        location: f.location || undefined,
        quantity: f.quantity,
        product_type: f.product_type,
        price_format: f.price_format,
        price_currency: f.price_currency,
      };
    }
    submit.mutate({ productIds: readyIds, marketplace, sellerId: sellerId as number, sellerName, country, overrides });
  };

  if (!productIds.length) {
    return (
      <>
        <PageHeader title="Sync to main site" />
        <Card>
          <CardBody>
            <EmptyState
              title="No products selected"
              hint="Go to Products, tick the ones you want, then click ‘Sync to main site’."
              icon={<UploadCloud className="h-5 w-5" />}
            />
            <div className="mt-4 flex justify-center">
              <Button variant="secondary" icon={<ArrowLeft className="h-4 w-4" />} onClick={() => navigate('/products')}>
                Back to Products
              </Button>
            </div>
          </CardBody>
        </Card>
      </>
    );
  }

  if (meta.isLoading) return <LoadingState label="Loading sync options…" />;
  if (meta.isError) return <ErrorState message={(meta.error as Error).message} onRetry={() => meta.refetch()} />;

  const results = preview.data?.results ?? [];
  const submitted = submit.isSuccess;

  return (
    <>
      <PageHeader
        title="Sync to main site"
        description={`${productIds.length} product(s) selected · fill required fields, then sync.`}
        actions={
          <Button variant="ghost" icon={<ArrowLeft className="h-4 w-4" />} onClick={() => navigate('/products')}>
            Back
          </Button>
        }
      />

      {/* Prerequisites */}
      <Card>
        <CardBody className="grid gap-4 sm:grid-cols-3">
          <Field label="Marketplace (site type)">
            <select className="input" value={marketplace} onChange={(e) => setMarketplace(e.target.value)}>
              {meta.data!.marketplaces.map((m) => (
                <option key={m.name} value={m.name}>
                  {m.displayName} — {m.siteType}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Seller (from main site)">
            <input
              className="input mb-2"
              placeholder="Search sellers by name / email…"
              value={sellerSearchInput}
              onChange={(e) => setSellerSearchInput(e.target.value)}
            />
            <select
              className="input"
              value={sellerId ?? ''}
              onChange={(e) => {
                const id = Number(e.target.value);
                setSellerId(id);
                setSellerName(sellers.find((s) => s.id === id)?.displayName ?? '');
              }}
            >
              {sellerId != null && !sellers.some((s) => s.id === sellerId) && (
                <option value={sellerId}>{sellerName || `Seller #${sellerId}`}</option>
              )}
              {sellers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.displayName} (#{s.id})
                  {s.totalListings != null ? ` · ${s.totalListings} listings` : ''}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-muted">
              {sellersQ.isFetching ? 'Loading sellers…' : `${sellers.length} shown${sellersQ.data?.pagination ? ` of ${sellersQ.data.pagination.total}` : ''}`}
            </p>
          </Field>
          <Field label="Country">
            <input className="input" value={country} onChange={(e) => setCountry(e.target.value)} placeholder="e.g. Taiwan" />
          </Field>
        </CardBody>
      </Card>

      {/* Category mapping entry point */}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button variant="secondary" size="sm" onClick={() => setShowCatMap(true)}>
          Set category mapping
        </Button>
        <span className="text-xs text-muted">
          Map this site’s scraped categories → main-site categories once, so they auto-select.
        </span>
      </div>

      {/* Preview / mapping */}
      {preview.isPending ? (
        <div className="mt-4">
          <LoadingState label="Mapping products…" />
        </div>
      ) : preview.isError ? (
        <div className="mt-4">
          <ErrorState message={(preview.error as Error).message} />
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          {catsQ.isLoading && <p className="text-xs text-muted">Loading categories…</p>}
          {results.map((r) => {
            const f = forms[r.productId];
            if (r.error || !f) {
              return (
                <Card key={r.productId}>
                  <CardBody className="text-sm text-danger">
                    Product #{r.productId}: {r.error || 'could not map'}
                  </CardBody>
                </Card>
              );
            }
            const rdy = isReady(f);
            const priceMissing = String(f.price_per_unit).trim() === '';
            const selCat = categories.find((c) => c.id === f.categoryId);
            const subs = selCat?.subcategories ?? [];
            const topMissing = f.categoryId === '';
            return (
              <Card key={r.productId}>
                <CardBody className="space-y-3">
                  {/* Header */}
                  <div className="flex items-start gap-3">
                    <Thumb src={r.images[0]} />
                    <div className="min-w-0 flex-1">
                      <input
                        className="input font-medium"
                        value={f.product_title}
                        onChange={(e) => setField(r.productId, 'product_title', e.target.value)}
                        placeholder="Product title"
                      />
                    </div>
                    <Badge tone={rdy ? 'yes' : 'warn'}>
                      {rdy ? (
                        <>
                          <CheckCircle2 className="mr-1 inline h-3 w-3" /> ready
                        </>
                      ) : (
                        <>
                          <AlertTriangle className="mr-1 inline h-3 w-3" /> needs fields
                        </>
                      )}
                    </Badge>
                  </div>

                  {/* Scraped category that didn't match the main-site list */}
                  {r.scrapedCategory && !r.autoMatched && (
                    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-warn/40 bg-amber-900/20 p-2.5 text-xs text-amber-200">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                      <span>
                        Scraped category <b>“{r.scrapedSubcategory || r.scrapedCategory}”</b> isn’t in
                        the main-site list — pick one below to map it, or ask us to add it if it’s missing.
                      </span>
                      {/* <Button size="sm" variant="secondary" onClick={() => setAddCatFor(r.productId)}>
                        Add to main DB
                      </Button> */}
                    </div>
                  )}

                  {/* Fields grid */}
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <Field label="Category *" warn={topMissing}>
                      <select
                        className="input"
                        value={f.categoryId}
                        onChange={(e) =>
                          setCategory(r.productId, e.target.value ? Number(e.target.value) : '')
                        }
                      >
                        <option value="">— select —</option>
                        {categories.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                      {r.autoMatched && effectiveTermId(f) === r.category?.term_id && (
                        <p className="mt-1 text-[11px] text-accent">
                          {r.fromMapping ? 'from category mapping · confirm or change' : 'auto-matched · confirm or change'}
                        </p>
                      )}
                    </Field>
                    <Field label="Subcategory">
                      <select
                        className="input disabled:opacity-50"
                        value={f.subcategoryId}
                        disabled={subs.length === 0}
                        onChange={(e) =>
                          setField(r.productId, 'subcategoryId', e.target.value ? Number(e.target.value) : '')
                        }
                      >
                        <option value="">{subs.length ? '— (use category) —' : '— none —'}</option>
                        {subs.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Price / unit *" warn={priceMissing}>
                      <input
                        type="number"
                        className="input"
                        value={f.price_per_unit}
                        onChange={(e) => setField(r.productId, 'price_per_unit', e.target.value)}
                        placeholder="e.g. 4500"
                      />
                    </Field>
                    <Field label="Currency">
                      <SelectEnum value={f.price_currency} opts={enums.price_currency} onChange={(v) => setField(r.productId, 'price_currency', v)} />
                    </Field>
                    <Field label="Condition">
                      <SelectEnum value={f.item_condition} opts={enums.item_condition} labels={CONDITION_LABELS} onChange={(v) => setField(r.productId, 'item_condition', v)} allowEmpty />
                    </Field>
                    <Field label="Grade">
                      <SelectEnum value={f.item_grade} opts={enums.item_grade} onChange={(v) => setField(r.productId, 'item_grade', v)} allowEmpty />
                    </Field>
                    <Field label="Operation status">
                      <SelectEnum value={f.operation_status} opts={enums.operation_status} onChange={(v) => setField(r.productId, 'operation_status', v)} />
                    </Field>
                    <Field label="Location">
                      <input className="input" value={f.location} onChange={(e) => setField(r.productId, 'location', e.target.value)} />
                    </Field>
                    <Field label="Quantity">
                      <input type="number" className="input" value={f.quantity} onChange={(e) => setField(r.productId, 'quantity', e.target.value)} />
                    </Field>
                    <Field label="Type / price format">
                      <div className="flex gap-2">
                        <SelectEnum value={f.product_type} opts={enums.product_type} onChange={(v) => setField(r.productId, 'product_type', v)} />
                        <SelectEnum value={f.price_format} opts={enums.price_format} onChange={(v) => setField(r.productId, 'price_format', v)} />
                      </div>
                    </Field>
                  </div>
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}

      {/* Submit bar */}
      <div className="sticky bottom-0 mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-panel px-4 py-3 shadow-card">
        <span className="text-sm text-muted">
          <b className="text-ink">{readyIds.length}</b> of {productIds.length} ready
        </span>
        {submit.isError && (
          <span className="flex items-center gap-1 text-xs text-danger">
            <AlertTriangle className="h-3.5 w-3.5" /> {(submit.error as Error).message}
          </span>
        )}
        {submitted && (
          <span className="flex items-center gap-1 text-xs text-accent">
            <CheckCircle2 className="h-3.5 w-3.5" /> Synced {submit.data?.count} product(s) to main site
          </span>
        )}
        <div className="ml-auto flex gap-2">
          {submitted ? (
            <Button onClick={() => navigate('/products')}>Done</Button>
          ) : (
            <Button
              icon={submit.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
              disabled={readyIds.length === 0 || submit.isPending}
              onClick={onSubmit}
            >
              {submit.isPending ? 'Syncing…' : `Sync ${readyIds.length} product(s)`}
            </Button>
          )}
        </div>
      </div>

      {/* "Add category to main DB" — placeholder (feature coming soon) */}
      <Modal
        open={addCatFor != null}
        onClose={() => setAddCatFor(null)}
        title="Add category to main site"
        footer={
          <Button size="sm" onClick={() => setAddCatFor(null)}>
            Got it
          </Button>
        }
      >
        Adding new categories to the main site is <b className="text-ink">coming soon</b>. For now,
        please pick the closest existing category from the dropdown on the product.
      </Modal>

      <CategoryMappingModal
        open={showCatMap}
        onClose={() => setShowCatMap(false)}
        marketplace={marketplace}
        productIds={productIds}
        onSaved={rerunPreview}
      />
    </>
  );
}

function Field({
  label,
  children,
  warn,
}: {
  label: string;
  children: React.ReactNode;
  warn?: boolean;
}) {
  return (
    <div>
      <label className={`mb-1 block text-xs font-medium ${warn ? 'text-danger' : 'text-muted'}`}>{label}</label>
      {children}
    </div>
  );
}

function SelectEnum({
  value,
  opts,
  onChange,
  allowEmpty,
  labels,
}: {
  value: string;
  opts?: string[];
  onChange: (v: string) => void;
  allowEmpty?: boolean;
  /** Optional value→display-label map (e.g. usedFunctional → "Used"). */
  labels?: Record<string, string>;
}) {
  return (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
      {allowEmpty && <option value="">—</option>}
      {(opts ?? []).map((o) => (
        <option key={o} value={o}>
          {labels?.[o] ?? o}
        </option>
      ))}
    </select>
  );
}

function Thumb({ src }: { src?: string }) {
  if (!src) {
    return (
      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-panel2 text-muted">
        <ImageIcon className="h-5 w-5" />
      </div>
    );
  }
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      className="h-14 w-14 shrink-0 rounded-lg border border-line object-cover"
      onError={(e) => ((e.currentTarget as HTMLImageElement).style.visibility = 'hidden')}
    />
  );
}
