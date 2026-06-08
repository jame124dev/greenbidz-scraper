import { useEffect, useMemo, useRef, useState } from 'react';
import { History, AlertCircle, Loader2, X, Radar } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/Table';
import { ErrorState, TableSkeleton, EmptyState } from '@/components/ui/states';
import { useCrawlHistory, useActiveCrawls, useCancelScrape } from '@/hooks/useApi';
import { formatNumber, formatDate, formatDuration, hostFromUrl } from '@/lib/format';
import { cn } from '@/lib/cn';
import type { ActiveCrawl } from '@/types/api';

function statusTone(status: string | null): 'yes' | 'no' | 'warn' | 'neutral' {
  const s = (status || '').toLowerCase();
  if (s.includes('complete') || s === 'success' || s === 'ok') return 'yes';
  if (s.includes('fail') || s.includes('error')) return 'no';
  if (s.includes('partial') || s.includes('warn')) return 'warn';
  return 'neutral';
}

export function CrawlsPage() {
  const { data, isLoading, isError, error, refetch } = useCrawlHistory(200);
  const { data: activeData } = useActiveCrawls();
  const qc = useQueryClient();
  const [onlyErrors, setOnlyErrors] = useState(false);

  const active = activeData?.active ?? [];

  // When a running crawl finishes (active count drops), refresh the history.
  const prevActive = useRef(0);
  useEffect(() => {
    if (active.length < prevActive.current) {
      qc.invalidateQueries({ queryKey: ['crawl-history'] });
    }
    prevActive.current = active.length;
  }, [active.length, qc]);

  const rows = useMemo(() => {
    const list = data?.history ?? [];
    return onlyErrors
      ? list.filter((r) => statusTone(r.status) === 'no' || (r.failed_products ?? 0) > 0)
      : list;
  }, [data, onlyErrors]);

  return (
    <>
      <PageHeader
        title="Crawl History"
        description="Every crawl run recorded by the scheduler and on-demand scrapes."
      />

      {/* Live: crawls running right now */}
      {active.length > 0 && (
        <Card className="mb-5 border-accent/40">
          <div className="flex items-center gap-2 border-b border-line p-4">
            <Radar className="h-4 w-4 animate-pulse text-accent" />
            <span className="text-sm font-semibold text-ink">Running now</span>
            <Badge tone="info">{active.length}</Badge>
          </div>
          <CardBody className="p-0">
            <ul className="divide-y divide-line">
              {active.map((c) => (
                <ActiveCrawlRow key={c.id} crawl={c} />
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-4">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-muted">
            <input
              type="checkbox"
              checked={onlyErrors}
              onChange={(e) => setOnlyErrors(e.target.checked)}
              className="h-4 w-4 rounded border-line bg-panel2 accent-accent"
            />
            <AlertCircle className="h-4 w-4" />
            Only runs with failures
          </label>
          <span className="text-xs text-muted">{rows.length} runs</span>
        </div>

        <CardBody className="p-0">
          {isLoading ? (
            <TableSkeleton rows={8} cols={8} />
          ) : isError ? (
            <ErrorState message={(error as Error).message} onRetry={() => refetch()} />
          ) : !rows.length ? (
            <EmptyState
              title="No crawl runs"
              hint="Runs appear here once the scheduler or an on-demand scrape executes."
              icon={<History className="h-5 w-5" />}
            />
          ) : (
            <Table>
              <THead>
                <TH>When</TH>
                <TH>Listing</TH>
                <TH>Found</TH>
                <TH>New</TH>
                <TH>Scraped</TH>
                <TH>Failed</TH>
                <TH>Duration</TH>
                <TH>Status</TH>
              </THead>
              <TBody>
                {rows.map((r) => (
                  <TR key={r.id}>
                    <TD className="whitespace-nowrap text-muted">{formatDate(r.timestamp)}</TD>
                    <TD className="max-w-[260px]">
                      <div className="truncate text-ink" title={r.listing_url}>
                        {hostFromUrl(r.listing_url)}
                      </div>
                      {r.error_message && (
                        <div className="truncate text-xs text-danger" title={r.error_message}>
                          {r.error_message}
                        </div>
                      )}
                    </TD>
                    <TD>{formatNumber(r.products_found)}</TD>
                    <TD className="text-accent">{formatNumber(r.new_products)}</TD>
                    <TD className="text-emerald-300">{formatNumber(r.scraped_products)}</TD>
                    <TD className={cn((r.failed_products ?? 0) > 0 && 'text-danger')}>
                      {formatNumber(r.failed_products)}
                    </TD>
                    <TD className="whitespace-nowrap text-muted">
                      {formatDuration(r.crawl_duration_seconds)}
                    </TD>
                    <TD>
                      <Badge tone={statusTone(r.status)}>{r.status || 'unknown'}</Badge>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>
    </>
  );
}

function ActiveCrawlRow({ crawl }: { crawl: ActiveCrawl }) {
  const cancel = useCancelScrape();
  const host = crawl.listingUrls[0] ? hostFromUrl(crawl.listingUrls[0]) : 'crawl';
  const more = crawl.listingUrls.length > 1 ? ` +${crawl.listingUrls.length - 1}` : '';
  const phaseLabel =
    crawl.phase === 'scraping'
      ? `Scraping ${crawl.scraped}/${crawl.total || '?'}`
      : crawl.phase === 'discovering' || crawl.phase === 'starting'
        ? 'Discovering products…'
        : crawl.phase;
  const pct = crawl.total > 0 ? Math.min(100, Math.round((crawl.scraped / crawl.total) * 100)) : null;

  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <Loader2 className="h-4 w-4 shrink-0 animate-spin text-accent" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-ink">
            {host}
            {more}
          </span>
          <Badge tone="info">running</Badge>
        </div>
        <div className="mt-0.5 flex items-center gap-3 text-xs text-muted">
          <span>{phaseLabel}</span>
          <span>· {formatNumber(crawl.found)} found</span>
          {crawl.failed > 0 && <span className="text-danger">· {crawl.failed} failed</span>}
        </div>
        {/* progress bar */}
        <div className="mt-2 h-1 w-full overflow-hidden rounded bg-panel2">
          <div
            className={cn('h-full rounded bg-accent transition-all', pct == null && 'w-1/3 animate-pulse')}
            style={pct == null ? undefined : { width: `${pct}%` }}
          />
        </div>
      </div>
      <Button
        size="sm"
        variant="ghost"
        icon={<X className="h-3.5 w-3.5" />}
        loading={cancel.isPending}
        onClick={() => cancel.mutate(crawl.id)}
        title="Cancel this crawl"
      >
        Cancel
      </Button>
    </li>
  );
}
