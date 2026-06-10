import { ExternalLink, ImageOff, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import { Drawer } from '@/components/ui/Drawer';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { LoadingState, ErrorState } from '@/components/ui/states';
import { useProduct, useRescrape } from '@/hooks/useApi';
import type { Product } from '@/types/api';
import { formatDate, formatPrice } from '@/lib/format';
import { htmlToText } from '@/lib/html';
import { productImageUrls } from '@/lib/productImage';

export function ProductDetailDrawer({
  product,
  onClose,
}: {
  product: Product | null;
  onClose: () => void;
}) {
  // We already have the list row; fetch full detail (raw_data, description) by id.
  const detail = useProduct(product?.id ?? null);
  const full = detail.data?.product ?? product ?? undefined;
  const rescrape = useRescrape();

  return (
    <Drawer
      open={!!product}
      onClose={onClose}
      title={full?.title || 'Product detail'}
      subtitle={full?.product_url}
    >
      {!full ? null : (
        <div className="space-y-6">
          {/* Image gallery */}
          <Gallery product={full} />

          {/* Key facts */}
          <div className="grid grid-cols-2 gap-3">
            <Fact label="Price" value={formatPrice(full.price, full.price_currency)} />
            <Fact label="Currency" value={full.price_currency || 'USD'} mono />
            <Fact
              label="Status"
              value={<Badge tone={full.scraped ? 'yes' : 'no'}>{full.scraped ? 'scraped' : 'pending'}</Badge>}
            />
            <Fact label="Profile" value={full.profile_file_name || '—'} mono />
            <Fact label="External ID" value={full.external_id} mono />
            <Fact label="First seen" value={formatDate(full.first_seen_at)} />
            <Fact label="Last seen" value={formatDate(full.last_seen_at)} />
            <Fact label="Scraped at" value={formatDate(full.scraped_at)} />
            <Fact label="Attempts" value={full.scrape_attempts ?? '—'} />
          </div>

          <div className="flex items-center gap-3">
            <a
              href={full.product_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-sky2 hover:underline"
            >
              Open source page <ExternalLink className="h-3.5 w-3.5" />
            </a>
            <Button
              size="sm"
              variant="secondary"
              icon={<RefreshCw className="h-3.5 w-3.5" />}
              loading={rescrape.isPending}
              onClick={() =>
                rescrape.mutate([full.id], {
                  onSuccess: () => toast.success('Rescraping — see Crawl History.'),
                  onError: (e) => toast.error((e as Error).message),
                })
              }
              title="Re-fetch and overwrite this product"
            >
              Rescrape
            </Button>
          </div>

          {full.last_error && (
            <div className="rounded-lg border border-danger/30 bg-red-900/20 p-3 text-xs text-red-300">
              <div className="mb-1 font-semibold uppercase tracking-wide">Last error</div>
              {full.last_error}
            </div>
          )}

          {/* Description */}
          {detail.isLoading ? (
            <LoadingState label="Loading detail…" />
          ) : detail.isError ? (
            <ErrorState message={(detail.error as Error).message} onRetry={() => detail.refetch()} />
          ) : (
            <>
              {full.description && (
                <Section title="Description">
                  <p className="whitespace-pre-wrap text-sm text-muted">{htmlToText(full.description)}</p>
                </Section>
              )}
              {full.raw_data != null && (
                <Section title="Raw data">
                  <pre className="max-h-80 overflow-auto rounded-lg border border-line bg-bg p-3 font-mono text-xs text-muted">
                    {JSON.stringify(full.raw_data, null, 2)}
                  </pre>
                </Section>
              )}
            </>
          )}
        </div>
      )}
    </Drawer>
  );
}

function Gallery({ product }: { product: Product }) {
  const images = productImageUrls(product);
  if (!images.length) {
    return (
      <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-line text-muted">
        <ImageOff className="mr-2 h-5 w-5" /> No images
      </div>
    );
  }
  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {images.map((src, i) => (
        <img
          key={i}
          src={src}
          alt={`product ${i + 1}`}
          loading="lazy"
          className="h-40 w-40 shrink-0 rounded-lg border border-line object-cover"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = 'none';
          }}
        />
      ))}
    </div>
  );
}

function Fact({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="rounded-lg border border-line bg-panel2/50 p-3">
      <div className="text-[10px] uppercase tracking-wide text-muted">{label}</div>
      <div className={mono ? 'mt-0.5 break-all font-mono text-xs text-ink' : 'mt-0.5 text-sm text-ink'}>
        {value}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{title}</h3>
      {children}
    </div>
  );
}
