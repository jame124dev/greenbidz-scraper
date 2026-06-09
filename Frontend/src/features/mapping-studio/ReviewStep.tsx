import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Loader2, Play, FlaskConical, ImageOff } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import type { MappingDraft } from './types';
import {
  buildProfile,
  combineImageSelector,
  generalizeProductLink,
  productUrlPatternFromUrlPattern,
} from './types';
import { ScrapeProgress } from './ScrapeProgress';

interface Props {
  draft: MappingDraft;
  onChange: (patch: Partial<MappingDraft>) => void;
  /** When set, Save overwrites this existing profile instead of deriving a new file. */
  editFileName?: string | null;
}

/** Mirrors backend validateProfile so the user sees problems before saving. */
function validate(draft: MappingDraft): string[] {
  const errs: string[] = [];
  if (!draft.profileName.trim()) errs.push('Profile name is required.');
  if (!draft.domain.trim()) errs.push('Domain is required.');
  if (!draft.urlPattern.trim()) errs.push('URL pattern is required.');
  else {
    try {
      // eslint-disable-next-line no-new
      new RegExp(draft.urlPattern);
    } catch {
      errs.push('URL pattern is not a valid regex.');
    }
  }
  const title = draft.fields.find((f) => f.key === 'title');
  if (!title?.selector) errs.push('Title must be mapped (it is the required field).');
  return errs;
}

export function ReviewStep({ draft, onChange, editFileName }: Props) {
  const [savedAs, setSavedAs] = useState<string | null>(null);
  const [runStarted, setRunStarted] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);

  // Fetch the URL pattern + dedupe check from the backend once we have a sample URL.
  const patternQuery = useMutation({
    mutationFn: (url: string) => api.getUrlPattern(url),
    onSuccess: (res) => {
      // Prefer a GENERALIZED product pattern (the whole slug is dynamic), so the
      // profile matches every product — not just the sampled one.
      const gen = generalizeProductLink(draft.sampleProductUrl || res.url);
      onChange({
        urlPattern: draft.urlPattern || gen?.urlPattern || res.pattern,
        domain: draft.domain || res.domain || '',
        productUrlPattern:
          draft.productUrlPattern ||
          gen?.productUrlPattern ||
          productUrlPatternFromUrlPattern(res.pattern),
      });
    },
  });

  // Auto-run the pattern generation when entering the step.
  useEffect(() => {
    const url = draft.sampleProductUrl || draft.listingUrl;
    if (url && !patternQuery.data && !patternQuery.isPending) patternQuery.mutate(url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = useMutation({
    mutationFn: (runNow: boolean) => {
      const profile = buildProfile(
        { ...draft, productUrlPattern: draft.productUrlPattern },
        new Date().toISOString(),
      );
      // editFileName set → overwrite that exact profile; else backend derives it.
      return api.saveProfile(editFileName ?? null, profile, runNow);
    },
    onSuccess: (res) => {
      setSavedAs(res.fileName);
      setRunStarted(!!res.runStarted);
      setJobId(res.jobId ?? null);
    },
  });

  // Advisory test: scrape ~3 sample products with the current mapping (no save).
  const test = useMutation({
    mutationFn: () =>
      api.testProfile(
        buildProfile({ ...draft, productUrlPattern: draft.productUrlPattern }, new Date().toISOString()),
        3,
      ),
  });

  const errors = validate(draft);
  const dupe = patternQuery.data?.match;
  const imagesSel = combineImageSelector(draft.images);

  // After "Save & Scrape now" → live animated progress screen.
  if (savedAs && jobId) {
    return <ScrapeProgress jobId={jobId} onBuildAnother={() => window.location.reload()} />;
  }

  // After "Save only" → static confirmation.
  if (savedAs) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-900/30 text-accent">
          <CheckCircle2 className="h-7 w-7" />
        </div>
        <h2 className="text-lg font-bold text-ink">Profile saved</h2>
        <p className="text-sm text-muted">
          Written to <code className="font-mono text-sky-300">{savedAs}</code>.{' '}
          {runStarted
            ? 'An initial crawl was started in the background — check Crawl History / Products shortly.'
            : 'The scraper will use it for matching product URLs.'}
          {draft.scrapeMode === 'auto'
            ? ' It will also re-crawl automatically on the schedule (with job).'
            : ' It is one-time — it won’t auto-crawl again.'}
        </p>
        <div className="mt-2 flex gap-2">
          <Button variant="secondary" onClick={() => window.location.assign('/profiles')}>
            View profiles
          </Button>
          <Button onClick={() => window.location.reload()}>Build another</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      {/* Meta form */}
      <div className="card p-5">
        <h3 className="mb-4 text-sm font-semibold text-ink">Profile details</h3>
        <div className="grid grid-cols-2 gap-4">
          <Labeled label="Profile name">
            <input
              className="input"
              value={draft.profileName}
              placeholder={`${draft.domain} Product Scraper`}
              onChange={(e) => onChange({ profileName: e.target.value })}
            />
          </Labeled>
          <Labeled label="Domain">
            <input
              className="input"
              value={draft.domain}
              onChange={(e) => onChange({ domain: e.target.value })}
            />
          </Labeled>
          <Labeled label="URL pattern (regex)" full>
            <div className="flex gap-2">
              <input
                className="input font-mono text-xs"
                value={draft.urlPattern}
                onChange={(e) => onChange({ urlPattern: e.target.value })}
              />
              <Button
                variant="secondary"
                size="sm"
                loading={patternQuery.isPending}
                onClick={() =>
                  patternQuery.mutate(draft.sampleProductUrl || draft.listingUrl)
                }
              >
                Regenerate
              </Button>
            </div>
          </Labeled>
        </div>

        {dupe && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-warn/40 bg-amber-900/20 p-3 text-xs text-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              A profile already matches this URL:{' '}
              <code className="font-mono">{dupe.fileName}</code>
              {dupe.profileName ? ` (${dupe.profileName})` : ''}. Saving with the same domain will
              overwrite it.
            </div>
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-6">
          <Labeled label="Scrape mode">
            <div className="flex items-center gap-1 rounded-lg border border-line bg-panel2 p-1">
              {([
                { value: 'auto', label: 'With job' },
                { value: 'manual', label: 'One-time' },
              ] as const).map((m) => (
                <button
                  key={m.value}
                  onClick={() => onChange({ scrapeMode: m.value })}
                  className={
                    'rounded-md px-3 py-1.5 text-xs font-semibold ' +
                    (draft.scrapeMode === m.value ? 'bg-accent text-accent-ink' : 'text-muted')
                  }
                >
                  {m.label}
                </button>
              ))}
            </div>
          </Labeled>
          <Labeled label="Limit (new products / run)">
            <select
              className="input"
              value={draft.scrapeLimit ?? 'all'}
              onChange={(e) =>
                onChange({ scrapeLimit: e.target.value === 'all' ? null : Number(e.target.value) })
              }
            >
              <option value={10}>10 at a time</option>
              <option value={20}>20 at a time</option>
              <option value={50}>50 at a time</option>
              <option value={100}>100 at a time</option>
              <option value="all">All (no limit)</option>
            </select>
          </Labeled>

          <label className="flex cursor-pointer items-center gap-2 text-sm text-muted">
            <input
              type="checkbox"
              checked={draft.downloadImages}
              onChange={(e) => onChange({ downloadImages: e.target.checked })}
              className="h-4 w-4 accent-accent"
            />
            Download images locally
          </label>
        </div>
        <p className="mt-2 text-[11px] text-muted">
          <b>With job</b> = the scheduler re-crawls this profile automatically every interval.{' '}
          <b>One-time</b> = no background job; it runs once now and only again on demand. Either
          way, saving runs it once immediately. The <b>limit</b> caps how many new products are
          scraped each run — the rest stay queued for the next run.
        </p>
      </div>

      {/* Mapping summary */}
      <div className="card p-5">
        <h3 className="mb-3 text-sm font-semibold text-ink">Mapping summary</h3>
        <div className="space-y-1.5 text-xs">
          {draft.fields
            .filter((f) => f.selector)
            .map((f) => (
              <SummaryRow key={f.key} label={f.label} value={f.selector!} tag={f.required ? 'required' : f.type} />
            ))}
          {imagesSel && <SummaryRow label="Images" value={imagesSel} tag={`${draft.images.length} picked`} />}
          {draft.productLinkSelector && (
            <SummaryRow label="Product link" value={draft.productLinkSelector} tag="listing" />
          )}
          {draft.nextSelector && <SummaryRow label="Next page" value={draft.nextSelector} tag="pagination" />}
        </div>
      </div>

      {/* Errors + save */}
      {errors.length > 0 && (
        <div className="rounded-lg border border-danger/40 bg-red-900/20 p-3 text-xs text-red-300">
          <div className="mb-1 font-semibold">Fix before saving:</div>
          <ul className="list-inside list-disc space-y-0.5">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Advisory test: confirm the mapping on a few real products before saving. */}
      <div className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-ink">Test the mapping</h3>
            <p className="text-[11px] text-muted">
              Scrapes 3 sample products with this mapping so you can confirm the fields before saving.
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            disabled={errors.length > 0 || test.isPending}
            icon={test.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <FlaskConical className="h-4 w-4" />}
            onClick={() => test.mutate()}
          >
            {test.isPending ? 'Testing…' : 'Test 3 products'}
          </Button>
        </div>

        {test.isError && (
          <div className="mt-3 rounded-lg border border-danger/40 bg-red-900/20 p-3 text-xs text-red-300">
            {(test.error as Error).message}
          </div>
        )}

        {test.data && (
          <div className="mt-3 space-y-3">
            <p className="text-[11px] text-muted">
              {test.data.found} product link(s) found · showing {test.data.results.length}.
            </p>
            {test.data.results.map((r, i) => (
              <div key={i} className="rounded-lg border border-line bg-panel2/40 p-3">
                {!r.ok ? (
                  <div className="text-xs text-danger">
                    <span className="font-mono">{r.url}</span> — {r.error}
                  </div>
                ) : (
                  <div className="flex gap-3">
                    {r.images && r.images[0] ? (
                      <img
                        src={r.images[0]}
                        alt=""
                        className="h-16 w-16 shrink-0 rounded border border-line object-cover"
                        onError={(e) => ((e.currentTarget as HTMLImageElement).style.visibility = 'hidden')}
                      />
                    ) : (
                      <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded border border-line bg-bg text-muted">
                        <ImageOff className="h-4 w-4" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1 space-y-1 text-xs">
                      <div className="truncate font-medium text-ink">
                        {r.title || <span className="text-warn">⚠ no title</span>}
                      </div>
                      <div className="text-muted">
                        Price: <span className="text-ink">{r.priceRaw ?? r.price ?? <span className="text-warn">—</span>}</span>
                        {r.images ? <span className="ml-3">Images: {r.images.length}</span> : null}
                      </div>
                      {r.fields && Object.keys(r.fields).length > 0 && (
                        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted">
                          {Object.entries(r.fields)
                            .filter(([k]) => !['pageTitle'].includes(k))
                            .slice(0, 10)
                            .map(([k, v]) => (
                              <span key={k}>
                                <span className="text-muted/70">{k}:</span>{' '}
                                <span className={v ? 'text-ink' : 'text-warn'}>
                                  {v ? String(v).slice(0, 40) : '—'}
                                </span>
                              </span>
                            ))}
                        </div>
                      )}
                      <a href={r.url} target="_blank" rel="noreferrer" className="inline-block text-[11px] text-sky2 hover:underline">
                        view source
                      </a>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {save.isError && (
        <div className="rounded-lg border border-danger/40 bg-red-900/20 p-3 text-xs text-red-300">
          {(save.error as Error).message}
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Button
          size="md"
          variant="secondary"
          disabled={errors.length > 0 || save.isPending}
          onClick={() => save.mutate(false)}
        >
          Save only
        </Button>
        <Button
          size="md"
          disabled={errors.length > 0 || save.isPending}
          icon={save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          onClick={() => save.mutate(true)}
        >
          Save &amp; Scrape now
        </Button>
      </div>
    </div>
  );
}

function Labeled({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div className={full ? 'col-span-2' : ''}>
      <label className="mb-1 block text-[11px] uppercase tracking-wide text-muted">{label}</label>
      {children}
    </div>
  );
}

function SummaryRow({ label, value, tag }: { label: string; value: string; tag: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-28 shrink-0 text-muted">{label}</span>
      <code className="flex-1 truncate font-mono text-sky-300" title={value}>
        {value}
      </code>
      <Badge tone="neutral">{tag}</Badge>
    </div>
  );
}
