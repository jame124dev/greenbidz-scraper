import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ChevronRight,
  ChevronDown,
  Loader2,
  AlertTriangle,
  Package,
  FolderTree,
  X,
  RefreshCw,
} from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import type { MappingDraft } from './types';

interface Props {
  draft: MappingDraft;
  onChange: (patch: Partial<MappingDraft>) => void;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Derive a URL pattern from a clicked sample, anchored on its FIRST path segment
 * (e.g. /item/foo/123 → "/item/"). That matches every sibling URL — usually the
 * whole product (or category) section — and the live match count lets the user
 * confirm or hand-edit.
 */
function patternsFromUrl(u: string): { product: string; full: string } | null {
  try {
    const url = new URL(u);
    const segs = url.pathname.split('/').filter(Boolean);
    if (!segs.length) return null;
    const first = segs[0];
    return {
      product: `/${escapeRegex(first)}/`,
      full: `${escapeRegex(url.origin)}/${escapeRegex(first)}/.+`,
    };
  } catch {
    return null;
  }
}

export function SitemapStep({ draft, onChange }: Props) {
  const siteUrl = draft.listingUrl;
  const [pickMode, setPickMode] = useState<'product' | 'category'>('product');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const summary = useQuery({
    queryKey: ['sitemap-summary', siteUrl, draft.sitemapUrl ?? ''],
    queryFn: () => api.getSitemapSummary(siteUrl, draft.sitemapUrl),
    enabled: !!siteUrl,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const productPattern = draft.productUrlPattern ?? '';
  const match = useQuery({
    queryKey: ['sitemap-match', siteUrl, draft.sitemapUrl ?? '', productPattern],
    queryFn: () => api.getSitemapMatch(siteUrl, productPattern, draft.sitemapUrl),
    enabled: !!siteUrl && !!productPattern,
    retry: false,
  });

  const categoryPatterns = draft.categoryPatterns ?? [];

  const pickSample = (url: string) => {
    const p = patternsFromUrl(url);
    if (!p) return;
    if (pickMode === 'product') {
      onChange({
        productUrlPattern: p.product,
        urlPattern: p.full,
        sampleProductUrl: url,
        domain: draft.domain || hostOf(url),
      });
    } else {
      const next = Array.from(new Set([...categoryPatterns, p.product]));
      onChange({ categoryPatterns: next });
    }
  };

  const removeCategory = (pat: string) =>
    onChange({ categoryPatterns: categoryPatterns.filter((c) => c !== pat) });

  const sections = summary.data?.sections ?? [];
  const totalUrls = summary.data?.totalUrls ?? 0;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_360px]">
      {/* Sitemap sections */}
      <div className="card flex max-h-[calc(100vh-360px)] min-h-[420px] flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold text-ink">Sitemap</h3>
            <p className="text-[11px] text-muted">
              {summary.isLoading
                ? 'Reading the site’s sitemap…'
                : summary.isError
                  ? 'Could not read a sitemap.'
                  : `${sections.length} section(s), ${totalUrls.toLocaleString()} URL(s). Click a sample to set the ${pickMode} pattern.`}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            icon={<RefreshCw className={cn('h-3.5 w-3.5', summary.isFetching && 'animate-spin')} />}
            onClick={() => summary.refetch()}
            disabled={summary.isFetching || !siteUrl}
          >
            Reload
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {summary.isLoading && (
            <div className="flex h-40 items-center justify-center gap-2 text-sm text-muted">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading sitemap (large sites can take a moment)…
            </div>
          )}
          {summary.isError && (
            <div className="m-2 flex items-start gap-2 rounded-lg border border-warn/40 bg-amber-900/20 p-3 text-xs text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                {(summary.error as Error)?.message ||
                  'No sitemap found. This site may not publish one — use Auto mode to fall back to listing-page crawling.'}
              </div>
            </div>
          )}
          {!summary.isLoading &&
            !summary.isError &&
            sections.map((s) => {
              const open = expanded.has(s.loc);
              return (
                <div key={s.loc} className="mb-1 rounded-lg border border-line">
                  <button
                    type="button"
                    onClick={() =>
                      setExpanded((prev) => {
                        const n = new Set(prev);
                        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
                        n.has(s.loc) ? n.delete(s.loc) : n.add(s.loc);
                        return n;
                      })
                    }
                    className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-panel2"
                  >
                    {open ? (
                      <ChevronDown className="h-4 w-4 shrink-0 text-muted" />
                    ) : (
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted" />
                    )}
                    <span className="flex-1 truncate font-mono text-xs text-ink">{s.label}</span>
                    <Badge tone="neutral">{s.urlCount.toLocaleString()}</Badge>
                  </button>
                  {open && (
                    <div className="border-t border-line p-1">
                      {s.sampleUrls.map((u) => (
                        <button
                          key={u}
                          type="button"
                          onClick={() => pickSample(u)}
                          className="block w-full truncate rounded px-2 py-1 text-left font-mono text-[11px] text-sky-300 hover:bg-accent/10 hover:text-accent"
                          title={u}
                        >
                          {u}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
        </div>
      </div>

      {/* Picker panel */}
      <div className="space-y-4">
        <div className="card p-4">
          <label className="mb-2 block text-[11px] uppercase tracking-wide text-muted">Picking as</label>
          <div className="inline-flex w-full items-center gap-1 rounded-lg border border-line bg-panel2 p-1">
            {([
              { value: 'product', label: 'Product', icon: Package },
              { value: 'category', label: 'Category', icon: FolderTree },
            ] as const).map((m) => {
              const Icon = m.icon;
              return (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => setPickMode(m.value)}
                  className={cn(
                    'flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold',
                    pickMode === m.value ? 'bg-accent text-accent-ink' : 'text-muted',
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {m.label}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-[11px] text-muted">
            Click sample URLs on the left to set the {pickMode} pattern. Products are scraped;
            categories are saved for later category browsing.
          </p>
        </div>

        {/* Product pattern + live match count */}
        <div className="card p-4">
          <label className="mb-1.5 block text-[11px] uppercase tracking-wide text-muted">
            Product URL pattern (regex)
          </label>
          <input
            className="input font-mono text-xs"
            value={productPattern}
            placeholder="click a product sample, or type"
            onChange={(e) => onChange({ productUrlPattern: e.target.value })}
          />
          <div className="mt-2 text-xs">
            {!productPattern ? (
              <span className="text-muted">No product pattern yet.</span>
            ) : match.isFetching ? (
              <span className="flex items-center gap-1.5 text-muted">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Counting matches…
              </span>
            ) : match.isError ? (
              <span className="text-danger">{(match.error as Error).message}</span>
            ) : match.data ? (
              <span className={match.data.matched > 0 ? 'text-accent' : 'text-warn'}>
                <b>{match.data.matched.toLocaleString()}</b> of {match.data.total.toLocaleString()} URLs match
              </span>
            ) : null}
          </div>
        </div>

        {/* Category patterns */}
        <div className="card p-4">
          <label className="mb-1.5 block text-[11px] uppercase tracking-wide text-muted">
            Category patterns ({categoryPatterns.length})
          </label>
          {categoryPatterns.length === 0 ? (
            <p className="text-[11px] text-muted">
              None yet — switch to <b>Category</b> and click a category sample.
            </p>
          ) : (
            <div className="space-y-1">
              {categoryPatterns.map((c) => (
                <div key={c} className="flex items-center gap-2 rounded bg-panel2 px-2 py-1">
                  <code className="flex-1 truncate font-mono text-[11px] text-sky-300" title={c}>
                    {c}
                  </code>
                  <button
                    type="button"
                    onClick={() => removeCategory(c)}
                    className="text-muted hover:text-danger"
                    title="Remove"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}
