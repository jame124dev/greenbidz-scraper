import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  CheckCircle2,
  Loader2,
  Package,
  AlertTriangle,
  Search,
  Square,
  Ban,
  Minimize2,
} from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';

/**
 * Polls /api/scrape-progress and shows an animated "scraping…" screen with a
 * Stop button, resolving into a completion / stopped / error summary.
 */
export function ScrapeProgress({ jobId, onBuildAnother }: { jobId: string; onBuildAnother: () => void }) {
  const navigate = useNavigate();
  const [stopping, setStopping] = useState(false);

  const { data, isError } = useQuery({
    queryKey: ['scrape-progress', jobId],
    queryFn: () => api.getScrapeProgress(jobId),
    refetchInterval: (q) => {
      const job = q.state.data?.job;
      return job && job.status !== 'running' ? false : 800;
    },
  });

  const cancel = useMutation({
    mutationFn: () => api.cancelScrape(jobId),
    onSuccess: () => setStopping(true),
  });

  const job = data?.job;
  const running = job?.status === 'running';
  const cancelled = job?.status === 'cancelled';
  const done = job?.status === 'done';
  const errored = job?.status === 'error' || isError;

  const total = job?.total ?? 0;
  const processed = (job?.scraped ?? 0) + (job?.failed ?? 0);
  const pct = total ? Math.min(100, Math.round((processed / total) * 100)) : done ? 100 : 0;
  const discovering = running && (job?.phase === 'starting' || total === 0);

  return (
    <div className="mx-auto max-w-lg">
      <div className="card p-8 text-center">
        {/* Icon */}
        <div
          className={cn(
            'mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full ring-4 ring-inset',
            errored
              ? 'bg-red-900/30 ring-red-900/20'
              : cancelled
                ? 'bg-amber-900/30 ring-amber-900/20'
                : done
                  ? 'bg-emerald-900/30 ring-emerald-900/20'
                  : 'bg-sky-900/20 ring-sky-900/20',
          )}
        >
          {errored ? (
            <AlertTriangle className="h-8 w-8 text-danger" />
          ) : cancelled ? (
            <Ban className="h-8 w-8 text-warn" />
          ) : done ? (
            <CheckCircle2 className="h-8 w-8 text-accent" />
          ) : discovering ? (
            <Search className="h-8 w-8 animate-pulse text-sky2" />
          ) : (
            <Package className="h-8 w-8 animate-bounce text-sky2" />
          )}
        </div>

        <h2 className="text-lg font-bold text-ink">
          {errored
            ? 'Scrape failed'
            : cancelled
              ? 'Scrape stopped'
              : done
                ? 'Scrape complete'
                : discovering
                  ? 'Discovering products…'
                  : 'Scraping products…'}
        </h2>

        {/* Counters */}
        <div className="mt-2 text-sm text-muted">
          {errored ? (
            job?.error || 'Something went wrong during the crawl.'
          ) : (
            <>
              Found <b className="text-ink">{job?.found ?? 0}</b>
              {total > 0 && (
                <>
                  {' · '}this run <b className="text-ink">{total}</b>
                  {' · '}scraped <b className="text-accent">{job?.scraped ?? 0}</b>
                  {(job?.failed ?? 0) > 0 && (
                    <>
                      {' · '}
                      <b className="text-danger">{job?.failed}</b> failed
                    </>
                  )}
                </>
              )}
            </>
          )}
        </div>

        {/* Progress bar */}
        {!errored && (
          <div className="mx-auto mt-5">
            <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-panel2">
              {discovering ? (
                // Indeterminate sliding bar while we don't know the total yet.
                <div
                  className="absolute top-0 h-full rounded-full bg-sky2 animate-indeterminate"
                  style={{ left: '-40%', width: '40%' }}
                />
              ) : (
                <div
                  className={cn(
                    'h-full rounded-full transition-all duration-500',
                    cancelled ? 'bg-warn' : done ? 'bg-accent' : 'bg-sky2',
                  )}
                  style={{ width: `${pct}%` }}
                />
              )}
            </div>
            <div className="mt-1.5 text-right text-xs font-medium text-muted">
              {discovering ? 'scanning…' : `${pct}%`}
            </div>
          </div>
        )}

        {/* Current item */}
        {running && job?.current && (
          <div className="mx-auto mt-4 flex items-center gap-2 rounded-lg border border-line bg-panel2/50 px-3 py-2 text-xs text-muted">
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-sky2" />
            <span className="truncate">{job.current}</span>
          </div>
        )}

        {/* Actions */}
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {running ? (
            <>
              <Button
                icon={<Minimize2 className="h-4 w-4" />}
                onClick={() => navigate('/products')}
              >
                Run in background
              </Button>
              <Button
                variant="danger"
                icon={<Square className="h-4 w-4" />}
                loading={cancel.isPending}
                disabled={stopping}
                onClick={() => cancel.mutate()}
              >
                {stopping ? 'Stopping…' : 'Stop'}
              </Button>
            </>
          ) : (
            <>
              <Button variant="secondary" onClick={() => navigate('/products')}>
                View products
              </Button>
              <Button variant="secondary" onClick={() => navigate('/crawls')}>
                Crawl history
              </Button>
              <Button onClick={onBuildAnother}>Build another</Button>
            </>
          )}
        </div>

        {running && !stopping && (
          <p className="mt-3 text-[11px] text-muted">
            The crawl keeps running on the server — you can leave this page and check progress in
            Crawl History.
          </p>
        )}
        {stopping && running && (
          <p className="mt-3 text-[11px] text-muted">
            Finishing the current product, then stopping…
          </p>
        )}
      </div>
    </div>
  );
}
